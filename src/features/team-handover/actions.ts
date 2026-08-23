"use server";

import { revalidatePath } from "next/cache";

import { requireAccessToken } from "@/features/auth/session";
import {
  completeMockHandoverMidApproval,
  rejectMockHandover,
} from "@/features/member/mock/managed";
import { TEAM_ACTION_PERSONAL_ITEMS_MOCK } from "@/features/project/mock/team-action-detail";
import { getViewer } from "@/features/shell/viewer";
import { ApiError, serverApi } from "@/lib/api";
import { todayIso } from "@/lib/date";
import { ep } from "@/lib/endpoints";
import { canApproveMid } from "@/lib/permission";
import { isMock } from "@/mocks/config";

import { getTeamHandoverDetail } from "./server";
import type { TeamHandoverAssignment, TeamMemberOption } from "./types";

const LIST_PATH = "/team/handover";
const MANAGE_PATH = "/manage/members";

function findPersonalItem(actionId: number) {
  for (const items of Object.values(TEAM_ACTION_PERSONAL_ITEMS_MOCK)) {
    const found = items.find((item) => item.id === actionId);
    if (found) return found;
  }
  return null;
}

/**
 * 액션 하나를 재배정한다 — BE는 건별 `PATCH /api/handovers/{id}/items/{actionId}/reassign`로
 * 락·멱등을 강제한다(BE 인수인계 문서, 2026-08-10; 일괄 반영 엔드포인트가 아니다).
 * 지금은 mock이라 로컬 mutate 한 건이지만, **실연동 시 이 함수 내부만 실 API 호출로 바꾸면**
 * `completeTeamHandoverAction`의 순회 구조는 그대로 쓴다.
 */
function reassignHandoverItem(
  assignment: TeamHandoverAssignment,
  teammateById: Map<number, TeamMemberOption>,
): void {
  const teammate = teammateById.get(assignment.assigneeId);
  const item = findPersonalItem(assignment.actionId);
  if (!teammate || !item) return;
  item.assigneeName = teammate.name;
  item.assigneeRoleLabel = teammate.roleLabel ?? undefined;
}

/**
 * §4 재배정 오케스트레이션(BE 인수인계 문서, 2026-08-10) — 일괄 반영 엔드포인트가 없어
 * FE가 순서를 책임진다: 건별 `PATCH .../items/{actionId}/reassign` **전부** 성공한 뒤에만
 * `PATCH .../complete`(팀장 중간승인)를 부른다. `completeTeamHandoverAction`의 실 연동
 * 분기가 이 함수를 그대로 부른다.
 *
 * ⚠️ 중간에 하나라도 실패하면 그 assignment에서 예외가 그대로 던져진다 — 이미 성공한
 *    앞쪽 reassign은 BE에 반영된 채로 남는다(부분 성공). 호출부가 이 상태를 다시 열었을 때
 *    `reassigneeId`로 복원하는 건 화면(§4 "재배정 오케스트레이션") 몫이다.
 * ⚠️ `memberId`는 API 호출엔 안 쓴다 — 사원 상세(`/manage/members/{memberId}`) 캐시 경로를
 *    무효화하는 데만 쓴다.
 */
export async function commitHandoverReassignments(
  handoverId: number,
  memberId: number,
  assignments: TeamHandoverAssignment[],
): Promise<void> {
  const accessToken = await requireAccessToken();

  for (const { actionId, assigneeId } of assignments) {
    await serverApi<unknown>(ep.handoverReassignItem(handoverId, actionId), {
      method: "PATCH",
      json: { toMemberId: assigneeId },
      accessToken,
    });
  }

  await serverApi<unknown>(ep.handoverComplete(handoverId), {
    method: "PATCH",
    accessToken,
  });

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${memberId}`);
  revalidatePath(`${MANAGE_PATH}/${memberId}`);
}

/**
 * [인수인계 확정] — 팀원 보드로 재배정한 결과를 한 번에 반영하고 팀장 중간 승인을 남긴다
 * (WORKFLOW.md §7·§13-4).
 * ⚠️ **재배정 반영은 `board/actions.ts`와 같은 방식**이다(mock) — `TEAM_ACTION_PERSONAL_ITEMS_MOCK`
 *    항목을 직접 mutate한다(별도 격리 저장소를 새로 두지 않는다).
 * ⚠️ **실서버 분기만 팀 스코프를 검사한다**(2026-08-15) — mock 로스터엔 숫자 팀 id가 없어
 *    (`server.ts`의 `teamId: 0` 참고) `canApproveMid`의 teamId 대조를 mock에서 그대로
 *    쓸 수 없다. 대신 `getViewer().teamName`으로 mock 데이터를 좁힌다(#678과 같은 이유로
 *    "김서준·개발팀" 고정값은 제거했다) — **진짜 방어선은 BE다**(§권한: 화면 숨김은 UX일
 *    뿐) — 이건 그 앞에 세우는 1차 가드일 뿐이라 BE 쪽 스코프 검증과 별개로 먼저 넣는다.
 */
export async function completeTeamHandoverAction(
  handoverId: number,
  assignments: TeamHandoverAssignment[],
): Promise<{ isSuccess: boolean; message?: string }> {
  const viewer = await getViewer();

  /*
    ⚠️ `getTeamHandoverDetail`은 404·403만 `null`로 접는다 — 그 외 실패(통신 장애 등)는
       그대로 다시 던진다. 여기서도 잡아야 페이지가 안 죽는다(2026-08-15, 같은 사고 —
       #553/#554/#556/#558).
  */
  let handover: Awaited<ReturnType<typeof getTeamHandoverDetail>>;
  try {
    handover = await getTeamHandoverDetail(handoverId, viewer.teamName);
  } catch {
    return {
      isSuccess: false,
      message: "인수인계서를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요",
    };
  }
  if (!handover) return { isSuccess: false, message: "이미 처리됐거나 없는 인수인계서입니다" };

  if (!isMock) {
    if (!canApproveMid(viewer, { teamId: handover.teamId })) {
      return { isSuccess: false, message: "이 인수인계서를 승인할 권한이 없습니다" };
    }
  }

  /*
    ⚠️ 화면의 "전부 배정" 제약은 UX일 뿐이다 — 여기서도 다시 본다(§권한: 화면 숨김은
       보안이 아니다). **꼭 이 인수인계서의 액션만, 정확히 한 번씩** 와야 한다(CodeRabbit
       지적, 2026-08-09) — 조작된 요청이 이 신청자 아닌 다른 사람의 액션 id를 끼워 넣거나
       같은 액션을 중복으로 보낼 수 있다. 하나라도 어긋나면 **부분 처리하지 않고 전체를
       막는다** — 일부만 반영되면 "N/M건 배정 완료"가 실제와 달라진다.
  */
  const validActionIds = new Set(handover.actions.map((action) => action.id));
  const teammateById = new Map(handover.teammates.map((teammate) => [teammate.id, teammate]));

  if (assignments.length !== handover.actions.length) {
    return { isSuccess: false, message: "배정 요청이 인계 액션 수와 맞지 않습니다" };
  }
  const seenActionIds = new Set<number>();
  for (const { actionId, assigneeId } of assignments) {
    if (!validActionIds.has(actionId) || seenActionIds.has(actionId)) {
      return { isSuccess: false, message: "이 인수인계서의 액션이 아니거나 중복됐습니다" };
    }
    if (!teammateById.has(assigneeId)) {
      return { isSuccess: false, message: "이 팀의 담당자가 아닙니다" };
    }
    seenActionIds.add(actionId);
  }

  if (isMock) {
    for (const assignment of assignments) {
      reassignHandoverItem(assignment, teammateById);
    }
    completeMockHandoverMidApproval(handoverId, viewer.name, todayIso());
  } else {
    try {
      await commitHandoverReassignments(handoverId, handover.memberId, assignments);
    } catch (error) {
      if (error instanceof ApiError) return { isSuccess: false, message: error.message };
      throw error;
    }
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${handoverId}`);
  revalidatePath(`${MANAGE_PATH}/${handover.memberId}`);

  return { isSuccess: true };
}

/**
 * [반려] — **팀장도 반려할 수 있다**(오너의 최종 승인/반려와 별개, 2026-08-09 팀 확정).
 * 인계 액션이 빠졌거나 잘못 배정된 걸 여기서 걸러내지 못하면 오너까지 올라간 뒤에야
 * 드러난다 — 팀장 선에서 먼저 막을 수 있어야 한다.
 * ⚠️ **아직 중간 승인 전인 신청만** 반려할 수 있다 — 이미 중간 승인해 올린 건은 오너의
 *    최종 승인/반려(`approveHandoverAction`/`rejectHandoverAction`) 몫이다.
 * ⚠️ mock 반려 결과는 오너의 반려와 같다(신청 자체를 지우고 재직으로 되돌린다) — 같은
 *    `rejectMockHandover` 뮤테이터를 그대로 쓴다. 실 연동은 `PATCH .../reject`(BE 상태만
 *    `REJECTED`로 바꾼다 — 사람 재직 상태는 별개 도메인 몫이다).
 */
export async function rejectTeamHandoverAction(
  handoverId: number,
  reason: string,
): Promise<{ isSuccess: boolean; message?: string }> {
  if (!reason.trim()) return { isSuccess: false, message: "반려 사유를 입력해 주세요" };

  const viewer = await getViewer();

  let handover: Awaited<ReturnType<typeof getTeamHandoverDetail>>;
  try {
    handover = await getTeamHandoverDetail(handoverId, viewer.teamName);
  } catch {
    return {
      isSuccess: false,
      message: "인수인계서를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요",
    };
  }
  if (!handover) return { isSuccess: false, message: "이미 처리됐거나 없는 인수인계서입니다" };

  if (!isMock) {
    if (!canApproveMid(viewer, { teamId: handover.teamId })) {
      return { isSuccess: false, message: "이 인수인계서를 반려할 권한이 없습니다" };
    }
  }

  if (isMock) {
    /*
      ⚠️ 사유는 오너의 반려와 같은 이유로 **지금은 저장하지 않는다**(`handover-approval-card.tsx`
         주석 참고) — 저장할 자리도 보여줄 화면도 아직 없다.
    */
    rejectMockHandover(handoverId);
  } else {
    try {
      const accessToken = await requireAccessToken();
      await serverApi<unknown>(ep.handoverReject(handoverId), {
        method: "PATCH",
        json: { reason },
        accessToken,
      });
    } catch (error) {
      if (error instanceof ApiError) return { isSuccess: false, message: error.message };
      throw error;
    }
  }

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${handoverId}`);
  revalidatePath(`${MANAGE_PATH}/${handover.memberId}`);

  return { isSuccess: true };
}
