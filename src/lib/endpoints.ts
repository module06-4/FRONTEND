/**
 * 엔드포인트 레지스트리 — **환각 API 방지** (CONVENTIONS §5).
 *
 * 규칙: `fetch`/`serverApi`에 문자열 URL 리터럴을 쓰지 않는다. **반드시 `ep.*`만.**
 *   경로가 여기 없으면 "아직 합의되지 않은 경로"라는 뜻이다. 지어내지 말고 팀에 확인한다.
 *
 * ⚠️ 아래 **[확인]** 표시가 붙은 경로는 BE 레포 실코드로 대조했다(2026-08-10).
 *   나머지는 아직 **FE 제안 경로**다 — 쓰기 전에 컨트롤러를 먼저 본다(§연동 검증).
 *
 * ⚠️ **부르는 곳이 없는 채로 남겨 두지 않는다**(2026-08-13, #433). 검증 안 된 빈 경로가 실제
 *   경로 옆에 서 있으면 위 규칙이 거꾸로 작동한다 — 다음 사람이 "여기 있으니 합의된 경로"라고
 *   읽고 집는다. 이때 `subscription`(`/api/subscription` — BE 컨트롤러 없음, 실 결제 경로는
 *   `/api/companies/me/billing*`)과 `departments`(`/api/departments` — 조직이 부서에서
 *   **플랫한 팀**으로 확정되며 `teams`로 대체됐다, CLAUDE.md §권한 ③)를 지웠다.
 *   ⚠️ 반대로 **호출부가 없어도 남기는 것**이 있다 — 지금 화면이 없을 뿐 쓰기로 정해진 경로다.
 *      `notifications`·`notificationStream`은 알림 SSE 배너가 예정돼 있고(CLAUDE.md
 *      §렌더링·데이터: "알림=SSE, BFF가 스트림을 중계"), 캡처 조각·검색·`todos` 등은 연동이
 *      진행 중이다. 지우기 전에 **그 도메인 담당자·이슈를 먼저 본다.**
 */
/**
 * BE 주소 — 서버 쪽 fetch 호출부(`lib/api.ts`·`proxy.ts`·`auth/session.ts`·알림/자막 SSE
 * BFF 라우트)가 전부 여기서 가져온다. 예전엔 각자 `process.env.BACKEND_API_URL ?? "http://
 * localhost:8080"`을 따로 적어 뒀는데, 그러면 폴백을 고칠 때 한 곳을 빠뜨려도 타입 에러가
 * 안 난다 — 이 파일은 `server-only`가 아니라 `proxy.ts`(Edge)에서도 그대로 쓸 수 있다.
 */
export const BACKEND_BASE_URL = process.env.BACKEND_API_URL ?? "http://localhost:8080";

/**
 * 목록 3종(`GET /api/projects`·`/api/actions`·`/api/team/actions`)이 공유하는 쿼리 파라미터.
 * ⚠️ **`sort`는 여기 없다.** 컨트롤러마다 화이트리스트가 달라서(프로젝트만 `name`을 받는다)
 *    한 타입에 몰아 두면 액션 목록에 `sort=name`을 보내도 타입이 안 막는다 — BE는 모르는
 *    값을 조용히 무시하므로 화면만 엉뚱한 차례로 서고 아무도 못 본다(§연동 검증).
 */
export interface ListPageParams {
  status?: "TODO" | "IN_PROGRESS" | "DONE";
  order?: "asc" | "desc";
  page?: number;
  size?: number;
}

/**
 * 프로젝트 목록.
 * ⚠️ `keyword`·`sort=name`은 **2026-08-13에 BE가 붙였다**(커밋 `9bd9c010` — [확인]
 *    `ProjectController.list` 주석 "keyword 검색 추가 … 프로젝트명 대소문자 무시 부분일치",
 *    `sort=dueDate|createdAt|name`). 이게 없어서 이 목록만 무한 스크롤을 못 얹고 전량을
 *    받아 화면에서 거르고 있었다(#417 잔여분).
 */
export interface ProjectListParams extends ListPageParams {
  keyword?: string;
  sort?: "dueDate" | "createdAt" | "name";
}

/**
 * 액션 목록 2종(`/api/actions`·`/api/team/actions`) — ⚠️ `sort`에 `name`이 **없다**.
 * ⚠️ 프로젝트와 갈라 두는 이유: 컨트롤러마다 화이트리스트가 달라서 한 타입에 몰아 두면
 *    액션 목록에 `sort=name`을 보내도 타입이 안 막는다 — BE는 모르는 값을 조용히 무시하므로
 *    화면만 엉뚱한 차례로 서고 아무도 못 본다(§연동 검증).
 */
export interface ActionListParams extends ListPageParams {
  sort?: "dueDate" | "createdAt";
  overdue?: boolean;
  /**
   * 값을 주면 호출자 본인이 아니라 **그 팀원의** 목록을 대신 조회한다(2026-08-11 추가,
   * 이홍근 요청 — 팀원 관리 화면). LEADER 전용, 같은 팀 소속만 — [확인] `ActionController.java`.
   */
  assigneeMemberId?: number;
}

/**
 * 회의 목록(MEET-02)이 받는 쿼리 파라미터 — [확인] `meeting/presentation/api/MeetingListController.java`.
 *
 * ⚠️ **`from`·`to`를 생략하면 안 된다.** 서버 기본값이 `오늘-3개월 ~ 오늘`이라
 *    (`MeetingListQueryService.validateAndResolve`) **예정 회의가 통째로 빠진다** — 이 화면의
 *    첫 탭이 "내가 개설한(예정 포함)"이라 앞쪽을 열어 주지 않으면 빈 목록으로 보인다.
 * ⚠️ `page`는 **0-base**(CLAUDE.md §목록), `size`는 1~100이고 벗어나면 Z-001로 거절된다.
 */
export interface MeetingListParams {
  projectId?: number;
  meetingRoomId?: number;
  /** `YYYY-MM-DD` */
  from?: string;
  to?: string;
  status?: "SCHEDULED" | "IN_PROGRESS" | "DONE" | "CANCELED";
  /** 두 탭을 가르는 값 — `HOSTED`=내가 개설한 · `ATTENDING`=참여해야 할(host 제외) */
  scope?: "HOSTED" | "ATTENDING";
  page?: number;
  size?: number;
}

/**
 * 회사 전체 구성원 액션(`GET /api/company/actions`) — **OWNER‖admin 전용**(2026-08-13 신설,
 * 커밋 `9646c7a2`). [확인] `CompanyActionController` — `@PreAuthorize("hasRole('OWNER') or
 * principal.isAdmin()")`.
 *
 * ⚠️ **`assigneeMemberId`가 사실상 필수다.** 경로는 `required = false`지만 유스케이스 주석이
 *    "이 화면은 항상 특정 구성원 한 명의 액션을 보는 용도라 null은 이번 스코프에 없다"고
 *    못 박았다 — 안 넘기면 무엇이 오는지 계약에 없다. 타입에서도 필수로 둔다.
 * ⚠️ `/api/actions`의 같은 이름 파라미터와 **의미는 같고 스코프만 다르다**(팀 vs 회사).
 *    그래서 경로가 갈린다 — 한쪽에 `?scope=`를 붙이지 않는다.
 */
export interface CompanyActionListParams extends ListPageParams {
  assigneeMemberId: number;
  sort?: "dueDate" | "createdAt";
  overdue?: boolean;
}

/** `undefined`·`null` 값은 쿼리에서 빠진다 — 서버 기본값을 그대로 쓰게 둔다. */
function toQuery(params: object | undefined): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (entries.length === 0) return "";
  const search = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
  return `?${search.toString()}`;
}

export const ep = {
  /* 인증 — [확인] identity/auth/presentation/api/AuthController.java */
  login: () => "/api/auth/login",
  refresh: () => "/api/auth/refresh",
  logout: () => "/api/auth/logout",
  me: () => "/api/auth/me",
  /**
   * 비밀번호 변경 — 마이페이지 담당자 문서(2026-08-14)로 확인. `memberId`는 토큰에서 꺼내므로
   * 보내지 않는다. 성공하면 BE가 전 기기 로그인을 해제한다 — 호출부가 세션을 지우고
   * 로그인 화면으로 보낸다(§연동 검증).
   */
  changePassword: () => "/api/auth/me/password",
  /**
   * 비밀번호 찾기(로그인 전) — 마이페이지 담당자 문서(2026-08-14)로 확인. 인증 불필요.
   * 이메일은 회사 안에서만 유일해 `companyCode`가 같이 필요하다. 성공해도 새 비밀번호는
   * 응답에 안 실리고 메일로만 나간다 — 그리고 성공(200)이면 BE가 전 기기 로그인을 해제한다
   * (`changePassword`와 같은 자리).
   */
  passwordReset: () => "/api/auth/password/reset",

  /* 기업 — [확인] identity/company/presentation/api/CompanyController.java */
  companyLookup: () => "/api/companies/lookup",
  companyRegistrations: () => "/api/companies/registrations",
  companyMe: () => "/api/companies/me",
  companyOnboarding: () => "/api/companies/me/onboarding",
  /*
   * 저장소 관리(`/manage/storage`). [확인] BE `CompanyStorageController`
   * (`metering` 패키지, 2026-08-14 BE PR #494) — `GET`만 있다. 프로젝트별 저장 기록
   * 삭제(`DELETE .../projects/{tag}`)는 BE에 아직 없다(`deleteRecordingsAction` 참고).
   */
  companyStorage: () => "/api/companies/me/storage",

  /*
   * 회의 — [확인] BE 실코드 대조(2026-08-12, 커밋 `51b5482f` "회의·회의실·공지사항 API 경로 통일" 리팩터 반영)
   *   `meeting/presentation/api/{MeetingController,MeetingListController,MeetingDetailController}.java`
   *
   * ⚠️ **`/api/v1/` 접두사는 폐기됐다**(2026-08-12, 커밋 `51b5482f`) — 그 전에 붙였던 v1은
   *    이제 전부 404다. 캡처 전용 조회는 없다 — 캡처 화면도 상세(MEET-04)를 쓴다(§환각 API 방지).
   *
   * [확인] 목록(MEET-02)·대시보드(MEET-17) 실코드 재대조(2026-08-13) — `MeetingListController.java`
   *   `MeetingListResponse.java` · `DashboardMeetingController.java` `DashboardMeetingListResponse.java`.
   */
  /**
   * 예약 생성(`POST`, MEET-01)과 목록 조회(`GET`, MEET-02)가 같은 경로를 쓴다.
   * ⚠️ 파라미터 뜻·주의는 {@link MeetingListParams} — 특히 `from`·`to`를 비우면 예정 회의가 빠진다.
   */
  meetings: (params?: MeetingListParams) => `/api/meetings${toQuery(params)}`,
  /**
   * 비대면 회의 생성(`POST`, MEET-18, 이슈 #473) — **FE 제안 경로**, 아직 BE 실코드로 대조 전이다
   *   (§연동 검증: 계약은 도메인 담당자 문서로 확정됐지만 컨트롤러는 못 봤다). 구현 착수 전 재대조할 것.
   * ⚠️ `meetings()`(MEET-01)와 경로가 다르다 — 비대면 회의는 회의실·시간이 없어 별도 엔드포인트다.
   * ⚠️ **2026-08-14 계약 변경** — 요청 본문에 `recording`(`s3Key`·`fileName`·`contentType`·
   *    `sizeBytes`)이 추가됐다. 파일 바이트는 이 경로로 안 온다 — 아래 `meetingsOnlineRecordingsUploadUrl`로
   *    미리 받은 presigned URL에 브라우저가 S3로 직접 올린 뒤, 그 결과(`s3Key` 등)만 여기 싣는다.
   */
  meetingsOnline: () => "/api/meetings/online",
  /**
   * 비대면 회의 녹음 업로드용 presigned URL 발급(`POST`, 이슈 #473, 2026-08-14 계약 변경) —
   * **FE 제안 경로**, 아직 BE 실코드로 대조 전이다(§연동 검증). 구현 착수 전 재대조할 것.
   * ⚠️ 여기서 받은 `presignedUrl`로 **브라우저가 S3에 직접 PUT**한다 — 파일이 BE 서버를
   *    거치지 않는다. `s3Key`는 응답을 그대로 옮겨 `meetingsOnline()` 요청의 `recording.s3Key`에
   *    싣는다(발급받지 않은 경로를 쓰면 BE가 `CAP-015`로 막는다).
   */
  meetingsOnlineRecordingUploadUrl: () => "/api/meetings/online/recordings/upload-url",
  /**
   * 한 회의의 세 갈래가 **같은 경로**를 쓴다 — `GET` 상세(MEET-04, 캡처 진입도 이걸 쓴다) ·
   * `PATCH` 수정(MEET-05) · `DELETE` 취소(MEET-06). 없으면 404 `MT-001`, 열람 권한 없으면 403 `MT-011`.
   *
   * ⚠️ **MEET-05용 `meetingUpdate`를 따로 만들지 않는다.** 경로 문자열이 같은데 함수를 둘로
   *    두면 BE가 경로를 옮길 때 한쪽만 고쳐진다(§도메인 상수: 값은 한 곳) — 이미 DELETE(MEET-06)가
   *    같은 자리를 쓰고 있다. 명세 번호로 찾는 사람을 위해 셋을 여기 다 적어 둔다.
   * ⚠️ **PATCH는 시작 전(`SCHEDULED`) 회의만 받는다.** 진행중·완료·취소는 409 `MT-014`
   *    ("이미 시작된 회의는 수정·취소할 수 없습니다") — 확정된 캡처 시간축 때문이다.
   * ⚠️ PATCH 본문은 **보낸 키만** 바뀐다(BE가 `@JsonSetter`로 미전달과 명시적 null을 가른다) —
   *    `title`·`projectId`·`meetingRoomId`·`startAt`·`endAt`·`recordingConsent` 6개가 대상이고,
   *    보낸 키에 `null`을 실으면 400이다(필수 컬럼을 지우는 요청으로 본다).
   * ⚠️ 시간·회의실을 바꾸면 예약 규칙을 다시 탄다 — 30분 그리드(400 `MT-005`)·과거 시각
   *    (400 `MT-012`)·중복 예약(409 `MT-002`). **`MT-004`(회의실 운영시간)는 없다**(2026-08-18
   *    재확인 — 운영시간 개념이 BE PR #523에서 폐기되며 enum에서 사라졌다, `rooms/actions.ts`의
   *    같은 정정 참고).
   *
   * [확인] `meeting/presentation/api/{MeetingUpdateController,request/UpdateMeetingRequest}.java` ·
   *   `application/service/MeetingUpdateService.java`(2026-08-13).
   */
  meeting: (id: number) => `/api/meetings/${id}`,
  /**
   * 대시보드 최근 회의(MEET-17, 구현 완료) — [확인] `meeting/presentation/api/DashboardMeetingController.java`
   * · `application/service/DashboardMeetingQueryService.java`(2026-08-13).
   *
   * ⚠️ **`scope`는 필수다**(생략하면 Z-001). 역할로 추론하지 않고 부르는 쪽이 명시한다 —
   *    `owner`는 OWNER만, `team`은 LEADER만(게다가 토큰에 `teamId`가 있어야 한다), `me`는 전원.
   *    맞지 않으면 403이라 **역할 가드가 있는 화면에서만** 부른다.
   * ⚠️ `limit`은 1~20(기본 5). 벗어나면 Z-001이다.
   * ⚠️ 경로가 `/api/meetings/{meetingId}`와 겹쳐 보이지만 리터럴이 먼저 잡힌다(Spring 매핑 규칙).
   */
  meetingsDashboard: (params: { scope: "owner" | "team" | "me"; limit?: number }) =>
    `/api/meetings/dashboard${toQuery(params)}`,
  /** 내 예정 회의(MEET-03, 구현 완료) — 대시보드 위젯용. `limit` 생략 시 서버 기본값(5, 최대 20). */
  meetingsUpcoming: (params?: { limit?: number }) => `/api/meetings/upcoming${toQuery(params)}`,
  /** 참석자 명단 교체(MEET-09, 구현 완료) — 전체 명단 교체(부분 추가·삭제 아님). */
  meetingAttendees: (meetingId: number) => `/api/meetings/${meetingId}/attendees`,
  /**
   * 정본 스크립트 조회(ANLZ-05) — 회의 발화를 시간순으로. [확인]
   * `capture/presentation/api/AnalysisController.getTranscripts`(2026-08-14, BE 실코드 대조).
   *
   * ⚠️ **커서는 우리가 해석하지 않는다.** 불투명한 문자열이고 BE가 준 `nextCursor`를 다음
   *    호출의 `cursor`로 그대로 돌려준다 — 안에 무엇이 들었는지는 BE만 안다.
   * ⚠️ `ids`는 근거 발화 지름길(검토 화면이 액션 근거 몇 건만 볼 때)이라 여기서는 안 쓴다 —
   *    상세 화면은 전체를 시간순으로 읽는다.
   */
  meetingTranscripts: (meetingId: number, params?: { cursor?: string }) =>
    `/api/meetings/${meetingId}/transcripts${toQuery(params)}`,
  /**
   * 확정 대기 회의 목록(MEET-10, 구현 완료 — PR #233) — 마이페이지 "미확정 액션" 위젯용.
   * [확인] D도메인 REST API 명세(2026-08-12) 대조. 파라미터 없음 — host 본인 회의만 서버가
   * 자동 스코프한다(전 롤 호출 가능, 판정은 역할이 아니라 `hostMemberId` 일치).
   */
  meetingsPendingActionDistributions: () => "/api/meetings/pending-action-distributions",
  /**
   * 요약 중단 회의 목록(MEET-15, 구현 완료 — PR #345) — 마이페이지 "요약이 중단된 회의" 위젯용.
   * [확인] D도메인 REST API 명세(2026-08-12) 대조. `page`는 0부터. host 본인 회의만 서버가
   * 자동 스코프한다(MEET-10과 같은 이유 — 역할이 아니라 `hostMemberId` 일치).
   */
  meetingsStalledSummaries: (params?: {
    page?: number;
    size?: number;
    projectId?: number;
    from?: string;
    to?: string;
  }) => `/api/meetings/stalled-summaries${toQuery(params)}`,

  /*
   * 캡처 — [확인] BE 실코드 대조(2026-08-12, 커밋 `51b5482f` "회의·회의실·공지사항 API 경로 통일" 리팩터 반영)
   *   `cap/presentation/api/{CaptureUploadController,CaptionController,CaptureQueryController}.java`
   *   `meeting/presentation/api/{CaptureSessionController,MeetingCompletionController}.java`
   *   `capture/presentation/api/AnalysisController.java`
   *
   * ⚠️ **`/api/v1/` 접두사는 폐기됐다**(2026-08-12, 커밋 `51b5482f`). 캡처 세션(CAP-01·02·03)과
   *    회의 종료(MEET-08)도 이제 자막·조각·분석과 똑같이 `/api/`만 쓴다 — v1을 되살리면 전부 404다.
   * ⚠️ **CAP-01(녹음 시작)이 예전 MEET-07(입장)을 흡수했다**(2026-08-12 정합성 감사 P0) — 이
   *    경로는 이제 `SCHEDULED → IN_PROGRESS` 전이와 캡처 세션 생성을 한 트랜잭션으로 한다.
   *    ⚠️ **아직 `status: spec`이다**(D도메인 명세 기준 미구현) — 흡수된 흐름에 맞춘 호출부
   *    (`capture/actions.ts`) 재설계는 별도 이슈다.
   * ⚠️ **CAP-10(세션 단독 조회)은 폐기됐다**(2026-08-12) — host 장애는 참석자 이어받기가
   *    아니라 host 본인 재접속으로 복구한다.
   *    ⚠️ **CAP-09(진행 중 캡처 조회)는 살아 있다**(2026-08-16 실코드 대조 정정 — 예전 이
   *    자리에 "폐기됐다"고 잘못 적혀 있었다). BE `CaptureQueryController` 참고 — 새로고침
   *    복구의 첫 단추라 상수는 아래 `capturesActive`에 별도로 뒀다.
   */
  captureSession: (meetingId: number) => `/api/meetings/${meetingId}/capture-session`,
  captureSessionPause: (meetingId: number) => `/api/meetings/${meetingId}/capture-session/pause`,
  captureSessionResume: (meetingId: number) => `/api/meetings/${meetingId}/capture-session/resume`,
  /** 회의 종료 + 분석 접수(MEET-08, 구현 완료) — 분석은 **서버가** 큐에 건다, 프론트가 부르지 않는다 */
  meetingComplete: (meetingId: number) => `/api/meetings/${meetingId}/complete`,

  /** 자막 청크 **배치** 전송(CAP-11)·전체 조회(CAP-12) */
  captions: (meetingId: number) => `/api/meetings/${meetingId}/captions`,
  /**
   * 자막 실시간 구독(CAP-13) — **SSE 스트림이다**(JSON 단발 응답이 아니다).
   *
   * ⚠️ **구독 시점 이전 자막은 안 내려온다.** `captions`(CAP-12)로 먼저 채운 뒤 이어받는다 —
   *    순서를 뒤집으면 늦게 들어온 사람 화면의 앞부분이 통째로 빈다.
   * ⚠️ 이벤트 세 종류: `caption` · `participant` · `heartbeat`.
   */
  captionsStream: (meetingId: number) => `/api/meetings/${meetingId}/captions/stream`,
  /** 녹음 조각 presigned URL 배치 발급(CAP-04) */
  partsPresign: (meetingId: number) => `/api/meetings/${meetingId}/parts/presign`,
  /** 조각 업로드 완료 통보(CAP-07) — 이 호출 자체가 하트비트다 */
  partComplete: (meetingId: number, seq: number) =>
    `/api/meetings/${meetingId}/parts/${seq}/complete`,
  /** 어디까지 올라갔는지(CAP-08) — 새로고침·크래시 뒤 이어 올리기 */
  partsStatus: (meetingId: number) => `/api/meetings/${meetingId}/parts/status`,
  /**
   * 진행 중 캡처 조회(CAP-09) — 새로고침·크래시 복구의 첫 단추.
   * [확인] BE `cap/presentation/api/CaptureQueryController.java` (2026-08-16).
   *
   * ⚠️ **파라미터가 없다.** 회의는 토큰의 memberId로 서버가 찾는다(남의 진행 캡처 열람 차단).
   * ⚠️ **진행 중인 캡처가 없으면 200 + `data: null`이다** — 404가 아니다.
   * ⚠️ 응답 `canTakeover`가 true여도 캡처 화면은 Host 전용이라(`getMeetingCapture`가 참석자를
   *    막는다) 이 값은 안내 문구로만 쓰고 참석자용 진입로를 새로 만들지 않는다.
   */
  capturesActive: () => "/api/captures/active",
  /** AI 처리 상태(CAP-06) — 종료 뒤 폴링 */
  processingStatus: (meetingId: number) => `/api/meetings/${meetingId}/processing-status`,
  /**
   * 요약 재시도 · 계층 재개(ANLZ-02) — 마이페이지 "요약이 중단된 회의"의 [다시 분석].
   * [확인] `capture/presentation/api/AnalysisController.java#resumeAnalysis`(2026-08-13).
   *
   * ⚠️ **ANLZ-01(`POST /analysis`)과 다르다.** 저쪽은 처음부터 다시 돌려 **재과금**이 나고,
   *    이쪽은 **실패한 계층부터 이어** 돌려 앞 계층 토큰이 다시 안 나간다.
   * ⚠️ **본문을 안 보낸다**(`@RequestBody(required = false)`). 화면은 어느 계층이 깨졌는지
   *    모르고, 알려면 CAP-06을 먼저 부르는 왕복이 생긴다 — 생략하면 **서버가 처음 깨진
   *    계층을 고른다**(BE `ResumeAnalysisRequest` 주석). 빈 문자열을 보내면 400 `ANLZ-003`이라
   *    "안 보내는 것"과 "빈 값"이 다르다.
   * ⚠️ 409 둘을 일반 실패로 뭉치지 않는다 — `ANLZ-008`은 **재개할 계층이 없다**(전부 성공했거나
   *    한 번도 안 돌았다)는 뜻이라 처음부터(ANLZ-01) 돌려야 하고, `ANLZ-004`는 앞 계층이
   *    안 끝나 지금은 못 잇는다는 뜻이다.
   * ⚠️ **200이 성공을 뜻하지 않는다.** 큐가 없어 요청 스레드에서 그대로 돌기 때문에 응답
   *    `status`에 실제 결과(`DONE`·`FAILED`·`SKIPPED`·`ALREADY_RUNNING`·`SUPERSEDED`)가 실려 온다.
   */
  meetingAnalysisRetry: (meetingId: number) => `/api/meetings/${meetingId}/analysis/retry`,

  /*
   * AI 액션 분배 검토(RVW) — [확인] BE 실코드 대조(2026-08-12)
   *   `capture/presentation/api/AnalysisController.java` (`@RequestMapping("/api/meetings/{meetingId}")`)
   *
   * ⚠️ 검토(조회·판정·직접 추가)는 참석자 전원 가능, **확정(RVW-05)만 Host 1명**이다(403은 BE가 재검사).
   * ⚠️ RVW-04(직접 추가 취소 `DELETE /review/actions/{id}`)는 **일부러 안 등록한다** — 우리 화면은
   *    확정 전까지 전부 로컬 상태라(WORKFLOW §3-4), 서버에 만든 적 없는 항목을 지울 일이 없다.
   */
  /** 검토 조회(RVW-01) — 담당자별 묶음 + `needsReview` + `dispatchedAt`(확정 전이면 null) */
  meetingReview: (meetingId: number) => `/api/meetings/${meetingId}/review`,
  /** 항목 판정(RVW-02) — `CONFIRM`(값 실으면 422) · `MODIFY`(고친 칸만) · `REJECT`(사유 5종 필수) */
  meetingReviewDecision: (meetingId: number, actionId: number) =>
    `/api/meetings/${meetingId}/review/${actionId}`,
  /** 액션 직접 추가(RVW-03) — 담당자·기한 필수(422). ⚠️ `plannedStartDate`는 못 실어 RVW-02 MODIFY로 뒤따라 보낸다 */
  meetingReviewAddAction: (meetingId: number) => `/api/meetings/${meetingId}/review/actions`,
  /** 분배 확정(RVW-05) — 미검토·미확인 구간 남으면 409, `confirm=true`로만 강행. `skipped`가 응답의 절반이다 */
  meetingReviewConfirm: (meetingId: number, force = false) =>
    `/api/meetings/${meetingId}/review/confirm${force ? "?confirm=true" : ""}`,

  /*
   * 액션 · 프로젝트 · 캘린더 — [확인] BE 실코드 대조(2026-08-10, 잇다 REST API 연동 가이드 최종본)
   *   `project/presentation/api/{ProjectController,ProjectAttachmentController}.java`
   *   `action/presentation/api/{ActionController,TeamActionController,MeetingActionController}.java`
   *   `calendar/presentation/api/{CalendarController,TodoController}.java`(경로 추정 — 컨트롤러
   *   클래스명은 아직 실코드로 못 봤다, `/api/calendar`·`/api/todos` 자체는 문서로 확인됨)
   *
   * 목록 3종(`projects`·`actions`·`teamActions`)은 `GET /api/projects` 등이 `PageResponse` 봉투로
   * 오므로 `page`/`size`/`status`/`sort`/`order` 쿼리를 여기서 조립한다 — 값이 없으면 그 파라미터
   * 자체를 안 붙인다(서버 기본값을 그대로 쓰게).
   */
  projects: (params?: ProjectListParams) => `/api/projects${toQuery(params)}`,
  /** 오너 대시보드 KPI(전체 프로젝트·마감 D-7) — [확인] PR #354 머지 완료, OWNER 전용 */
  projectDashboardSummary: () => "/api/projects/dashboard-summary",
  project: (id: number) => `/api/projects/${id}`,
  projectStatusBulk: () => "/api/projects/status/bulk",
  projectTimeline: (id: number) => `/api/projects/${id}/timeline`,
  projectAttachmentUploadUrl: (projectId: number) =>
    `/api/projects/${projectId}/attachments/upload-url`,
  projectAttachmentConfirm: (projectId: number) => `/api/projects/${projectId}/attachments/confirm`,
  projectAttachmentDownloadUrl: (projectId: number, attachmentId: number) =>
    `/api/projects/${projectId}/attachments/${attachmentId}/download-url`,
  projectAttachment: (projectId: number, attachmentId: number) =>
    `/api/projects/${projectId}/attachments/${attachmentId}`,

  actions: (params?: ActionListParams) => `/api/actions${toQuery(params)}`,
  action: (id: number) => `/api/actions/${id}`,
  actionCompleteBulk: () => "/api/actions/complete/bulk",
  meetingActions: (meetingId: number) => `/api/meetings/${meetingId}/actions`,
  /** 회사 전체 구성원 액션 — OWNER‖admin 전용(사원 상세의 담당 액션 카드). */
  companyActions: (params: CompanyActionListParams) => `/api/company/actions${toQuery(params)}`,

  teamActions: (params?: ActionListParams) => `/api/team/actions${toQuery(params)}`,
  teamAction: (id: number) => `/api/team/actions/${id}`,
  teamActionTimeline: (id: number) => `/api/team/actions/${id}?tab=timeline`,
  teamActionAttachmentDownloadUrl: (teamActionId: number, attachmentId: number) =>
    `/api/team/actions/${teamActionId}/attachments/${attachmentId}/download-url`,
  /** 팀 대시보드 KPI 4종(팀 액션·팀원 액션·내 액션·완료 액션) — [확인] PR #354 머지 완료(2026-08-11) */
  teamDashboardSummary: () => "/api/team/actions/dashboard-summary",
  /** 팀원 현황(이름·직급·역할·재직상태·담당 액션 수) — [확인] PR #354 머지 완료, LEADER 전용 */
  teamMembers: () => "/api/team/members",

  /**
   * [확인] BE PL 캘린더/Todo 연동 가이드(2026-08-13, PR #457 머지 완료) — `CalendarItemResponse`·
   *   `TodoResponse`·`CreateTodoRequest` 소스·테스트 대조. `month` 생략 시 이번 달(서버 기본값).
   */
  calendar: (month?: string) => `/api/calendar${toQuery(month ? { month } : undefined)}`,
  todos: () => "/api/todos",
  todoComplete: (id: number) => `/api/todos/${id}/complete`,

  /* 인수인계 */
  /**
   * 목록 — [확인] `HandoverController.list`. 조회 범위(본인/자기팀/회사 전체)는 **토큰이 정한다**,
   * 파라미터로 안 받는다 — `status`만 클라이언트가 거른다.
   */
  handovers: (params?: { status?: "SUBMITTED" | "REASSIGNED" | "FINALIZED" | "REJECTED" }) =>
    `/api/handovers${toQuery(params)}`,
  handover: (id: number) => `/api/handovers/${id}`,
  /** 상세 리치뷰(타임라인·회의맥락·수신자별 그룹) — BE 인수인계 문서(2026-08-10) §2. */
  handoverPackage: (id: number) => `/api/handovers/${id}/package`,
  /** 레거시 컴파일러 파생 인사이트 — 오프보딩 최종승인 뒤에만 채워짐(BE 인수인계 문서 §2). */
  handoverInsights: (id: number) => `/api/handovers/${id}/insights`,
  /** 건별 재배정 — 일괄 반영 엔드포인트가 아니다(락·멱등, §team-handover/actions.ts). */
  handoverReassignItem: (id: number, actionId: number) =>
    `/api/handovers/${id}/items/${actionId}/reassign`,
  handoverComplete: (id: number) => `/api/handovers/${id}/complete`,
  handoverFinalize: (id: number) => `/api/handovers/${id}/finalize`,
  handoverReject: (id: number) => `/api/handovers/${id}/reject`,
  /** 팀장 오프보딩 귀속 대기 일괄 이전 — OWNER·ADMIN 전용. */
  handoverAttributeToLeader: (id: number) => `/api/handovers/${id}/attribute-to-leader`,

  /* 조직 */
  /* 조직 — [확인] identity/member/presentation/api/{Member,ManageMember}Controller.java */
  members: () => "/api/members",
  member: (id: number) => `/api/members/${id}`,
  /**
   * 조직도 — `/api/members`와 달리 전 구성원(OWNER·LEADER·MEMBER)에게 열려 있다.
   * 응답은 팀 단위로 이미 묶여 온다(`List<OrgChartTeamResponse>`) — `manage-server.ts`
   * `listAllManagedMembersForOrgChart`가 다시 평평하게 편다.
   */
  memberOrgChart: () => "/api/members/org-chart",
  /**
   * 내 팀 로스터 — 회의 참석자 픽커 전용(`/api/members`와 다르다, 그건 관리 화면용).
   * 응답은 `{memberId, name}[]`, ACTIVE만, 본인도 포함(제외는 FE 몫) — 팀은 **토큰의 teamId**로
   * 정해져 파라미터로 안 보낸다. 팀이 없으면(OWNER) 빈 배열이지 오류가 아니다.
   * [확인] BE `MemberController.myTeamRoster` / `MemberDirectoryService.getTeamRoster`
   * (identity/member 도메인) — 2026-08-13 BE 레포 실코드 대조.
   * ⚠️ 역할 게이트는 `hasAnyRole('OWNER','ADMIN','LEADER','MEMBER')`로 전부 열려 있지만,
   *    OWNER는 토큰에 teamId가 없어 호출해도 빈 배열만 온다 — 그래서 Owner 쪽 참석자 후보는
   *    이 API가 아니라 팀별 리더 조회(`getTeamLeaders`, `ep.teams()`)로 따로 구한다.
   */
  membersMyTeam: () => "/api/members/my-team",
  /** 오너 대시보드 KPI(전체 사원·휴직자) — [확인] PR #385 머지 완료, OWNER 전용 */
  memberDashboardSummary: () => "/api/members/dashboard-summary",
  /** 팀장 현황(이름·이메일·팀·재직상태·휴직기간) — [확인] PR #385 머지 완료, OWNER 전용 */
  teamLeadersStatus: () => "/api/members/leaders-status",
  /**
   * 관리자 겸직 토글 — **OWNER 전용**이고 경로가 따로다.
   *
   * ⚠️ 역할·직급 변경(`member`)에 `isAdmin`을 실어 보내면 BE가 400(`FIELD_NOT_ALLOWED`)으로
   *    막는다. 어드민이 자기를 복제하는 것을 끊으려고 일부러 갈라 둔 경로다.
   */
  memberAdmin: (id: number) => `/api/members/${id}/admin`,
  /** 계정 발급 — 첫 비밀번호는 서버가 메일로 보낸다 */
  manageMembers: () => "/api/manage/members",
  /**
   * 사원 삭제(`DELETE`) — **소프트**다(상태 `DELETED` + `deleted_at`, 행은 남는다).
   * 응답에 `data`가 없다(`successWithoutData`) — 닫은 계정의 정보를 되돌려 줄 이유가 없다.
   * [확인] BE `ManageMemberController.delete` 2026-08-13 develop(`30952c10`).
   */
  manageMember: (id: number) => `/api/manage/members/${id}`,
  /**
   * 팀 — [확인] identity/team/presentation/api/TeamController.java
   *
   * ⚠️ **한 건씩 다룬다**(`POST`·`PATCH /{id}`·`DELETE /{id}`). 트리를 통째로 넣는
   *    `PUT`은 BE에 없다 — 화면은 통째로 저장하므로 부르는 쪽이 **차이를 계산해** 나눠 부른다.
   * ⚠️ 조회 응답에 `memberCount`가 들어 있다 — 사람이 딸린 팀을 못 지우는 판정에 그대로 쓴다.
   */
  teams: () => "/api/teams",
  team: (id: number) => `/api/teams/${id}`,
  /**
   * 팀 안 역할 CRUD — [확인] BE PR #528(2026-08-14). OWNER 전용, 팀과 같은 이유로
   * 한 건씩 다룬다(`POST`·`PATCH /{roleId}`·`DELETE /{roleId}`).
   * ⚠️ 조회(`GET /api/teams`)의 `roles[].memberCount`가 삭제 막는 판정에 쓰인다.
   */
  teamRoles: (teamId: number) => `/api/teams/${teamId}/roles`,
  teamRole: (teamId: number, roleId: number) => `/api/teams/${teamId}/roles/${roleId}`,
  /** 직급 — [확인] identity/position/presentation/api/PositionController.java */
  jobPositions: () => "/api/job-positions",
  jobPosition: (id: number) => `/api/job-positions/${id}`,

  /**
   * 회의실 — [확인] `meetingroom/presentation/api/{MeetingRoomController,MeetingRoomCommandController}.java`
   *   (2026-08-12 실코드 대조).
   *
   * ⚠️ **경로는 `/api/rooms`다.** 도메인 문서의 `/api/meeting-rooms`는 BE "회의·회의실·공지사항
   *    API 경로 통일" 리팩터(2026-08-11, BE `d417f12b`)로 폐기됐다 — 옛 경로는 전부 404다.
   *    문서와 코드가 다르면 코드가 맞다(§연동 검증).
   */
  meetingRooms: () => "/api/rooms",
  /** 회의실 한 건 수정(`PATCH`, ROOM-04)·비활성화(`DELETE`, ROOM-05)가 같은 경로를 쓴다. */
  meetingRoom: (id: number) => `/api/rooms/${id}`,
  /**
   * 회의실 주간(월~금) 슬롯 현황(ROOM-02). `meetingRoomId`는 필수, `date`는 생략하면 서버가
   * KST 오늘 기준 주를 채운다(§연동 검증 — 요청 축이 "회의실 1개 × 5일"로, 하루 단위 전체
   * 회의실 조회는 폐기됐다).
   */
  meetingRoomAvailability: (params: { meetingRoomId: number; date?: string }) =>
    `/api/rooms/availability${toQuery(params)}`,

  /**
   * 결제·구독 — [확인] `metering/presentation/api/BillingController.java`
   *   (2026-08-13 BE 실코드 대조, BIL-0~4 커밋). 전부 `@RequestMapping("/api/companies/me")` 아래다.
   *
   * ⚠️ **봉투가 메서드마다 다르다.** 전역으로 감싸 주는 `ResponseBodyAdvice`가 BE에 없어서,
   *    컨트롤러가 `ApiResponse<T>`를 리턴한 것만 봉투가 씌워진다 — 아래 각 항목에 적어 뒀다.
   *    맨몸 응답을 기본값으로 부르면 `raw.data`가 없어 **조용히 `undefined`가 흘러간다**(§정직성).
   * ⚠️ **조회 둘은 로그인이 필요하다**(`isAuthenticated()`). 공개 요금제 화면(`/plans`)은
   *    아래 `publicBillingConfig`(BE PR #461)를 쓴다 — `server.ts`의 주석을 본다.
   */
  /** `GET` · `isAuthenticated()` · **봉투 있음**(`ApiResponse<BillingConfigResponse>`) */
  billingConfig: () => "/api/companies/me/billing-config",
  /**
   * `GET` · **permitAll(비로그인 공개)** · **봉투 있음**(`ApiResponse<BillingConfigResponse>` —
   * 응답 shape은 위 `billingConfig`와 동일하다).
   * [확인] `PublicBillingConfigController` — **BE PR #461**(계약 동결, 미머지).
   * ⚠️ BE #461이 배포되기 전에는 이 경로가 404다 — 호출부(`server.ts`)가 v0 가정값으로
   *    폴백하므로 화면은 안 죽는다(머지·배포 순서 무관).
   */
  publicBillingConfig: () => "/api/billing-config",
  /** `GET` · `isAuthenticated()` · **봉투 있음**(`ApiResponse<BillingOverviewResponse>`) */
  billing: () => "/api/companies/me/billing",
  /**
   * `POST` · OWNER‖admin · ⚠️ **봉투 과도기** — 지금 배포본은 `BillingPaymentActionResult`
   * 맨몸이고, **BE PR #461**부터 `ApiResponse<T>`로 온다. 호출부가 `isEnveloped: false`로
   * 원문을 받고 매퍼(`unwrapTransitionalEnvelope`)가 감지한다 — 배포 확정 후 기본값 경로로 되돌린다.
   * 실패도 200 + `{ isSuccess:false, failureCode }`로 오므로 **HTTP 상태로 가르면 안 된다.**
   */
  subscriptionPay: () => "/api/companies/me/subscription/pay",
  /**
   * `POST` · OWNER‖admin · ⚠️ **봉투 과도기** — 지금 배포본은 `PaymentMethodResponse` 맨몸이고,
   * **BE PR #461**부터 `ApiResponse<T>`로 온다(위 `subscriptionPay`와 같은 처리).
   * ⚠️ **경로가 복수형(`/payment-methods`)이다.** 우리가 보낸 스펙은 단수였는데 BE가 복수로
   *    구현했다 — 문서와 코드가 다르면 코드가 맞다(§연동 검증). 단수로 부르면 404다.
   */
  paymentMethods: () => "/api/companies/me/payment-methods",
  /** `POST` · OWNER‖admin · 본문 `{ isCanceling }` · **봉투 있음**(`ApiResponse<Void>` — `data`가 없다) */
  subscriptionCancel: () => "/api/companies/me/subscription/cancel",

  /* 기타 */
  /**
   * 개인 알림 실시간 구독(SSE) — BFF가 중계하며 토큰을 주입한다.
   * [확인] BE 실코드 대조(2026-08-13) — `notification/presentation/api/NotificationController.java`
   *
   * ⚠️ **수신자를 URL로 안 보낸다.** BE가 토큰의 `memberId`로 스코프를 정한다
   *    (`@AuthenticationPrincipal(expression = "memberId")`) — 쿼리로 받으면 남의 알림을 본다.
   * ⚠️ 이벤트 두 종류: `notification` · `heartbeat`(20초, `{ t }`).
   *    `notification`의 data는 `{ type, payload }`다(`NotificationEvent` 레코드).
   * ⚠️ `type`은 지금 **4종뿐**이다 — `MEETING_CREATED`·`MEETING_REMINDER`·`MEETING_CANCELED`·
   *    `NOTICE_CREATED`(`NotificationType.java`). **분석 완료·실패 이벤트는 아직 없다** —
   *    그래서 요약 진행 카드는 CAP-06(`processingStatus`) 폴링으로 돈다.
   */
  notificationStream: () => "/api/notifications/stream",
  notices: () => "/api/notices",
  /** 공지 상세(`GET`, NOTI-02)·수정(`PUT`, NOTI-04)·삭제(`DELETE`, NOTI-05)가 같은 경로를 쓴다. */
  notice: (noticeId: number) => `/api/notices/${noticeId}`,

  /*
   * 검색 — [확인] `search/presentation/api/SearchController.java` 실코드 대조(2026-08-13).
   *
   * ⚠️ **컨트롤러에 있는 건 `GET /api/v1/search` 하나뿐이다.** 아래 셋(overview·recent-queries·
   *    recent-views)은 2026-08-11에 스펙만 받아 적어 둔 **FE 제안 경로**이고 BE에 매핑이 없다 —
   *    부르면 404다. 지우지 않고 남기는 건 "합의는 있었고 구현이 없다"는 사실까지 잃지 않으려는
   *    것이고, **생기기 전까지 호출하지 않는다**(§환각 API 방지). 호출부는 이 주석을 근거로
   *    비워 뒀다(`features/search/{server,actions}.ts`).
   * ⚠️ `/api/v1/` 접두사는 회의·캡처에서는 폐기됐지만 **검색은 아직 v1이 맞다**
   *    (`@RequestMapping("/api/v1/search")`). 다른 도메인을 따라 떼면 404다.
   */
  searchOverview: () => "/api/v1/search/overview",
  /**
   * 통합 검색(SR-1) — `q`(필수) · `type`(ALL·MEETING·ACTION·PROJECT·PERSON) · `tags` · `from` ·
   * `to` · `limit`. **page는 없다** — 21건째부터 보는 수단이 아직 서버에 없다.
   *
   * ⚠️ **`limit`은 1~50이고 벗어나면 400**(`SearchService.MAX_LIMIT`) — 크게 부르면 결과가
   *    아니라 에러가 온다. 그리고 그 상한은 **종류마다** 걸린다(`type=ALL`이면 4종 × limit).
   * ⚠️ **`tags`·`from`·`to`는 받기만 하고 WHERE에 안 건다**(SR-1 — `SearchJdbcQueryAdapter`에
   *    태그·기간 조건이 아예 없다). 보내도 결과가 안 좁혀진다, SR-2 대기(§연동 검증).
   */
  search: () => "/api/v1/search",
  /*
    ⚠️ **최근 검색어용 엔드포인트는 없다.** 로컬 저장소로 대체했다(`search/lib/recent-search-storage.ts`,
       2026-08-18) — BE에 기록·조회 API가 생겨도 여기 새로 추가할 계약이지 되살릴 상수가 아니다.
  */
  searchRecentViews: () => "/api/v1/search/recent-views",

  /* 시스템 운영자 */
  /**
   * ⚠️ **아무도 안 부른다 — BE에 `system` 패키지 자체가 없다.** `(system)/system/(dashboard)`
   *    화면은 지금 통째로 목이다(CLAUDE.md §라우트 그룹 "목업(더미), 향후 개선"). 실코드가
   *    없는데 부르면 404다 — 검색 3건(`searchOverview` 등)과 같은 이유로, "화면은 있고
   *    연동은 아직"이라는 사실을 남기려 지우지 않고 둔다.
   */
  systemDashboard: () => "/api/system/dashboard",
} as const;
