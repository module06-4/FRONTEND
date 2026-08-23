/**
 * 액션 목록 서버 페이지네이션 — mock 분기(§목록·페이지네이션).
 * ⚠️ 실서버 분기는 여기서 못 돈다(세션·BE 필요) — 봉투 필드명은 server.ts의 [확인] 주석이
 *    BE `global/response/PageResponse.java`와 대조한다. 여기서는 mock이 실서버와 같은
 *    계약(0-base page·서버 정렬·전체 건수)으로 자르는지를 못박는다.
 */
import { groupMyActionsByProject, groupTeamActionsByProject, toTeamActionListItem } from "./mapper";
import { getMyActionsPage, getTeamActionsPage } from "./server";

const ASSIGNEE = "이하윤";
const TEAM = "개발팀";

describe("내 액션 목록 한 페이지 (getMyActionsPage)", () => {
  it("마감 임박순(dueDate asc)으로 정렬해 돌려준다 — 서버 정렬과 같은 순서", async () => {
    const result = await getMyActionsPage(ASSIGNEE, 0);
    const dueDates = result.items.map((item) => item.dueDate);
    expect(dueDates).toEqual([...dueDates].sort((a, b) => a.localeCompare(b)));
  });

  it("페이지 크기대로 자르고, totalCount는 화면에 그린 줄 수가 아니라 전체를 센다", async () => {
    const whole = await getMyActionsPage(ASSIGNEE, 0, 9999);
    const first = await getMyActionsPage(ASSIGNEE, 0, 1);
    expect(first.page).toBe(0); // 0-base(BE 표준 확정, 2026-08-10)
    expect(first.items.length).toBeLessThanOrEqual(1);
    expect(first.totalCount).toBe(whole.totalCount); // 자른다고 전체 건수가 줄지 않는다
    expect(first.totalPages).toBe(Math.ceil(first.totalCount / 1));
  });

  it("없는 담당자면 빈 목록 — 전체 건수도 0이다", async () => {
    const result = await getMyActionsPage("없는사람", 0);
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});

describe("팀 액션 목록 한 페이지 (getTeamActionsPage)", () => {
  it("평평한 목록으로 온다 — 줄마다 프로젝트 정보를 갖고 있어 화면이 다시 묶을 수 있다", async () => {
    const result = await getTeamActionsPage(TEAM, 0);
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.projectId).toEqual(expect.any(Number));
      expect(item.projectName).not.toBe("");
      expect(item.projectTag).not.toBe("");
    }
  });

  it("마감 임박순으로 자르고 totalCount는 페이지가 바뀌어도 같다", async () => {
    const first = await getTeamActionsPage(TEAM, 0, 2);
    const second = await getTeamActionsPage(TEAM, 1, 2);
    expect(first.totalCount).toBe(second.totalCount);
    expect(first.totalPages).toBe(Math.ceil(first.totalCount / 2));
    const dueDates = first.items.map((item) => item.dueDate);
    expect(dueDates).toEqual([...dueDates].sort((a, b) => a.localeCompare(b)));
  });

  it("다음 페이지는 앞 페이지와 id가 겹치지 않는다 — 이어 붙일 때 중복이 없다", async () => {
    const first = await getTeamActionsPage(TEAM, 0, 2);
    const second = await getTeamActionsPage(TEAM, 1, 2);
    expect(first.items).toHaveLength(2);
    expect(second.page).toBe(1);
    expect(second.items.length).toBeGreaterThan(0);
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.some((item) => firstIds.has(item.id))).toBe(false);
  });
});

describe("프로젝트별 다시 묶기 (mapper)", () => {
  const item = (id: number, projectId: number, dueDate: string) => ({
    id,
    name: `액션 ${id}`,
    startDate: "2026-08-01",
    dueDate,
    status: "TODO" as const,
    projectId,
    projectName: `프로젝트 ${projectId}`,
    projectTag: `TAG-${projectId}`,
  });

  it("첫 등장 순서가 그룹 순서다 — 목록 순서를 흩뜨리지 않는다", () => {
    const groups = groupTeamActionsByProject([
      item(1, 10, "2026-08-13"),
      item(2, 20, "2026-08-14"),
      item(3, 10, "2026-08-15"),
    ]);
    expect(groups.map((g) => g.projectId)).toEqual([10, 20]);
    expect(groups[0]?.teamActions.map((a) => a.id)).toEqual([1, 3]);
  });

  it("페이지가 이어 붙으면 이미 있던 그룹이 자란다 — 새 그룹으로 쪼개지 않는다", () => {
    const firstPage = [item(1, 10, "2026-08-13"), item(2, 20, "2026-08-14")];
    const appended = [...firstPage, item(3, 10, "2026-08-15")];
    expect(groupTeamActionsByProject(firstPage)[0]?.teamActions).toHaveLength(1);
    const regrouped = groupTeamActionsByProject(appended);
    expect(regrouped).toHaveLength(2);
    expect(regrouped[0]?.teamActions).toHaveLength(2);
  });

  it("내 액션도 같은 규칙 — projectId로 묶고 그룹 안 순서를 유지한다", async () => {
    const { items } = await getMyActionsPage(ASSIGNEE, 0);
    const groups = groupMyActionsByProject(items);
    const regroupedIds = groups.flatMap((g) => g.actions.map((a) => a.id)).sort();
    expect(regroupedIds).toEqual(items.map((a) => a.id).sort());
    for (const group of groups) {
      for (const action of group.actions) expect(action.projectId).toBe(group.projectId);
    }
  });

  it("BE 한 줄 → 평평한 UI 계약 — null 프로젝트명·태그는 빈 문자열, 시작일 null은 채운다", () => {
    const mapped = toTeamActionListItem({
      id: 7,
      actionType: "TEAM",
      title: "설계 검토",
      description: "",
      status: "IN_PROGRESS",
      startDate: null,
      /* 사람이 검토 화면에서 정한 예정 시작일 — `startDate`가 비면 이 값을 먼저 쓴다(#416) */
      plannedStartDate: "2026-08-18",
      dueDate: "2026-08-20",
      needsReview: false,
      isDelayed: false,
      assigneeName: null,
      projectId: 3,
      projectTag: null,
      projectName: null,
      teamName: "개발팀",
      sourceMeetingTitle: null,
      parentActionId: null,
      parentActionTitle: null,
      childDoneCount: 3,
      childTotalCount: 5,
    });
    expect(mapped).toMatchObject({
      id: 7,
      name: "설계 검토",
      dueDate: "2026-08-20",
      projectId: 3,
      projectName: "",
      projectTag: "",
      /* 진척 값은 그룹핑까지 그대로 실려 가야 한다 — 게이지 UI(#421)가 이 값을 쓴다 */
      childDoneCount: 3,
      childTotalCount: 5,
    });
    /*
      ⚠️ **날짜를 지어내지 않는다**(#416). `startDate`가 비어도 예정 시작일이 있으면 그 값이지,
         fallback의 "내일"이 아니다 — 실값 위에 가짜를 얹던 것이 #416에서 고쳐졌다.
    */
    expect(mapped.startDate).toBe("2026-08-18");
  });
});
