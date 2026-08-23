import { ChevronRight, ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { HANDOVER_TYPE_LABEL } from "@/constants/domain";
import { roleHome } from "@/features/shell/home";
import { getViewer } from "@/features/shell/viewer";
import { listTeamHandovers } from "@/features/team-handover/server";
import { formatMonthDayWeekday } from "@/lib/date";
import { canAccessTeamScope } from "@/lib/permission";

export const metadata: Metadata = {
  title: "인수인계서 관리",
};

/**
 * 팀원(신청자) 인수인계서 목록 — 팀장 중간 승인을 기다리는 신청만 보인다
 * (WORKFLOW.md §7). 이미 중간 승인된 건은 오너의 최종 승인 대기로 넘어가 여기서 할 일이 없다.
 */
export default async function TeamHandoverPage() {
  const viewer = await getViewer();
  if (!canAccessTeamScope(viewer)) return <AccessDenied homeHref={roleHome(viewer.role)} />;

  const items = await listTeamHandovers(viewer.teamName, viewer.id);

  return (
    <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-8 py-7">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
        <div className="border-border bg-card overflow-hidden rounded-2xl border">
          {/*
            ⚠️ **머리를 붙인다**(2026-08-11). 표 머리 띠로 카드가 바로 시작해 무엇을 보는
               목록인지 화면에 적힌 데가 없었다 — 오너 쪽 같은 목록(`/owner/leader-handovers`)은
               제목과 건수를 이고 있는데 여기만 없어 두 화면이 다른 물건처럼 보였다.
            ⚠️ 건수는 `전체`다. 여기는 거르개가 없어 **탭으로 거른 수가 아니다** — 오너 쪽이
               `결과`인 것과 갈리는 지점이다(§목록: 거른 수를 `전체`라 부르면 거짓말이 된다).
          */}
          <div className="flex items-baseline justify-between gap-3 px-7 pt-6 pb-3">
            <h2 className="text-[17px] leading-7 font-semibold tracking-[-0.3px]">
              승인 대기 인수인계서
            </h2>
            <p className="text-muted-foreground shrink-0 text-[12px] leading-4 tabular-nums">
              전체 {items.length}건
            </p>
          </div>

          {/*
            표 머리 — 머리와 값이 열마다 같은 축을 쓴다(§DESIGN 3). 이름만 왼쪽이고
            나머지는 가운데다 — 폭이 고정이라 둘의 가운데가 한 세로선에 놓인다.
          */}
          <div className="overflow-x-auto">
            <div className="border-border text-muted-foreground bg-secondary/50 flex min-w-[760px] items-center gap-4 border-y px-7 py-3 text-[12px] leading-4">
              <span className="min-w-0 flex-1">인수인계서명</span>
              <span className="w-24 shrink-0 text-center">담당자</span>
              <span className="w-20 shrink-0 text-center">유형</span>
              <span className="w-44 shrink-0 text-center">기간</span>
              {/* chevron 자리 — 머리에는 라벨을 안 붙인다 */}
              <span className="w-4 shrink-0" aria-hidden />
            </div>

            {items.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="처리할 인수인계서가 없습니다."
                description="팀원이 휴직·오프보딩을 신청하면 이 자리에 올라옵니다."
              />
            ) : (
              <ul>
                {items.map((item) => (
                  <li key={item.handoverId} className="border-border not-first:border-t">
                    <Link
                      href={`/team/handover/${item.handoverId}`}
                      className="hover:bg-foreground/[0.04] flex min-w-[760px] items-center gap-4 px-7 py-3.5 text-[13px] leading-5 transition-colors"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {item.memberName} · {HANDOVER_TYPE_LABEL[item.type]} 인수인계서
                      </span>
                      <span className="text-muted-foreground w-24 shrink-0 truncate text-center">
                        {item.memberName}
                      </span>
                      <span className="text-muted-foreground w-20 shrink-0 text-center">
                        {HANDOVER_TYPE_LABEL[item.type]}
                      </span>
                      <span className="text-muted-foreground w-44 shrink-0 text-center tabular-nums">
                        {item.period
                          ? `${formatMonthDayWeekday(item.period.from)} ~ ${formatMonthDayWeekday(item.period.to)}`
                          : "-"}
                      </span>
                      {/* ⚠️ 들어가는 줄임을 모양으로 알린다 — 오너 쪽 목록과 같은 꼬리다 */}
                      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
