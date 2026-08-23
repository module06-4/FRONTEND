import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { TeamActionListView } from "@/features/action/components/team-action-list-view";
import { getTeamActionsPage } from "@/features/action/server";
import { roleHome } from "@/features/shell/home";
import { getViewer } from "@/features/shell/viewer";
import { canAccessTeamScope } from "@/lib/permission";

export const metadata: Metadata = {
  title: "팀 액션",
};

/**
 * ⚠️ **첫 페이지만 서버가 렌더**한다(CLAUDE.md §목록·페이지네이션) — 2페이지부터는
 *    `TeamActionListView`가 스크롤 끝에서 서버 액션으로 이어 붙인다. 프로젝트별 묶기는
 *    이어 붙인 전체를 대상으로 화면이 매번 다시 한다(§mapper `groupTeamActionsByProject`).
 * ⚠️ **문을 먼저 보고 데이터를 뒤에 부른다**(owner 대시보드·manage/rooms와 같은 패턴).
 *    `/team/*`은 LEADER 스코프라(§라우트 그룹) Owner·Member는 진입 대상이 아니다 — 가드 없이
 *    `getTeamActionsPage`를 부르면 BE가 팀 액션 목록을 LEADER/MEMBER 전용으로 잠가 놓아
 *    Owner에게 403(`DENIED_FILTER`)이 난다(#614). `requiresParentTeamAction`(non-Owner)이
 *    아니라 `canAccessTeamScope`(LEADER 전용)로 막아야 Member도 조회 전에 걸러진다.
 */
export default async function TeamActionPage() {
  const viewer = await getViewer();
  if (!canAccessTeamScope(viewer)) return <AccessDenied homeHref={roleHome(viewer.role)} />;

  const firstPage = await getTeamActionsPage(viewer.teamName, 0);

  return (
    <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-8 py-7">
      <TeamActionListView
        initialItems={firstPage.items}
        initialPage={firstPage.page}
        initialTotalPages={firstPage.totalPages}
        initialTotalCount={firstPage.totalCount}
        teamName={viewer.teamName}
      />
    </main>
  );
}
