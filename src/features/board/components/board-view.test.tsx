/**
 * 보드 렌더링·낙관적 저장 회귀.
 *
 * ⚠️ 다른 5화면(내 액션·팀 액션·마이페이지·캘린더·프로젝트 타임라인)은 이미 EmptyState +
 *    명시 문구로 정직한 빈 상태를 그리는데, 보드만 예전에는 세 칸이 각기 "여기로 옮겨
 *    주세요."를 띄워 옮길 카드가 어딘가 있는 것처럼 읽혔다(§CLAUDE.md 정직성 위반).
 *    2026-08-16에 페이지 레벨 EmptyState로 통일. 여기서 못박아, 다시 세 칸이 텅 빈 채로
 *    뜨는 회귀가 오면 즉시 잡는다.
 * ⚠️ 낙관적 저장 회귀(#686) — 예전엔 [저장하기] 버튼 + `ConfirmDialog` + `BoardLeaveGuard`로
 *    배치 저장이었다. 지금은 드롭 즉시 저장이고, 실패했을 때만 원위치 + 토스트다. 저장
 *    버튼이 다시 뜨거나 실패 시 토스트가 안 뜨면 이 파일이 잡는다.
 */
jest.mock("../actions", () => ({
  commitBoardChangesAction: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { commitBoardChangesAction } from "../actions";
import type { BoardCard } from "../types";
import { BoardView } from "./board-view";

const TODAY = "2026-08-16";
const mockCommit = commitBoardChangesAction as jest.MockedFunction<typeof commitBoardChangesAction>;

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 1,
    title: "설계 검토",
    tagLabel: "GOODS",
    tagBgColor: "var(--tag-sky-bg)",
    tagTextColor: "var(--tag-sky-fg)",
    startDate: "2026-08-10",
    dueDate: "2026-08-20",
    isDone: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockCommit.mockReset();
  mockCommit.mockResolvedValue({ appliedCount: 1 });
  (toast.error as jest.Mock).mockReset();
});

describe("BoardView — 페이지 레벨 empty state", () => {
  it("cards가 0건이면 EmptyState 안내가 뜨고 세 칸은 안 뜬다", () => {
    render(<BoardView boardType="my-action" cards={[]} todayIso={TODAY} />);

    expect(screen.getByText("아직 하달된 액션이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("액션이 하달되면 이 자리에 카드로 쌓입니다.")).toBeInTheDocument();
    expect(screen.queryByText(/드래그해서 칸을 옮길 수 있습니다/)).not.toBeInTheDocument();

    /*
      ⚠️ 세 칸이 나타나면 회귀다 — 예전 렌더가 되돌아온 것이다. 칸 라벨(할 일·진행중·완료)이
         안 뜨는지 함께 확인한다.
    */
    expect(screen.queryByText("할 일")).not.toBeInTheDocument();
    expect(screen.queryByText("진행중")).not.toBeInTheDocument();
    expect(screen.queryByText("완료")).not.toBeInTheDocument();
    expect(screen.queryByText("여기로 옮겨 주세요.")).not.toBeInTheDocument();
  });

  it("cards가 하나라도 있으면 empty 문구는 안 뜨고 세 칸이 그대로 온다", () => {
    render(<BoardView boardType="my-action" cards={[card()]} todayIso={TODAY} />);

    expect(screen.queryByText("아직 하달된 액션이 없습니다.")).not.toBeInTheDocument();
    expect(screen.getByText("할 일")).toBeInTheDocument();
    expect(screen.getByText("진행중")).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
  });
});

describe("BoardView — 낙관적 UI + 즉시 저장(#686)", () => {
  /*
    ⚠️ **[저장하기] 버튼 회귀 방지.** 예전엔 여기 있었는데, 낙관적 저장으로 바뀌면서 사라졌다 —
       다시 나타나면 배치 저장으로 되돌아간 것이라 즉시 잡는다.
  */
  it("[저장하기] 버튼은 뜨지 않는다 — 저장 확인 단계가 없다", () => {
    render(<BoardView boardType="my-action" cards={[card()]} todayIso={TODAY} />);
    expect(screen.queryByRole("button", { name: /저장/ })).not.toBeInTheDocument();
  });

  it("[옮기기] 버튼을 누르면 서버 액션이 즉시 호출된다 — 저장 확인 단계 없이", async () => {
    const user = userEvent.setup();
    const todoCard = card({ title: "예정 작업", startDate: "2026-08-20" });
    render(<BoardView boardType="my-action" cards={[todoCard]} todayIso={TODAY} />);

    await user.click(screen.getByRole("button", { name: "진행중으로 옮기기" }));

    await waitFor(() =>
      expect(mockCommit).toHaveBeenCalledWith("my-action", [{ id: 1, toColumn: "IN_PROGRESS" }]),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("boardType이 project면 그대로 project 액션으로 나간다", async () => {
    const user = userEvent.setup();
    const todoCard = card({ title: "예정 작업", startDate: "2026-08-20" });
    render(<BoardView boardType="project" cards={[todoCard]} todayIso={TODAY} />);

    await user.click(screen.getByRole("button", { name: "진행중으로 옮기기" }));

    await waitFor(() =>
      expect(mockCommit).toHaveBeenCalledWith("project", [{ id: 1, toColumn: "IN_PROGRESS" }]),
    );
  });

  it("액션이 던지면 실패 토스트가 뜬다 — 낙관적 값은 트랜지션 종료 시 자동으로 원위치된다", async () => {
    const user = userEvent.setup();
    mockCommit.mockRejectedValue(new Error("network"));
    const todoCard = card({ title: "예정 작업", startDate: "2026-08-20" });
    render(<BoardView boardType="my-action" cards={[todoCard]} todayIso={TODAY} />);

    await user.click(screen.getByRole("button", { name: "진행중으로 옮기기" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("옮기지 못했습니다"));
  });

  it("appliedCount이 0이면 실패 토스트가 뜬다 — 예외를 안 던져도 반영 실패는 알린다", async () => {
    const user = userEvent.setup();
    mockCommit.mockResolvedValue({ appliedCount: 0 });
    const todoCard = card({ title: "예정 작업", startDate: "2026-08-20" });
    render(<BoardView boardType="my-action" cards={[todoCard]} todayIso={TODAY} />);

    await user.click(screen.getByRole("button", { name: "진행중으로 옮기기" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("옮기지 못했습니다"));
  });
});

/*
  ⚠️ 회귀 방지(#609) — DnD 보드가 `PointerSensor`만 걸려 있어 키보드·스크린리더로는 카드를
     옮길 방법이 없었다(CLAUDE.md §a11y "DnD 보드는 키보드 대체 경로 필수" 위반). 카드마다
     [옮기기] 버튼을 대체 경로로 붙였다 — 드래그와 같은 `canMoveCard` 규칙을 타므로 버튼도
     같은 세 가지 전이(할 일→진행중·진행중→완료·완료→진행중)만 낸다.
*/
/** 카드는 옮겨지면 다른 칸(다른 부모)으로 리마운트된다 — 매번 다시 찾아야 한다. */
function findCard(title: string): HTMLElement {
  return screen.getByText(title).closest('[class*="rounded-[20px]"]') as HTMLElement;
}

describe("BoardCard — 키보드 대체 경로 [옮기기] 버튼(#609)", () => {
  it("할 일 카드에는 [진행중으로 옮기기] 버튼만 뜬다", () => {
    const todoCard = card({ title: "예정 작업", startDate: "2026-08-20" });
    render(<BoardView boardType="my-action" cards={[todoCard]} todayIso={TODAY} />);

    expect(
      within(findCard("예정 작업")).getByRole("button", { name: "진행중으로 옮기기" }),
    ).toBeInTheDocument();
    expect(
      within(findCard("예정 작업")).queryByRole("button", { name: /할 일로 옮기기/ }),
    ).not.toBeInTheDocument();
    expect(
      within(findCard("예정 작업")).queryByRole("button", { name: /완료로 옮기기/ }),
    ).not.toBeInTheDocument();
  });

  it("진행중 카드에는 [완료로 옮기기] 버튼만 뜬다 — 할 일로는 못 간다(canMoveCard)", () => {
    const inProgressCard = card({ title: "진행 중 작업", startDate: "2026-08-10" });
    render(<BoardView boardType="my-action" cards={[inProgressCard]} todayIso={TODAY} />);

    expect(
      within(findCard("진행 중 작업")).getByRole("button", { name: "완료로 옮기기" }),
    ).toBeInTheDocument();
    expect(
      within(findCard("진행 중 작업")).queryByRole("button", { name: /할 일로 옮기기/ }),
    ).not.toBeInTheDocument();
  });

  it("완료 카드에는 [진행중으로 옮기기] 버튼만 뜬다 — 할 일로는 못 간다", () => {
    const doneCard = card({ title: "끝난 작업", isDone: true });
    render(<BoardView boardType="my-action" cards={[doneCard]} todayIso={TODAY} />);

    expect(
      within(findCard("끝난 작업")).getByRole("button", { name: "진행중으로 옮기기" }),
    ).toBeInTheDocument();
    expect(
      within(findCard("끝난 작업")).queryByRole("button", { name: /할 일로 옮기기/ }),
    ).not.toBeInTheDocument();
  });
});
