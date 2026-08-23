jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/mocks/config", () => ({ isMock: false }));
jest.mock("@/features/auth/session", () => ({ requireAccessToken: jest.fn() }));
jest.mock("@/features/shell/viewer", () => ({ getViewer: jest.fn() }));
jest.mock("./server", () => ({
  getTeamHandoverDetail: jest.fn(),
}));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  serverApi: jest.fn(),
}));

import { AUTHORITY } from "@/constants/authority";
import { requireAccessToken } from "@/features/auth/session";
import { getViewer } from "@/features/shell/viewer";
import { serverApi } from "@/lib/api";

import { completeTeamHandoverAction, rejectTeamHandoverAction } from "./actions";
import { getTeamHandoverDetail } from "./server";

/**
 * 팀장 중간승인 확정·반려 — **실서버 팀 스코프 권한 판정**.
 *
 * ⚠️ 회귀 테스트다 — 두 액션 다 `getTeamHandoverDetail`만 부르고 승인자가 그 팀 소속인지는
 *    전혀 안 봐서, 다른 팀 LEADER도 이 팀의 인수인계서를 승인·반려할 수 있던 구멍이 있었다.
 *    `canApproveMid(viewer, { teamId: handover.teamId })`로 막았다.
 * ⚠️ **BE도 같은 구멍이 있다**(`HandoverService.complete/reject`가 companyId·teamId를
 *    전혀 안 봄) — 이건 FE 1차 가드일 뿐, 진짜 방어선은 BE 수정이다.
 */

const requireAccessTokenMock = requireAccessToken as unknown as jest.Mock;
const getViewerMock = getViewer as unknown as jest.Mock;
const getTeamHandoverDetailMock = getTeamHandoverDetail as unknown as jest.Mock;
const serverApiMock = serverApi as unknown as jest.Mock;

const HANDOVER = {
  handoverId: 55,
  memberId: 3,
  memberName: "이하윤",
  teamId: 10,
  type: "VACATION",
  period: { from: "2026-09-01", to: "2026-09-15" },
  actionCount: 1,
  actions: [
    {
      id: 101,
      projectTag: "GOODS",
      parentTeamActionName: "앱 개발 착수",
      title: "온보딩 플로우 와이어프레임 검토",
      status: "IN_PROGRESS",
      startDate: "2026-08-01",
      dueDate: "2026-09-10",
    },
  ],
  teammates: [{ id: 4, name: "박도현", position: "사원", role: "프론트엔드" }],
};

const SAME_TEAM_LEADER = { id: 2, role: AUTHORITY.LEADER, teamId: 10, teamName: "개발팀" };
const OTHER_TEAM_LEADER = { id: 6, role: AUTHORITY.LEADER, teamId: 20, teamName: "마케팅팀" };

beforeEach(() => {
  jest.clearAllMocks();
  requireAccessTokenMock.mockResolvedValue("token");
  getTeamHandoverDetailMock.mockResolvedValue(HANDOVER);
});

describe("completeTeamHandoverAction — 실서버 팀 스코프 권한 판정", () => {
  it("같은 팀 LEADER면 통과해 BE를 부른다", async () => {
    getViewerMock.mockResolvedValue(SAME_TEAM_LEADER);
    serverApiMock.mockResolvedValue({});

    const result = await completeTeamHandoverAction(55, [{ actionId: 101, assigneeId: 4 }]);

    expect(result.isSuccess).toBe(true);
    expect(serverApiMock).toHaveBeenCalled();
  });

  it("다른 팀 LEADER면 BE를 부르지 않고 막는다", async () => {
    getViewerMock.mockResolvedValue(OTHER_TEAM_LEADER);

    const result = await completeTeamHandoverAction(55, [{ actionId: 101, assigneeId: 4 }]);

    expect(result.isSuccess).toBe(false);
    expect(result.message).toBe("이 인수인계서를 승인할 권한이 없습니다");
    expect(serverApiMock).not.toHaveBeenCalled();
  });

  /* ⚠️ 회귀 테스트다(2026-08-15, #558) — getTeamHandoverDetail() 실패로 페이지가 죽던 사고. */
  it("인수인계서 조회가 실패해도 페이지를 죽이지 않고 오류로 돌려준다", async () => {
    getViewerMock.mockResolvedValue(SAME_TEAM_LEADER);
    getTeamHandoverDetailMock.mockRejectedValue(new Error("network down"));

    const result = await completeTeamHandoverAction(55, [{ actionId: 101, assigneeId: 4 }]);

    expect(result.isSuccess).toBe(false);
    expect(result.message).toBeDefined();
    expect(serverApiMock).not.toHaveBeenCalled();
  });
});

describe("rejectTeamHandoverAction — 실서버 팀 스코프 권한 판정", () => {
  it("같은 팀 LEADER면 통과해 BE를 부른다", async () => {
    getViewerMock.mockResolvedValue(SAME_TEAM_LEADER);
    serverApiMock.mockResolvedValue({});

    const result = await rejectTeamHandoverAction(55, "기간이 부적절합니다");

    expect(result.isSuccess).toBe(true);
    expect(serverApiMock).toHaveBeenCalledTimes(1);
  });

  it("다른 팀 LEADER면 BE를 부르지 않고 막는다", async () => {
    getViewerMock.mockResolvedValue(OTHER_TEAM_LEADER);

    const result = await rejectTeamHandoverAction(55, "기간이 부적절합니다");

    expect(result.isSuccess).toBe(false);
    expect(result.message).toBe("이 인수인계서를 반려할 권한이 없습니다");
    expect(serverApiMock).not.toHaveBeenCalled();
  });

  /* ⚠️ 회귀 테스트다(2026-08-15, #558) — getTeamHandoverDetail() 실패로 페이지가 죽던 사고. */
  it("인수인계서 조회가 실패해도 페이지를 죽이지 않고 오류로 돌려준다", async () => {
    getViewerMock.mockResolvedValue(SAME_TEAM_LEADER);
    getTeamHandoverDetailMock.mockRejectedValue(new Error("network down"));

    const result = await rejectTeamHandoverAction(55, "기간이 부적절합니다");

    expect(result.isSuccess).toBe(false);
    expect(result.message).toBeDefined();
    expect(serverApiMock).not.toHaveBeenCalled();
  });
});
