/*
  ⚠️ 회귀 방지 — CLAUDE.md §라우트 그룹: "`/app/my/actions`는 OWNER 접근 불가."
     사이드바에서 OWNER에게 이 항목을 안 보이는데(§nav-config.MEMBER_TOP), 화면 숨김은
     UX일 뿐이고 URL을 직접 치면 통과됐다 — 이 화면의 `canAccessPersonalScope` 가드가
     그 문을 잡는다. 가드가 빠지거나 `canAccessPersonalScope`가 뒤집히면 이 테스트가 잡는다.
     (`/team/action`의 #614 회귀 테스트와 같은 방식.)
*/
jest.mock("server-only", () => ({}));

jest.mock("@/features/shell/viewer", () => ({
  getViewer: jest.fn(),
}));

jest.mock("@/features/shell/home", () => ({
  roleHome: jest.fn(() => "/"),
}));

jest.mock("@/lib/permission", () => ({
  canAccessPersonalScope: jest.fn(),
}));

jest.mock("@/features/action/server", () => ({
  getMyActionsPage: jest.fn(async () => ({
    items: [],
    page: 0,
    totalPages: 1,
    totalCount: 0,
  })),
}));

jest.mock("@/components/common/access-denied", () => ({
  AccessDenied: () => <div data-testid="access-denied" />,
}));

jest.mock("@/features/action/components/my-action-list-view", () => ({
  MyActionListView: () => <div data-testid="my-action-list" />,
}));

import { render, screen } from "@testing-library/react";

import { getMyActionsPage } from "@/features/action/server";
import { getViewer } from "@/features/shell/viewer";
import { canAccessPersonalScope } from "@/lib/permission";

import MyActionsPage from "./page";

describe("/app/my/actions — 개인 스코프 진입 가드", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getViewer as jest.Mock).mockResolvedValue({ role: "member", name: "이하윤" });
  });

  it("LEADER/MEMBER는 내 액션 목록을 본다", async () => {
    (canAccessPersonalScope as jest.Mock).mockReturnValue(true);

    const ui = await MyActionsPage();
    render(ui);

    expect(screen.getByTestId("my-action-list")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("OWNER는 조회 전에 AccessDenied로 막고 목록 조회를 안 부른다", async () => {
    (getViewer as jest.Mock).mockResolvedValue({ role: "owner", name: "대표 계정" });
    (canAccessPersonalScope as jest.Mock).mockReturnValue(false);

    const ui = await MyActionsPage();
    render(ui);

    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("my-action-list")).not.toBeInTheDocument();
    // ⚠️ 가드에 막혔으면 목록 조회가 아예 안 나가야 한다(빈 목록으로라도 조용히 통과 금지)
    expect(getMyActionsPage).not.toHaveBeenCalled();
  });
});
