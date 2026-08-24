import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { MyActionListView } from "@/features/action/components/my-action-list-view";
import { getMyActionsPage } from "@/features/action/server";
import { roleHome } from "@/features/shell/home";
import { getViewer } from "@/features/shell/viewer";
import { canAccessPersonalScope } from "@/lib/permission";

export const metadata: Metadata = {
  title: "내 액션",
};

/**
 * ⚠️ **첫 페이지만 서버가 렌더**한다(CLAUDE.md §목록·페이지네이션) — 2페이지부터는
 *    `MyActionListView`가 스크롤 끝에서 서버 액션으로 이어 붙인다. 화면 전체를
 *    `use client`로 만들면 조회 전체가 클라이언트로 넘어간다(§핵심 4원칙 ①).
 * ⚠️ **OWNER는 못 들어간다**(CLAUDE.md §라우트 그룹, `/my/(dashboard)`와 같은 패턴).
 *    사이드바가 OWNER에게 이 항목을 안 보이지만, 화면 숨김은 UX일 뿐이고 URL을 직접
 *    치면 통과된다 — 화면 쪽 가드는 여기서 잡는다(§권한: 화면 숨김은 보안이 아니다).
 *    이 자리는 `permission.ts`가 `canAccessPersonalScope`로 이미 준비해 두었다.
 * ⚠️ `assigneeName`은 `getViewer()`에서 받는다 — 여기서 이름을 하드코딩하면 누가 보든
 *    같은 사람의 개인 액션이 뜬다(§소유권, `getMyActionBoard`와 같은 종류의 지뢰).
 */
export default async function MyActionsPage() {
  const viewer = await getViewer();
  if (!canAccessPersonalScope(viewer)) return <AccessDenied homeHref={roleHome(viewer.role)} />;

  const firstPage = await getMyActionsPage(viewer.name, 0);

  return (
    <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-8 py-7">
      <MyActionListView
        initialItems={firstPage.items}
        initialPage={firstPage.page}
        initialTotalPages={firstPage.totalPages}
        initialTotalCount={firstPage.totalCount}
        assigneeName={viewer.name}
      />
    </main>
  );
}
