"use server";

import { revalidatePath } from "next/cache";

import { AUTHORITY, type Authority } from "@/constants/authority";
import { MEETING_STATUS } from "@/constants/meeting";
import { requireAccessToken } from "@/features/auth/session";
import { getManagedMember } from "@/features/member/manage-server";
import { TOP_LEVEL_PROJECTS } from "@/features/project/mock/projects";
import { PROJECT_TEAM_ACTIONS_MOCK } from "@/features/project/mock/team-actions";
import {
  type AttendeeScopeViewer,
  findAttendeeScopeViolation,
} from "@/features/rooms/attendee-scope";
import { RESERVATION_DURATION_MINUTES } from "@/features/rooms/constants";
import { toLocalDateTime } from "@/features/rooms/mapper/meetings";
import { findMockMember } from "@/features/rooms/mock/members";
import {
  listMockReservationsByRoom,
  updateMockReservation,
} from "@/features/rooms/mock/reservations";
import { findMockRoom } from "@/features/rooms/mock/rooms";
import { getReservableMembers } from "@/features/rooms/server";
import { getViewer } from "@/features/shell/viewer";
import { ApiError, serverApi } from "@/lib/api";
import { ep } from "@/lib/endpoints";
import { getMockActor } from "@/lib/mock-actor";
import { type Actor, canManageMeeting, requiresParentTeamAction } from "@/lib/permission";
import { isMock } from "@/mocks/config";

import { checkMeetingTitle, validateMeetingEditDraft } from "./lib";
import {
  attendeeIdsFrom,
  type BeMeetingDetail,
  type BeUpdateAttendeesResponse,
  hostIdOf,
  isClosed,
  parseMeetingDetail,
} from "./mapper";
import {
  type BeCreateOnlineMeetingResponse,
  type BeRecordingUploadUrlResponse,
  toCreateOnlineMeetingPayload,
} from "./mapper/online-meetings";
import {
  addMockOnlineMeeting,
  cancelMockMeeting,
  findMockMeeting,
  updateMockMeeting,
  updateMockMeetingAttendees,
} from "./mock/meetings";
import { validateRecordingFileMeta } from "./recording-file";
import { getMeetingDetail } from "./server";
import { meetingStatusOf } from "./status";
import type {
  MeetingDraft,
  MeetingEditDraft,
  MeetingEditFormErrors,
  MeetingTopic,
  OnlineMeetingDraft,
  OnlineMeetingFormErrors,
} from "./types";
import { validateOnlineMeetingDraft } from "./validate";
import type { MeetingAgenda, MeetingAttendee, MeetingContentPending } from "./view-types";

const MEETING_LIST_PATH = "/app/meeting";

/** 참석자 교체 폼 결과 — `useActionState`가 그대로 들고 있는 모양. */
export interface UpdateMeetingAttendeesState {
  error: string | null;
  /** 성공 시 서버 확정 명단 — 다이얼로그는 재조회 없이 이 값을 바로 반영한다(비관적 갱신). */
  attendeeIds: number[] | null;
}

/**
 * `PUT /api/meetings/{meetingId}/attendees`(MEET-09) 실패를 문구 하나로 바꾼다.
 * ⚠️ 이 다이얼로그엔 필드별 오류 자리가 없다(참석자 하나뿐인 폼) — 전부 한 줄 오류로 보여준다.
 */
function toAttendeesErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  return error.message;
}

/** 재검증 실패 문구 — **목·실서버가 같은 문장을 쓴다**(두 경로가 갈리면 화면이 다른 말을 한다). */
const ATTENDEES_EDIT_ERROR = {
  notFound: "회의를 찾을 수 없습니다",
  forbidden: "참석자를 바꿀 권한이 없습니다",
  closed: "끝난 회의는 참석자를 바꿀 수 없습니다",
  unknownMember: "존재하지 않는 참석자가 있습니다",
} as const;

/**
 * 재검증에 필요한 **그 회의의 사실**(host·상태)을 실서버에서 가져온다 — `GET /api/meetings/{id}`
 * (MEET-04, 이미 연동된 엔드포인트다. 캡처 진입 `getLiveMeetingCapture`가 같은 값을 같은 식으로 읽는다).
 *
 * ⚠️ **없는 회의는 값(`null`)으로 돌린다** — 던지면 다이얼로그 대신 `error.tsx`가 뜨는데, 없는
 *    회의는 고장이 아니라 "그런 회의가 없습니다"라고 말해 줄 일이다(캡처 경로와 같은 판단).
 * ⚠️ 나머지 오류(403·500)는 그대로 던져 호출부의 `catch`가 BE 문구로 옮긴다.
 */
async function fetchMeetingFacts(
  meetingId: string,
  accessToken: string,
): Promise<BeMeetingDetail | null> {
  try {
    return parseMeetingDetail(
      await serverApi<unknown>(ep.meeting(Number(meetingId)), { accessToken }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * 참석자 명단 교체(MEET-09) — **전체 명단 교체**다. `RoomReservation`의 참석자 피커를 그대로
 * 재사용하는 다이얼로그(`MeetingAttendeesEditDialog`)가 이 액션을 부른다.
 * ⚠️ 권한은 `canManageMeeting`(host·OWNER·ADMIN) 하나로 본다 — 화면 가드는 UX일 뿐이라
 *    여기서 다시 확인한다(§권한).
 * ⚠️ **host는 자동 포함·제거 불가**다 — 이 액션이 직접 끼워 넣지는 않는다. mock 분기는
 *    `updateMockMeetingAttendees`가, 실연동은 서버(BE)가 그 규칙을 보장한다.
 * ⚠️ **참석자 범위 규칙(2026-08-13 확정)이 여기에도 걸린다** — 개설(회의실 예약)만 막고 교체를
 *    열어 두면 만든 뒤에 규칙을 깨서 넣을 수 있고, "Owner 개설 회의의 참석자는 전부 팀장"이라는
 *    AI 팀 액션 판단 근거가 똑같이 무너진다. 규칙은 `rooms/attendee-scope.ts` 한 곳이다.
 * ⚠️ 범위 기준은 **지금 보는 사람이 아니라 그 회의의 host**다 — `canManageMeeting`이 OWNER·Admin
 *    에게도 남의 회의 교체를 허용해서, actor로 재면 Owner가 남의 팀 회의를 열었을 때 규칙이
 *    "팀장만"으로 뒤바뀐다. mock은 회의 레코드가 `hostAuthority`를 직접 들고 있어 그걸 쓰고,
 *    실서버는 MEET-04 응답에 host의 role·team이 없어 actor===host면 세션 값을, 아니면
 *    `getManagedMember`로 따로 구한다(아래 실서버 분기 주석).
 */
export async function updateMeetingAttendeesAction(
  _prev: UpdateMeetingAttendeesState,
  formData: FormData,
): Promise<UpdateMeetingAttendeesState> {
  const meetingId = String(formData.get("meetingId") ?? "");
  const attendeeIds = formData.getAll("attendeeIds").map(Number);
  /*
    ⚠️ **실서버에서는 목 액터를 쓰지 않는다.** `getMockActor()`는 고정 OWNER를 돌려주는 목이라
       실연동에서 그걸로 권한을 재면 "언제나 통과"가 된다 — 세션에서 읽는다(`rooms/actions.ts`와
       같은 자리, CLAUDE.md §권한: 판정은 서버에서).
  */
  const actor = isMock ? getMockActor() : await getViewer();

  if (isMock) {
    const meeting = findMockMeeting(meetingId);
    if (!meeting) return { error: ATTENDEES_EDIT_ERROR.notFound, attendeeIds: null };
    if (!canManageMeeting(actor, { hostId: meeting.hostId })) {
      return { error: ATTENDEES_EDIT_ERROR.forbidden, attendeeIds: null };
    }
    /*
      ⚠️ 취소된 회의도 여기서 걸린다 — 명단을 고칠 자리가 아닌데 화면 계약에 아직 취소 문구가
         없어서 "이미 끝난 회의"와 같은 자리로 보낸다(매퍼 `isClosed`와 같은 판단·같은 결과).
         실서버 경로가 `isClosed`로 둘을 함께 막으므로, 목만 취소를 통과시키면 두 모드가 갈린다.
    */
    const status = meetingStatusOf(meeting, new Date());
    if (status === MEETING_STATUS.DONE || status === MEETING_STATUS.CANCELED) {
      return { error: ATTENDEES_EDIT_ERROR.closed, attendeeIds: null };
    }

    /*
      ⚠️ **참석자 서버 재검증**(§권한: 화면 숨김은 UX일 뿐 보안이 아니다). 다이얼로그가 후보를
         좁혀 보여줘도 이 액션은 주소만 알면 직접 부를 수 있다.
      ⚠️ host의 팀 이름은 **명부에서 찾는다** — 회의 레코드에는 `hostTeamId`(숫자)만 있고 범위
         비교는 팀 **이름**으로 도는데(`RoomMember.teamName`), 팀 registry(id↔이름)가 아직
         없어서다(`lib/permission.ts` `Actor.teamName` 주석과 같은 사정). host가 명부에 없으면
         범위를 못 재므로 통과시키지 않는다(§정직성).
    */
    const attendees = attendeeIds.map(findMockMember);
    if (attendees.some((member) => member === null)) {
      return { error: "존재하지 않는 참석자가 있습니다", attendeeIds: null };
    }
    const scopeViolation = findAttendeeScopeViolation(
      attendees.filter((member) => member !== null),
      {
        id: meeting.hostId,
        role: meeting.hostAuthority,
        teamName: findMockMember(meeting.hostId)?.teamName ?? null,
      },
    );
    if (scopeViolation) return { error: scopeViolation, attendeeIds: null };

    const updated = updateMockMeetingAttendees(meetingId, attendeeIds);
    revalidatePath(`/app/meeting/${meetingId}`);
    return { error: null, attendeeIds: updated?.attendeeIds ?? null };
  }

  const accessToken = await requireAccessToken();

  const meeting = await fetchMeetingFacts(meetingId, accessToken);
  if (!meeting) return { error: ATTENDEES_EDIT_ERROR.notFound, attendeeIds: null };
  const hostId = hostIdOf(meeting);
  if (!canManageMeeting(actor, { hostId })) {
    return { error: ATTENDEES_EDIT_ERROR.forbidden, attendeeIds: null };
  }
  if (isClosed(meeting)) {
    return { error: ATTENDEES_EDIT_ERROR.closed, attendeeIds: null };
  }

  /*
    ⚠️ **참석자 서버 재검증** — `GET /api/members/my-team`이 붙으면서 대부분의 경로는 이제
       실서버에서도 볼 수 있다(2026-08-13, `rooms/server.ts`의 `getReservableMembers`).
    ⚠️ **범위 기준은 지금 보는 사람이 아니라 host다**(위 함수 주석). 두 경로로 갈린다:
       - **host 자신이 고치는 보통 경로**: 세션에 이미 host의 role·team이 있다 — 그대로 쓴다.
       - **OWNER·ADMIN이 남의 회의를 고치는 드문 경로**: `canManageMeeting`이 그걸 허용해서
         생기는 경우다. host가 **OWNER**면 `getReservableMembers`가 회사 전체 팀장 명부
         (`getTeamLeaders`, 호출자 무관)를 보므로 OWNER·ADMIN 전용 API(`GET /api/members/{id}`,
         `getManagedMember`)로 host가 OWNER인지만 확인하면 그대로 검증해도 안전하다.
    ⚠️ **host가 LEADER·MEMBER면 여기서도 못 본다 — 본 척하지 않는다**(§정직성). "OWNER·ADMIN이
       다른 LEADER·MEMBER의 회의를 고치는" 경우 `GET /api/members/my-team`은 **호출자(actor)의
       토큰**으로 팀을 정하지 host의 팀이 아니다 — `getReservableMembers`를 그대로 부르면
       actor 자신의 팀 로스터가 와서 host 팀 기준 검증이 아니게 된다(범위를 잘못 잰다). 그래서
       이 경우는 **FE 검증 자체를 건너뛰고** BE(`PUT /api/meetings/{id}/attendees`)가 최종
       방어한다 — **아직 BE 요청 문서에 못 올렸다**, 다음 라운드에 올릴 것. UI는 애초에 이
       경로로 못 들어온다(`canEditMeetingAttendees`가 `isHost`를 요구한다) — 직접 요청을
       조작해야만 닿는 자리라 영향은 방어 심도 문제다.
  */
  /*
    ⚠️ **`getManagedMember`·`getReservableMembers` 실패도 잡는다**(2026-08-15, `rooms/actions.ts`
       의 `getMeetingRooms()`와 같은 사고 — #553/#554/#556). 둘 다 실서버 분기에서 BE를
       부르는데, 감싸지 않으면 이 액션 전체가 죽어 페이지가 500으로 날아간다.
  */
  let scopeActor: Actor | null;
  if (actor.id === hostId) {
    scopeActor = actor;
  } else {
    let hostDetail: Awaited<ReturnType<typeof getManagedMember>>;
    try {
      hostDetail = await getManagedMember(hostId);
    } catch {
      return {
        error: "개설자 정보를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요",
        attendeeIds: null,
      };
    }
    scopeActor =
      hostDetail && hostDetail.member.authority === AUTHORITY.OWNER
        ? {
            id: hostId,
            role: hostDetail.member.authority,
            teamName: hostDetail.member.teamName ?? undefined,
          }
        : null;
  }

  /*
    ⚠️ scopeActor가 `null`인 건 "actor가 host가 아니고 host가 LEADER·MEMBER인" 경우다(host
       정보를 못 구한 경우 포함) — 위 주석의 "한 칸", BE가 마저 본다.
  */
  if (scopeActor) {
    let roster: Awaited<ReturnType<typeof getReservableMembers>>;
    try {
      roster = await getReservableMembers(scopeActor);
    } catch {
      return {
        error: "참석자 명부를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요",
        attendeeIds: null,
      };
    }
    const rosterIds = new Set(roster.map((member) => member.id));
    if (attendeeIds.some((id) => id !== hostId && !rosterIds.has(id))) {
      return { error: "지정할 수 없는 참석자가 있습니다", attendeeIds: null };
    }
  }

  try {
    /*
      ⚠️ **여기서 host를 끼워 넣지 않는다.** "host 자동 포함·제거 불가"는 계약이 **서버 책임**
         이라고 명시한 규칙이라(MEET-09), FE가 host를 직접 끼워 넣으면 오히려 명단을 틀리게
         만든다 — 서버가 대신 채운다.
    */
    const response = await serverApi<BeUpdateAttendeesResponse>(
      ep.meetingAttendees(Number(meetingId)),
      { method: "PUT", accessToken, json: { attendeeMemberIds: attendeeIds } },
    );
    revalidatePath(`/app/meeting/${meetingId}`);
    // ⚠️ 서버가 돌려준 명단을 쓴다(§mapper) — host 자동 포함·중복 제거가 이미 반영돼 있다.
    return { error: null, attendeeIds: attendeeIdsFrom(response) };
  } catch (error) {
    return { error: toAttendeesErrorMessage(error), attendeeIds: null };
  }
}

/** 회의 취소 결과 — 다이얼로그가 성공/실패만 보고 토스트를 띄운다(필드 오류 자리가 없다). */
export interface CancelMeetingResult {
  error: string | null;
}

/**
 * `DELETE /api/meetings/{meetingId}`(MEET-06) 실패를 문구 하나로 바꾼다.
 * ⚠️ BE의 `message`가 이미 화면에 띄울 한국어 문장이다(§lib/api) — 코드로 문구를 새로 짓지 않는다.
 */
function toCancelErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  return error.message;
}

/**
 * 회의실 캘린더의 상세 조회 모달(`RoomMeetingDetailDialog`)이 보는 만큼만 담은 경량 요약 —
 * `MeetingDetail` 전체(산출물·발화 기록 등)를 클라이언트로 그대로 넘기지 않는다.
 */
export type MeetingSummary = {
  id: string;
  title: string;
  schedule: string;
  roomName: string;
  attendees: MeetingAttendee[];
  agenda: MeetingAgenda | null;
  isHost: boolean;
  pendingReason: MeetingContentPending | null;
};

export type MeetingSummaryResult =
  | { kind: "ok"; summary: MeetingSummary }
  | { kind: "locked"; title: string | null }
  | { kind: "notFound" };

/**
 * 회의실 캘린더에서 예약 막대를 클릭했을 때 뜨는 상세 조회 모달이 부른다(`getMeetingDetail`
 * 얇은 래퍼). `getMeetingDetail`은 `server-only`라 클라이언트 컴포넌트가 직접 못 부른다 —
 * 이 액션이 그 경계를 넘는다.
 */
export async function getMeetingSummaryAction(meetingId: string): Promise<MeetingSummaryResult> {
  const viewer = await getViewer();
  const result = await getMeetingDetail(meetingId, viewer);
  if (result.kind !== "ok") return result;

  const { id, title, schedule, roomName, attendees, agenda, isHost, pendingReason } = result.detail;
  return {
    kind: "ok",
    summary: { id, title, schedule, roomName, attendees, agenda, isHost, pendingReason },
  };
}

/**
 * 회의 취소(MEET-06) — **시작 전 회의만** 가능. 취소된 회의는 소프트 취소로 남는다(물리 삭제 아님).
 * ⚠️ 권한은 `canManageMeeting`(host·OWNER·ADMIN) — MEET-09와 같은 축이다(§권한).
 * ⚠️ "이미 시작된 회의"는 여기서 취소가 아니라 종료(MEET-08, 캡처 화면)를 써야 한다 —
 *    화면은 SCHEDULED일 때만 [회의 취소]를 보여주지만, 서버에서 다시 확인한다.
 */
export async function cancelMeetingAction(meetingId: string): Promise<CancelMeetingResult> {
  if (isMock) {
    // ⚠️ `getMockActor()`는 항상 고정 OWNER다 — 실서버 분기는 이 값을 안 읽으므로 밖에
    //    두면 "쓰는 것처럼 보이지만 실제로는 실서버에서 안 쓰이는" 상태로 방치되고,
    //    나중에 실서버 분기가 actor 기반 검사를 추가하면 조용히 가짜 OWNER를 받는다
    //    (`board/actions.ts`의 `getMyActionBoard("")`와 같은 지뢰).
    const actor = getMockActor();
    const meeting = findMockMeeting(meetingId);
    if (!meeting) return { error: "회의를 찾을 수 없습니다" };
    if (!canManageMeeting(actor, { hostId: meeting.hostId })) {
      return { error: "회의를 취소할 권한이 없습니다" };
    }
    if (meetingStatusOf(meeting, new Date()) !== MEETING_STATUS.SCHEDULED) {
      return { error: "이미 시작된 회의는 취소할 수 없습니다 — 종료를 이용해 주세요" };
    }

    cancelMockMeeting(meetingId, new Date().toISOString());
    revalidatePath(`/app/meeting/${meetingId}`);
    revalidatePath(MEETING_LIST_PATH);
    return { error: null };
  }

  const accessToken = await requireAccessToken();
  try {
    await serverApi<null>(ep.meeting(Number(meetingId)), { method: "DELETE", accessToken });
    revalidatePath(`/app/meeting/${meetingId}`);
    revalidatePath(MEETING_LIST_PATH);
    return { error: null };
  } catch (error) {
    return { error: toCancelErrorMessage(error) };
  }
}

/** 회의 수정 폼 결과 — `useActionState`가 그대로 들고 있는 모양(MEET-09 폼과 같은 골격). */
export interface UpdateMeetingState {
  error: string | null;
  /**
   * 성공한 저장의 표식 — 다이얼로그가 이 값이 바뀐 걸 보고 닫는다.
   *
   * ⚠️ `boolean`으로 두면 **두 번째 저장을 못 알아챈다.** 창을 다시 열어 또 고치면 `true`에서
   *    `true`라 값이 안 바뀌고, `useEffect`가 안 돈다(MEET-09 폼이 `attendeeIds` 배열
   *    참조로 같은 문제를 피한 자리다). 저장할 때마다 새 객체를 만든다.
   */
  saved: { title: string } | null;
}

/**
 * `PATCH /api/meetings/{meetingId}`(MEET-05) 실패를 문구 하나로 바꾼다.
 * ⚠️ BE의 `message`가 이미 화면에 띄울 한국어 문장이다(§lib/api) — 코드로 문구를 새로 짓지 않는다.
 *    상태 위반(409 `MT-014`)·30분 그리드(400 `MT-005`)·중복 예약(409 `MT-002`)이 전부 여기로 온다.
 */
function toUpdateErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  return error.message;
}

/**
 * 회의 정보 수정(MEET-05) — **시작 전 회의만**. 상세 머리글의 [회의 수정]이 부른다.
 *
 * ⚠️ **지금 보내는 건 제목뿐이다.** BE는 `title`·`projectId`·`meetingRoomId`·`startAt`·`endAt`·
 *    `recordingConsent` 6개를 부분 수정으로 받지만, 뒤의 다섯은 **예약 슬롯을 다시 잡는 일**이라
 *    회의실 예약 화면의 슬롯 피커(30분 그리드·운영시간·중복 검사)를 그대로 끌어와야 한다 —
 *    반쯤 되는 폼을 먼저 내보내지 않는다(§정직성, 이슈 #419 후속).
 * ⚠️ **보낸 키만 바뀐다.** BE가 미전달과 명시적 null을 가르므로(`@JsonSetter`) 본문에
 *    `title` 하나만 싣는다 — 나머지를 `null`로 채워 보내면 필수 컬럼을 지우라는 뜻이 돼 400이다.
 * ⚠️ 권한은 `canManageMeeting`(host·OWNER·ADMIN) 하나로 본다 — 취소(MEET-06)와 같은 축이고
 *    BE `MeetingUpdateService.canManageMeeting`과 같은 범위다. 화면은 host에게만 버튼을
 *    보여주지만(`canEditMeeting`) 화면 가드는 UX일 뿐이라 여기서 다시 확인한다(§권한).
 * ⚠️ 상태 관문(`SCHEDULED`)도 다시 본다 — 목은 여기가 유일한 서버고, 실연동은 BE가 409
 *    `MT-014`로 막는다. 둘 다 한다(화면 숨김은 UX, 서버 재검사가 보안).
 */
export async function updateMeetingAction(
  _prev: UpdateMeetingState,
  formData: FormData,
): Promise<UpdateMeetingState> {
  const meetingId = String(formData.get("meetingId") ?? "");
  const checked = checkMeetingTitle(String(formData.get("title") ?? ""));
  if (!checked.ok) return { error: checked.error, saved: null };

  if (isMock) {
    // ⚠️ `getMockActor()`는 항상 고정 OWNER다 — cancelMeetingAction과 같은 이유로
    //    실서버 분기가 안 읽는 이 값을 밖에서 만들지 않는다.
    const actor = getMockActor();
    const meeting = findMockMeeting(meetingId);
    if (!meeting) return { error: "회의를 찾을 수 없습니다", saved: null };
    if (!canManageMeeting(actor, { hostId: meeting.hostId })) {
      return { error: "회의를 수정할 권한이 없습니다", saved: null };
    }
    if (meetingStatusOf(meeting, new Date()) !== MEETING_STATUS.SCHEDULED) {
      return { error: "이미 시작된 회의는 수정할 수 없습니다", saved: null };
    }

    updateMockMeeting(meetingId, { title: checked.title });
    revalidatePath(`/app/meeting/${meetingId}`);
    revalidatePath(MEETING_LIST_PATH);
    return { error: null, saved: { title: checked.title } };
  }

  const accessToken = await requireAccessToken();
  try {
    /*
      ⚠️ **응답을 안 읽는다.** MEET-05의 200 본문은 `meetingId`·`status`·`startAt`·`endAt`·
         `meetingRoom`뿐이라 **방금 고친 제목이 안 들어 있다**(BE `UpdateMeetingResponse`) —
         참석자 교체(MEET-09)처럼 서버 확정값으로 비관적 갱신을 할 수 없다. 그래서 화면은
         `revalidatePath`로 다시 읽는다.
    */
    await serverApi<unknown>(ep.meeting(Number(meetingId)), {
      method: "PATCH",
      accessToken,
      json: { title: checked.title },
    });
    revalidatePath(`/app/meeting/${meetingId}`);
    revalidatePath(MEETING_LIST_PATH);
    return { error: null, saved: { title: checked.title } };
  } catch (error) {
    return { error: toUpdateErrorMessage(error), saved: null };
  }
}

/** 회의 시간·회의실·프로젝트·녹음 동의 수정(MEET-05, #436) 폼 결과. */
export interface UpdateMeetingScheduleState {
  errors: MeetingEditFormErrors;
  /** 성공한 저장의 표식 — `UpdateMeetingState.saved`와 같은 이유로 매번 새 객체를 만든다. */
  saved: { title: string } | null;
}

function readMeetingEditDraft(formData: FormData): MeetingEditDraft {
  return {
    title: String(formData.get("title") ?? ""),
    roomId: String(formData.get("roomId") ?? ""),
    date: String(formData.get("date") ?? ""),
    startTime: String(formData.get("startTime") ?? ""),
    projectId: String(formData.get("projectId") ?? ""),
    recordingConsent: formData.get("recordingConsent") === "on",
  };
}

function toEditedRange(draft: MeetingEditDraft): { start: Date; end: Date } {
  const start = new Date(`${draft.date}T${draft.startTime}:00`);
  const end = new Date(start.getTime() + RESERVATION_DURATION_MINUTES * 60_000);
  return { start, end };
}

/**
 * `PATCH /api/meetings/{meetingId}`(MEET-05, 시간·회의실·프로젝트·녹음 동의 묶음) 실패를
 * 필드 오류로 바꾼다 — `rooms/actions.ts`의 `toMeetingCreateFormErrors`(개설)와 같은 코드를
 * 같은 필드로 매핑한다(둘 다 예약 슬롯 규칙을 탄다). 슬롯 없는 오류(`MT-014` 등)는 `title`
 * 칸에 얹는다(그 두 함수와 같은 자리 — 이 폼도 "전체 오류"를 보여줄 별도 자리가 없다).
 */
function toUpdateMeetingScheduleFormErrors(error: unknown): MeetingEditFormErrors {
  if (!(error instanceof ApiError)) throw error;

  switch (error.code) {
    case "MT-002":
      return { roomId: "그 시간에는 이미 예약된 회의실입니다" };
    case "MT-005":
      return { startTime: "수정은 30분 단위로만 가능합니다" };
    case "MT-012":
      return { startTime: "지난 시간은 선택할 수 없습니다" };
    case "MT-003":
      return { startTime: error.message };
    case "MR-001":
      return { roomId: "존재하지 않는 회의실입니다" };
    case "PJ-001":
      return { projectId: "존재하지 않는 프로젝트입니다" };
    default:
      return { title: error.message };
  }
}

/**
 * 회의 시간·회의실·프로젝트·녹음 동의 수정(MEET-05) — **시작 전 회의만**. 제목만 고치는
 * `updateMeetingAction`과 **다른 액션이다**(#436). 두 화면(`MeetingEditDialog`·회의실
 * 캘린더의 `RoomMeetingDetailDialog`)이 같은 액션·같은 폼 계약을 쓰면, 슬롯 피커가 없는
 * `RoomMeetingDetailDialog`가 갑자기 `roomId`·`date`·`startTime`·`projectId` 없이 제출해
 * 필수 필드 오류부터 뜬다 — 그래서 아예 나눈다(둘 다 결국 같은 PATCH를 부른다).
 * ⚠️ **항상 6필드를 전부 보낸다.** "보낸 키만 바뀐다"는 부분 수정 능력이지 매번 최소한만
 *    보내야 한다는 뜻이 아니다 — 다이얼로그가 6필드를 한 폼에서 같이 받으므로 안 바뀐 값도
 *    자기 값으로 다시 보내는 것이 diff를 추적하는 것보다 단순하고 안전하다(그 자체로 no-op).
 * ⚠️ **회의실·시간을 바꾸면 예약 규칙을 다시 탄다** — 30분 그리드(`MT-005`)·과거 시각
 *    (`MT-012`)·중복 예약(`MT-002`)은 회의실 예약 개설(`rooms/actions.ts`)과 같은 규칙이다.
 * ⚠️ 권한·상태 관문은 `updateMeetingAction`과 같다(host·OWNER·ADMIN, `SCHEDULED`만).
 */
export async function updateMeetingScheduleAction(
  _prev: UpdateMeetingScheduleState,
  formData: FormData,
): Promise<UpdateMeetingScheduleState> {
  const meetingId = String(formData.get("meetingId") ?? "");
  const draft = readMeetingEditDraft(formData);
  const errors = validateMeetingEditDraft(draft);
  if (Object.keys(errors).length > 0) return { errors, saved: null };

  const title = draft.title.trim();

  if (isMock) {
    // ⚠️ `getMockActor()`는 항상 고정 OWNER다 — cancelMeetingAction과 같은 이유로
    //    실서버 분기가 안 읽는 이 값을 밖에서 만들지 않는다.
    const actor = getMockActor();
    const meeting = findMockMeeting(meetingId);
    if (!meeting) return { errors: { title: "회의를 찾을 수 없습니다" }, saved: null };
    if (!canManageMeeting(actor, { hostId: meeting.hostId })) {
      return { errors: { title: "회의를 수정할 권한이 없습니다" }, saved: null };
    }
    if (meetingStatusOf(meeting, new Date()) !== MEETING_STATUS.SCHEDULED) {
      return { errors: { title: "이미 시작된 회의는 수정할 수 없습니다" }, saved: null };
    }

    // ⚠️ 화면 select·피커가 이미 실제 목록에서만 고르게 해도, 폼은 조작될 수 있다(§권한).
    const room = findMockRoom(draft.roomId);
    if (!room) return { errors: { roomId: "존재하지 않는 회의실입니다" }, saved: null };
    const project = TOP_LEVEL_PROJECTS.find((item) => String(item.id) === draft.projectId);
    if (!project) return { errors: { projectId: "존재하지 않는 프로젝트입니다" }, saved: null };

    const { start, end } = toEditedRange(draft);
    // ⚠️ 자기 자신의 지금 슬롯은 겹침 검사에서 뺀다 — 안 그러면 시간을 안 바꾸고 저장만 눌러도
    //    "이미 예약됨"에 걸린다.
    const overlapping = listMockReservationsByRoom(draft.roomId).some(
      (reservation) =>
        reservation.id !== meeting.roomReservationId &&
        reservation.start < end &&
        reservation.end > start,
    );
    if (overlapping) {
      return { errors: { roomId: "그 시간에는 이미 예약된 회의실입니다" }, saved: null };
    }

    updateMockMeeting(meetingId, {
      title,
      roomId: room.id,
      roomName: room.name,
      projectId: project.id,
      projectTag: project.tag,
      start,
      end,
      recordingConsent: draft.recordingConsent,
    });
    // ⚠️ 회의실 예약도 같이 고친다 — 안 그러면 회의실 주간 캘린더가 옛 슬롯을 계속 막아 둔다
    //    (`updateMockReservation` 주석 참고). 회의실 예약 없이 만든 회의는 없다(WORKFLOW §3-1)
    //    이므로 `roomReservationId`는 항상 있다 — 그래도 값으로 방어한다.
    if (meeting.roomReservationId) {
      updateMockReservation(meeting.roomReservationId, {
        title,
        roomId: room.id,
        roomName: room.name,
        projectId: draft.projectId,
        projectTag: project.tag,
        start,
        end,
      });
    }

    revalidatePath(`/app/meeting/${meetingId}`);
    revalidatePath(MEETING_LIST_PATH);
    return { errors: {}, saved: { title } };
  }

  const accessToken = await requireAccessToken();
  try {
    const { start, end } = toEditedRange(draft);
    /* ⚠️ 응답을 안 읽는다 — `updateMeetingAction`과 같은 이유(§주석), `revalidatePath`로 다시 읽는다. */
    await serverApi<unknown>(ep.meeting(Number(meetingId)), {
      method: "PATCH",
      accessToken,
      json: {
        title,
        projectId: Number(draft.projectId),
        meetingRoomId: Number(draft.roomId),
        startAt: toLocalDateTime(start),
        endAt: toLocalDateTime(end),
        recordingConsent: draft.recordingConsent,
      },
    });
    revalidatePath(`/app/meeting/${meetingId}`);
    revalidatePath(MEETING_LIST_PATH);
    return { errors: {}, saved: { title } };
  } catch (error) {
    return { errors: toUpdateMeetingScheduleFormErrors(error), saved: null };
  }
}

/**
 * 참석자 범위 판정에 필요한 최소 정보만 `Actor`에서 뽑는다(`attendee-scope.ts`).
 * ⚠️ `rooms/actions.ts`에 같은 이름의 헬퍼가 있지만 export되지 않아 여기서 다시 만든다 —
 *    로직은 한 줄이라 두 벌이어도 어긋날 여지가 없다(`updateMeetingAttendeesAction`도 같은
 *    모양을 인라인으로 쓴다).
 */
function toAttendeeScopeViewer(actor: Actor): AttendeeScopeViewer {
  return { id: actor.id, role: actor.role, teamName: actor.teamName ?? null };
}

/** 비대면 회의 만들기 폼 결과 — `useActionState`가 그대로 들고 있는 모양. */
export interface OnlineMeetingFormState {
  errors: OnlineMeetingFormErrors;
  /** 성공 시 방금 만든 회의 id — 다이얼로그가 이 값으로 상세로 이동한다(재조회 없이). */
  created?: { id: string };
}

function readOnlineMeetingDraft(formData: FormData): OnlineMeetingDraft {
  const parentTeamActionId = formData.get("parentTeamActionId");
  const mains = formData.getAll("topicMain");
  const subs = formData.getAll("topicSub");

  // ⚠️ `handleSubmit`(클라이언트)이 S3 업로드까지 끝낸 뒤에만 이 세 값을 채워 넣는다 — 하나라도
  //    비면 아직 파일이 안 올라간 것이라 `recording: null`로 둔다(§types의 `OnlineMeetingDraft` 주석).
  const recordingS3Key = String(formData.get("recordingS3Key") ?? "");
  const recordingFileName = String(formData.get("recordingFileName") ?? "");
  const recordingContentType = String(formData.get("recordingContentType") ?? "");
  const recordingSizeBytes = Number(formData.get("recordingSizeBytes") ?? 0);

  return {
    title: String(formData.get("title") ?? ""),
    projectId: String(formData.get("projectId") ?? ""),
    topics: mains.map((main, index) => ({ main: String(main), sub: String(subs[index] ?? "") })),
    attendeeIds: formData.getAll("attendeeIds").map(Number),
    parentTeamActionId: parentTeamActionId ? Number(parentTeamActionId) : undefined,
    recording: recordingS3Key
      ? {
          s3Key: recordingS3Key,
          fileName: recordingFileName,
          contentType: recordingContentType,
          sizeBytes: recordingSizeBytes,
        }
      : null,
  };
}

/**
 * `POST /api/meetings/online`(MEET-18) 실패를 폼 필드 오류로 바꾼다.
 * ⚠️ `rooms/actions.ts`의 `toMeetingCreateFormErrors`(MEET-01)와 같은 자리 — 필드 슬롯이 없는
 *    오류(`Z-001` 등 전용 슬롯이 있는 것 빼고)는 `title` 칸에 얹는다.
 * ⚠️ **`PROJECT_NOT_FOUND` 리터럴은 오지 않는다**(2026-08-16 BE 실코드 대조로 정정 —
 *    2026-08-14 도메인 담당자 명세가 틀렸다). `ErrorResponse.of`(BE global/exception/ErrorResponse.java:23)가
 *    **전 도메인에서** `errorCode.getCode()`를 `errorCode` 필드로 내리므로 실제 값은 `"PJ-001"`이다.
 *    이 엔드포인트만 예외를 두지 않는다.
 */
function toOnlineMeetingCreateFormErrors(error: unknown): OnlineMeetingFormErrors {
  if (!(error instanceof ApiError)) throw error;

  switch (error.code) {
    case "MT-010":
      return { attendeeIds: "존재하지 않는 참석자가 있습니다" };
    case "MT-015":
      return { topics: error.message };
    /* ⚠️ MT-017은 **참석자 부족**이다("개설자 외 참석자를 한 명 이상 선택해야 합니다") —
       상위 팀 액션 오류(016·018·019)와 다른 칸이다. */
    case "MT-017":
      return { attendeeIds: error.message };
    case "MT-016":
    case "MT-018":
    case "MT-019":
      return { parentTeamActionId: error.message };
    case "PJ-001":
      return { projectId: "존재하지 않는 프로젝트입니다" };
    // ⚠️ **여기 도착한 CAP-0XX는 "발급 뒤 상태가 바뀐" 경우다** — CAP-024(용량)·CAP-025(형식)는
    //    보통 업로드 URL 발급 단계(`getOnlineMeetingRecordingUploadUrlAction`)에서 먼저 걸리지만,
    //    발급 뒤 S3 업로드가 안 끝났거나(CAP-023) 다른 사용자·경로의 `s3Key`를 흉내 냈으면(CAP-015)
    //    이 마지막 호출에서야 드러난다 — 전부 녹음 칸 오류로 보여준다.
    case "CAP-015":
    case "CAP-023":
    case "CAP-024":
    case "CAP-025":
      return { recording: error.message };
    default:
      return { title: error.message };
  }
}

/** `POST /api/meetings/online/recordings/upload-url` 실패 → 화면에 보여줄 문구 하나로 바꾼다. */
function toRecordingUploadUrlErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  return error.message;
}

/** 업로드 URL 발급 결과 — 실패는 파일 첨부 칸의 오류로, S3 PUT은 클라이언트가 직접 한다. */
export type RecordingUploadUrlResult =
  | {
      ok: true;
      s3Key: string;
      /**
       * BE가 정제한 저장용 파일명 — MEET-18 `recording.fileName`에 **이 값을 그대로** 싣는다.
       * ⚠️ 화면에 보여줄 이름이 아니다. 표시는 사용자가 고른 원본(`File.name`)을 쓴다.
       * ⚠️ `s3Key`가 이 이름으로 끝나고 확정 단계가 `s3Key.endsWith("/" + fileName)`을 검사한다 —
       *    원본 이름을 보내면 한글·공백 파일명이 전부 400 CAP-015로 튕긴다.
       */
      storageFileName: string;
      /** `null`이면 목 모드다 — 실제 S3가 없어 클라이언트가 PUT 단계를 건너뛴다. */
      presignedUrl: string | null;
      contentType: string;
    }
  | { ok: false; message: string };

/**
 * 비대면 회의 등록 3단계 중 **1단계** — presigned 업로드 URL 발급(이슈 #473, 2026-08-14 계약
 * 변경). `OnlineMeetingDialog`가 [등록]을 누른 순간 직접 호출한다(폼 제출이 아니다 — S3로의
 * 직접 PUT은 브라우저 `fetch`라 `useActionState` 한 번의 제출로는 표현이 안 된다, 프로젝트
 * 첨부파일 업로드와 같은 이유).
 * ⚠️ 파일 형식·용량은 **여기서도 다시 본다**(§권한: 화면 검증은 UX일 뿐 보안이 아니다) — 클라이언트
 *    1차 검증을 우회해도 잘못된 메타로 발급을 받을 수 없다.
 */
export async function getOnlineMeetingRecordingUploadUrlAction(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<RecordingUploadUrlResult> {
  const fileError = validateRecordingFileMeta(input);
  if (fileError) return { ok: false, message: fileError };

  if (!isMock) {
    const accessToken = await requireAccessToken();
    try {
      const response = await serverApi<BeRecordingUploadUrlResponse>(
        ep.meetingsOnlineRecordingUploadUrl(),
        { method: "POST", accessToken, json: input },
      );
      return {
        ok: true,
        s3Key: response.s3Key,
        storageFileName: response.fileName,
        presignedUrl: response.presignedUrl,
        contentType: input.contentType,
      };
    } catch (error) {
      return { ok: false, message: toRecordingUploadUrlErrorMessage(error) };
    }
  }

  /*
    ⚠️ 목은 실제 S3가 없다 — `presignedUrl: null`로 돌려 클라이언트가 2단계(S3 PUT)를 건너뛰게
       한다(§정직한 목업, `project`의 `AttachmentUploadTicket.uploadUrl: string | null`과 같은 규칙).
    ⚠️ **파일명은 실서버와 같은 규칙**(BE `RecordingFilePolicy.sanitizeForStorageName` —
       영숫자·`.`·`-`·`_` 외 전부 `_`)으로 정제해 s3Key에 박고, 같은 값을 `storageFileName`으로
       돌려준다. 규칙을 두 벌로 두는 게 아니라 **목 스텁**이다(실서버 경로는 응답의 `fileName`을
       그대로 쓴다). 이 정제가 없으면 목이 실서버보다 관대해져 한글 파일명 버그가 목에서 안 잡힌다.
  */
  const storageFileName = input.fileName.replace(/[^A-Za-z0-9.\-_]/g, "_");
  return {
    ok: true,
    s3Key: `recordings/mock/online-pending/${storageFileName}`,
    storageFileName,
    presignedUrl: null,
    contentType: input.contentType,
  };
}

/**
 * 비대면 회의 만들기(이슈 #473) — `/app/rooms` 회의실 패널의 [비대면 회의] 버튼이 부른다.
 *
 * ⚠️ **BE 실코드 대조 완료**(MEET-18, 2026-08-16 — `mapper/online-meetings.ts` 헤더 주석
 *    참고). 더는 "아직 준비 중"도 "대조 전"도 아니다.
 * ⚠️ **`recordingConsent`를 안 보낸다** — 서버가 항상 `true`로 고정한다(팀 확정, 매퍼 주석).
 * ⚠️ **제출하면 그 자리에서 완료 처리된다** — 회의실 예약(`createRoomReservationAction`)과
 *    달리 캡처 화면으로 안 넘어간다(팀 명세). 그래서 회의실·시간을 아예 안 받는다.
 * ⚠️ **단일 모달, 등록 한 번**(2026-08-14 계약 변경 — 이전엔 회의 생성 뒤 별도 2단계에서
 *    녹음 파일을 붙였다). `OnlineMeetingDialog`가 [등록]을 누르면 업로드 URL 발급 → 브라우저의
 *    S3 직접 PUT → 이 액션 순서로 부른다 — 이 시점엔 `draft.recording`이 이미 채워져 있어야
 *    한다(`validateOnlineMeetingDraft`가 비어 있으면 막는다).
 * ⚠️ mock 분기의 검증 순서는 `createRoomReservationAction`과 맞춘다(프로젝트 → 참석자 범위 →
 *    상위 팀 액션) — 같은 도메인의 두 생성 경로가 다른 순서로 막히면 같은 실수가 화면마다
 *    다른 첫 오류로 보인다.
 */
export async function createOnlineMeetingAction(
  _prev: OnlineMeetingFormState,
  formData: FormData,
): Promise<OnlineMeetingFormState> {
  const draft = readOnlineMeetingDraft(formData);
  const actor = isMock ? getMockActor() : await getViewer();
  const errors = validateOnlineMeetingDraft(draft, { role: actor.role });
  if (Object.keys(errors).length > 0) return { errors };

  if (!isMock) {
    const accessToken = await requireAccessToken();
    try {
      const response = await serverApi<BeCreateOnlineMeetingResponse>(ep.meetingsOnline(), {
        method: "POST",
        accessToken,
        json: toCreateOnlineMeetingPayload(draft),
      });
      revalidatePath(MEETING_LIST_PATH);
      return { errors: {}, created: { id: String(response.meetingId) } };
    } catch (error) {
      return { errors: toOnlineMeetingCreateFormErrors(error) };
    }
  }

  // ⚠️ 화면 select·피커가 이미 실제 목록에서만 고르게 해도, 폼은 조작될 수 있다
  //    (§권한: 화면 숨김은 UX일 뿐 보안이 아니다) — 참조값이 실제로 존재하는지 서버에서 다시 본다.
  const project = TOP_LEVEL_PROJECTS.find((item) => String(item.id) === draft.projectId);
  if (!project) {
    return { errors: { projectId: "존재하지 않는 프로젝트입니다" } };
  }

  /*
    ⚠️ **참석자 서버 재검증**(`createRoomReservationAction`과 같은 규칙, 2026-08-13 확정).
       화면 피커가 후보를 좁혀 보여줘도 Server Action은 주소만 알면 직접 부를 수 있어, 제출된
       id가 **실존하는지**와 **범위 안인지**를 여기서 다시 본다. 규칙 자체는 `attendee-scope.ts`
       한 곳이다 — 화면과 서버가 갈리면 안 된다.
  */
  const attendees = draft.attendeeIds.map(findMockMember);
  if (attendees.some((member) => member === null)) {
    return { errors: { attendeeIds: "존재하지 않는 참석자가 있습니다" } };
  }
  const scopeViolation = findAttendeeScopeViolation(
    attendees.filter((member) => member !== null),
    toAttendeeScopeViewer(actor),
  );
  if (scopeViolation) return { errors: { attendeeIds: scopeViolation } };

  // ⚠️ Owner가 아니면 "상위 팀 액션"이 필수인데, 그 값이 진짜 이 프로젝트 소속이고 **자기
  //    팀**에 하달된 게 맞는지까지 다시 본다 — `createRoomReservationAction`과 같은 검사다.
  if (requiresParentTeamAction(actor) && draft.parentTeamActionId !== undefined) {
    const teamAction = PROJECT_TEAM_ACTIONS_MOCK[project.tag]?.find(
      (item) => item.id === draft.parentTeamActionId,
    );
    if (!teamAction || teamAction.team !== actor.teamName) {
      return { errors: { parentTeamActionId: "존재하지 않는 상위 팀 액션입니다" } };
    }
  }

  // ⚠️ `Meeting.topics`는 최소 1개짜리 튜플 타입이다 — 위 검증이 이미 최소 1쌍을 보장했다
  //    (`rooms/mock/reservations.ts`의 `addMockReservation`과 같은 처리).
  const trimmedTopics = draft.topics.map((topic) => ({
    main: topic.main.trim(),
    sub: topic.sub.trim(),
  }));
  const [firstTopic, ...restTopics] = trimmedTopics;
  const topics: [MeetingTopic, ...MeetingTopic[]] = [firstTopic!, ...restTopics];
  const attendeeIds = Array.from(new Set([actor.id, ...draft.attendeeIds]));

  const meetingCommon = {
    title: draft.title.trim(),
    // ⚠️ 비대면 회의는 회의실·시간이 없다(이슈 #473) — mock 스토어(`addMockOnlineMeeting`)가
    //    저장 직전에 실제 시각(제출 시각)을 채운다. 여기서는 판별식 유니언 조립에 필요한
    //    최소값만 넣는다.
    start: new Date(0),
    end: new Date(0),
    roomId: null,
    roomName: null,
    roomReservationId: null,
    isOnline: true,
    // ⚠️ 이제 이 시점에 이미 파일이 S3에 올라가 있다 — 파일명을 그대로 붙인다(§types 주석).
    recordingFileName: draft.recording!.fileName,
    projectId: project.id,
    projectTag: project.tag,
    topics,
    attendeeIds,
    hostId: actor.id,
  };

  // ⚠️ `Meeting`은 Owner 개설/팀 액션 개설을 판별식 유니언으로 나눠 둔다 — 같은 분기를
  //    `rooms/mock/reservations.ts`의 `addMockReservation`이 쓴다(같은 규칙, 다른 생성 경로).
  const meetingDraft: MeetingDraft = requiresParentTeamAction(actor)
    ? {
        ...meetingCommon,
        hostAuthority: actor.role as Extract<Authority, "LEADER" | "MEMBER">,
        hostTeamId: actor.teamId!,
        parentTeamActionId: draft.parentTeamActionId!,
      }
    : { ...meetingCommon, hostAuthority: AUTHORITY.OWNER };

  const meeting = addMockOnlineMeeting(meetingDraft);
  revalidatePath(MEETING_LIST_PATH);
  return { errors: {}, created: { id: meeting.id } };
}
