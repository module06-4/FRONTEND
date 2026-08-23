import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/common/access-denied";
import { HANDOVER_TYPE_LABEL } from "@/constants/domain";
import { roleHome } from "@/features/shell/home";
import { getViewer } from "@/features/shell/viewer";
import { TeamHandoverAssignBoard } from "@/features/team-handover/components/team-handover-assign-board";
import { getTeamHandoverDetail } from "@/features/team-handover/server";
import { todayIso } from "@/lib/date";
import { canAccessTeamScope } from "@/lib/permission";

export const metadata: Metadata = {
  title: "인수인계서 상세",
};

interface TeamHandoverDetailPageProps {
  params: Promise<{ handoverId: string }>;
}

export default async function TeamHandoverDetailPage({ params }: TeamHandoverDetailPageProps) {
  const viewer = await getViewer();
  if (!canAccessTeamScope(viewer)) return <AccessDenied homeHref={roleHome(viewer.role)} />;

  const { handoverId } = await params;
  const id = Number(handoverId);
  if (!Number.isInteger(id)) notFound();

  const handover = await getTeamHandoverDetail(id, viewer.teamName);
  if (!handover) notFound();

  return (
    <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-8 py-7">
      {/*
        ⚠️ **상세 폭은 1440이다**(§DESIGN 4 — detail). 960은 **폼 한 장**의 폭이지 표가 있는
           상세의 폭이 아니다 — 넓은 화면에서 가운데 좁은 기둥 하나만 서고 좌우가 통째로 비었고,
           오너 쪽 같은 화면(`/owner/leader-handovers/:id`)이 1440이라 오갈 때 본문이 흔들렸다.
      */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-5">
        <div>
          {/* ⚠️ 이게 이 화면의 제목이다 — `h1`이어야 층이 여기서 시작한다(§a11y·§SEO: h1 1개) */}
          <h1 className="text-[22px] leading-[30px] font-semibold tracking-[-0.4px]">
            {handover.memberName} · {HANDOVER_TYPE_LABEL[handover.type]}
          </h1>
          {/*
            ⚠️ **화면에 실제로 담긴 수를 적는다**(2026-08-11). `actionCount`는 목록에서 온
               값이라 이 화면이 그리는 액션 수와 어긋나, 위에는 `3건`인데 아래는 `0/1건`이
               떴다 — 한 화면이 두 수를 말하면 어느 쪽도 못 믿는다(§정직성).
          */}
          <p className="text-muted-foreground mt-1 text-[13px] leading-5 tabular-nums">
            인계 액션 {handover.actions.length}건
          </p>
        </div>

        <TeamHandoverAssignBoard handover={handover} todayIso={todayIso()} />
      </div>
    </main>
  );
}
