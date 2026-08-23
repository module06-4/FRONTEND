import type { Metadata } from "next";

import { MyActionListView } from "@/features/action/components/my-action-list-view";
import { getMyActionsPage } from "@/features/action/server";
import { getViewer } from "@/features/shell/viewer";

export const metadata: Metadata = {
  title: "내 액션",
};

/**
 * ⚠️ **첫 페이지만 서버가 렌더**한다(CLAUDE.md §목록·페이지네이션) — 2페이지부터는
 *    `MyActionListView`가 스크롤 끝에서 서버 액션으로 이어 붙인다. 화면 전체를
 *    `use client`로 만들면 조회 전체가 클라이언트로 넘어간다(§핵심 4원칙 ①).
 * ⚠️ `assigneeName`은 `getViewer()`에서 받는다 — 이 경로는 `/app/*` 공용 워크벤치라
 *    목 모드 기본값은 대표(OWNER)다(`viewer.ts`의 `mockRoleFor`, `?as=member`로 미리보기
 *    가능). 여기서 이름을 "이하윤"으로 하드코딩해 두면 **누가 보든 항상 이하윤의 개인
 *    액션**이 뜬다 — 화면이 지금 보고 있는 사람과 다른 사람의 데이터를 보여주는
 *    것이라 실제 소유권 버그다(`getMyActionBoard`와 같은 종류의 지뢰).
 */
export default async function MyActionsPage() {
  const viewer = await getViewer();
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
