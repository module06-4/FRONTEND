import type { Metadata } from "next";

import { AccessDenied } from "@/components/common/access-denied";
import { BillingView } from "@/features/billing/components/billing-view";
import { getBillingConfig, getBillingOverview } from "@/features/billing/server";
import { roleHome } from "@/features/shell/home";
import { getViewer } from "@/features/shell/viewer";
import { canAccessManageScope } from "@/lib/permission";
import { canManageBilling } from "@/lib/permission";

export const metadata: Metadata = {
  title: "구독",
};

/*
  ⚠️ **정적으로 굳히지 않는다.** 회사마다 다른 권한으로 보는 화면이라 한 벌을 미리 구워
     돌려쓸 수 없다. `getViewer()`가 쿠키를 읽어 저절로 동적이 되지만, 신호가 안 잡히는
     경우를 위해 명시해 둔다.
*/
export const dynamic = "force-dynamic";

/**
 * 구독 — 지금 무엇을 얼마에 쓰는지 보고, 플랜·결제 수단을 바꾸고, 지난 결제를 확인한다.
 *
 * ⚠️ 조회는 **Server Component**가 한다 — `useEffect` 페칭을 쓰지 않는다(CLAUDE.md §렌더링).
 * ⚠️ **OWNER 또는 Admin 겸직자만** 볼 수 있다. 판정은 `canManageBilling` 한 곳이 한다 —
 *    화면 숨김은 UX일 뿐 보안이 아니다(§권한).
 * ⚠️⚠️ **2026-08-14 — 결제 전 회사를 여기서 돌려보내던 문을 없앴다.** 그 문은 실서버
 *    `getBillingOverview`가 결제 전 회사에게 404를 던지는 걸 막기 위한 것이었는데,
 *    지금은 이 도메인 전체가 더미라 그 404가 날 수 없다(`server.ts` 주석 참고) —
 *    실 연동을 되돌릴 때 이 자리에 그 가드를 다시 둔다.
 */
export default async function OwnerBillingPage() {
  /* ⚠️ 문(권한)을 먼저 본다 — 돈이 걸린 화면이라 판정 전 조회를 한 번도 내보내지 않는다(§권한) */
  const viewer = await getViewer();
  if (!canAccessManageScope(viewer)) return <AccessDenied homeHref={roleHome(viewer.role)} />;

  const [overview, config] = await Promise.all([getBillingOverview(), getBillingConfig()]);

  const canManage = canManageBilling(viewer);

  return (
    <BillingView
      overview={overview}
      config={config}
      canManage={canManage}
      companyId={viewer.companyId}
    />
  );
}
