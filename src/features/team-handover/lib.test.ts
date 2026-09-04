import { ACTION_STATUS } from "@/constants/domain";
import { pickPaletteColor } from "@/lib/palette";

import { buildTimelineInput, isReadyToComplete, toAssignmentList } from "./lib";
import type { TeamHandoverAction } from "./types";

/**
 * `team-handover/lib.ts` 회귀 방지 — 인접한 `mapper.test.ts`와 짝을 이룬다.
 * ⚠️ `isReadyToComplete` 스펙은 **CodeRabbit 2026-08-09 지적**(lib.ts L24-29)이 근거다 —
 *    액션 0건도 확정 가능해야 서버(`completeTeamHandoverAction`)와 판정이 어긋나지 않는다.
 */

function action(patch: Partial<TeamHandoverAction> = {}): TeamHandoverAction {
  return {
    id: 1,
    projectTag: "GOODS",
    parentTeamActionName: "상위 액션",
    title: "액션 제목",
    status: ACTION_STATUS.TODO,
    startDate: "2026-08-01",
    dueDate: "2026-08-20",
    ...patch,
  };
}

describe("buildTimelineInput — 액션 → 타임라인 입력", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("빈 배열은 빈 배열로 돌려준다", () => {
    expect(buildTimelineInput([])).toEqual([]);
  });

  it("id를 문자열로 바꾸고 태그·제목·기간을 그대로 옮긴다", () => {
    const result = buildTimelineInput([
      action({
        id: 42,
        projectTag: "GOODS",
        title: "제품 리서치 마무리",
        startDate: "2026-08-05",
        dueDate: "2026-08-15",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "42",
      tag: "GOODS",
      title: "제품 리서치 마무리",
      startDate: "2026-08-05",
      dueDate: "2026-08-15",
    });
  });

  it("색은 프로젝트 태그로 결정된다 — 같은 태그면 같은 색(§palette)", () => {
    const [a, b] = buildTimelineInput([
      action({ id: 1, projectTag: "GOODS" }),
      action({ id: 2, projectTag: "GOODS" }),
    ]);
    const expected = pickPaletteColor("GOODS");

    expect(a?.tagBgColor).toBe(expected.bgColor);
    expect(a?.tagTextColor).toBe(expected.textColor);
    expect(b?.tagBgColor).toBe(a?.tagBgColor);
  });

  describe("tone 판정 — 지연은 진행중일 때만 (WORKFLOW.md §7 · isDelayed)", () => {
    it("진행중 + 마감 경과 → `DELAYED`", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-08-20T09:00:00"));

      const [row] = buildTimelineInput([
        action({ status: ACTION_STATUS.IN_PROGRESS, dueDate: "2026-08-10" }),
      ]);
      expect(row?.tone).toBe("DELAYED");
    });

    it("진행중 + 마감 미도래 → 상태 그대로(`IN_PROGRESS`)", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-08-20T09:00:00"));

      const [row] = buildTimelineInput([
        action({ status: ACTION_STATUS.IN_PROGRESS, dueDate: "2026-08-25" }),
      ]);
      expect(row?.tone).toBe(ACTION_STATUS.IN_PROGRESS);
    });

    /*
      ⚠️ 할 일은 마감이 지났어도 지연이 아니다(WORKFLOW.md §7). "진행중 한정" 규칙이 뒤집혀
         `status !== DONE`으로 되돌아가면 할 일 배지가 조용히 빨갛게 바뀐다.
    */
    it("할 일 + 마감 경과여도 지연이 아니다 — 상태 그대로(`TODO`)", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-08-20T09:00:00"));

      const [row] = buildTimelineInput([
        action({ status: ACTION_STATUS.TODO, dueDate: "2026-08-10" }),
      ]);
      expect(row?.tone).toBe(ACTION_STATUS.TODO);
    });

    it("완료 + 마감 경과여도 지연이 아니다 — 상태 그대로(`DONE`)", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-08-20T09:00:00"));

      const [row] = buildTimelineInput([
        action({ status: ACTION_STATUS.DONE, dueDate: "2026-08-10" }),
      ]);
      expect(row?.tone).toBe(ACTION_STATUS.DONE);
    });
  });
});

describe("isReadyToComplete — [인수인계 확정] 버튼 활성 조건", () => {
  /*
    ⚠️ **CodeRabbit 2026-08-09 지적 회귀 방지** (lib.ts L24-29).
       액션이 0건이면 `every`가 참이라 서버·클라 판정이 자동으로 맞는다. 여기서만 `length > 0`을
       더 걸면 사용자에겐 버튼이 영영 안 눌리는데 서버는 통과해 불일치가 생긴다. 이 케이스가
       회귀 방지선의 핵심이다.
  */
  it("액션이 0건이면 배정도 0건이라도 확정 가능(true) — 서버와 판정 일치", () => {
    expect(isReadyToComplete([], {})).toBe(true);
  });

  it("모든 액션이 배정되면 true", () => {
    const actions = [action({ id: 1 }), action({ id: 2 })];
    expect(isReadyToComplete(actions, { 1: 100, 2: 200 })).toBe(true);
  });

  it("하나라도 배정 안 되면 false", () => {
    const actions = [action({ id: 1 }), action({ id: 2 })];
    expect(isReadyToComplete(actions, { 1: 100 })).toBe(false);
  });

  it("배정이 아예 없으면 false — 액션은 있는데 맵이 빈 경우", () => {
    const actions = [action({ id: 1 })];
    expect(isReadyToComplete(actions, {})).toBe(false);
  });

  /*
    ⚠️ 판정 기준이 `!== undefined`라 assignee id가 `0`이어도 "배정된 것"으로 인정된다.
       담당자 id 0이 시스템에 없다는 별개의 검증은 서버 몫이다(경계 분리).
  */
  it("assignee id가 0이어도 배정으로 인정한다 (`!== undefined` 기준)", () => {
    const actions = [action({ id: 1 })];
    expect(isReadyToComplete(actions, { 1: 0 })).toBe(true);
  });
});

describe("toAssignmentList — 배정 맵 → 서버로 보낼 배열", () => {
  it("빈 맵은 빈 배열", () => {
    expect(toAssignmentList({})).toEqual([]);
  });

  /*
    ⚠️ Object.entries 키는 항상 문자열이라 `actionId`가 문자열로 새 나가면 서버가 400을 준다 —
       `Number(actionId)`가 반드시 걸려야 한다.
  */
  it("문자열 키를 숫자 `actionId`로 바꿔서 담는다", () => {
    const result = toAssignmentList({ 11: 100, 22: 200 });

    expect(result).toEqual(
      expect.arrayContaining([
        { actionId: 11, assigneeId: 100 },
        { actionId: 22, assigneeId: 200 },
      ]),
    );
    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(typeof item.actionId).toBe("number");
      expect(typeof item.assigneeId).toBe("number");
    }
  });
});
