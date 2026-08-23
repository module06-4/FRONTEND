"use client";

import { useCallback } from "react";

import { InfiniteListFooter } from "@/components/common/infinite-list-footer";
import { isDelayed } from "@/constants/domain";
import type { TimelineActionInput } from "@/features/member/action-timeline";
import { ActionTimeline, ActionTimelineLegend } from "@/features/member/components/action-timeline";
import { useInfiniteScrollList } from "@/hooks/use-infinite-scroll-list";
import { pickPaletteColor } from "@/lib/palette";

import { fetchTeamActionsPageAction } from "../actions";
import { groupTeamActionsByProject } from "../mapper";
import type { TeamActionListItem, TeamActionProjectGroup, TeamActionTimelineItem } from "../types";

/**
 * 팀 액션 목록 — **서버가 자르고, 화면이 이어 붙인다**(CLAUDE.md §목록·페이지네이션).
 *
 * ⚠️ 첫 페이지는 서버 컴포넌트(page.tsx)가 렌더한 값을 그대로 받는다 — 여기서 다시 안 부른다.
 * ⚠️ 프로젝트별 묶기는 **이어 붙인 전체를 대상으로 매번 다시** 한다. 서버 정렬이
 *    `sort=dueDate&order=asc`라 그룹 순서는 대체로 안정적이지만, 새 페이지가 도착하면
 *    이미 그려진 타임라인 그룹이 자랄 수 있다 — 전량을 미리 받는 것보다 정직한 동작이다.
 * ⚠️ 머리의 건수는 **서버가 센 전체**다. 프로젝트 개수는 안 적는다 — 서버는 남은 페이지에
 *    어떤 프로젝트가 더 있는지 안 알려주므로, 지금까지 받은 그룹 수를 적으면 거짓말이 된다.
 */

/** 컴포넌트 밖에 둬서 매 렌더 새 함수가 안 되게 한다(센티널 재부착 방지) */
function getId(action: TeamActionListItem) {
  return String(action.id);
}

/** 이 프로젝트의 팀 액션들을 타임라인 입력으로 — 프로젝트 상세 타임라인 탭과 같은 모양(§디자인). */
function toTimelineItems(
  group: TeamActionProjectGroup,
  teamActions: TeamActionTimelineItem[],
): TimelineActionInput[] {
  const tagColor = pickPaletteColor(group.projectTag);
  return teamActions.map((action) => ({
    id: String(action.id),
    title: action.name,
    tag: group.projectTag,
    tagBgColor: tagColor.bgColor,
    tagTextColor: tagColor.textColor,
    startDate: action.startDate,
    dueDate: action.dueDate,
    tone: isDelayed(action) ? "DELAYED" : action.status,
    href: `/app/projects/${group.projectId}/team/${action.id}`,
    /*
      하위 개인 액션 진척(`3/5`) — BE가 이미 주는 값이라 그대로 넘긴다(#355 · 매퍼 수신 #416).
      ⚠️ `null`을 `0`으로 바꾸지 않는다. 계약상 `null`은 "하위 개념 자체가 없음"이고
         `0/0`은 "하위가 아직 비어 있음"이라 뜻이 갈린다 — 여기서 뭉개면 타임라인이
         없는 사실을 지어낸다(DESIGN §9 — 화면은 사실만 말한다).
    */
    childDoneCount: action.childDoneCount,
    childTotalCount: action.childTotalCount,
  }));
}

interface TeamActionListViewProps {
  initialItems: TeamActionListItem[];
  initialPage: number;
  initialTotalPages: number;
  initialTotalCount: number;
  /** ⚠️ mock 분기 전용 — 실연동은 JWT teamId로 이미 자동 스코프한다(server.ts). */
  teamName: string | undefined;
}

export function TeamActionListView({
  initialItems,
  initialPage,
  initialTotalPages,
  initialTotalCount,
  teamName,
}: TeamActionListViewProps) {
  const fetchPage = useCallback(
    (page: number) => fetchTeamActionsPageAction(teamName, page),
    [teamName],
  );

  const { items, totalCount, hasMore, isLoadingMore, error, loadMore, sentinelRef } =
    useInfiniteScrollList({
      initialItems,
      initialPage,
      initialTotalPages,
      initialTotalCount,
      getId,
      fetchPage,
    });

  const groups = groupTeamActionsByProject(items);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
      <p className="text-muted-foreground self-end text-xs tabular-nums">
        전체 {totalCount}개 팀 액션
      </p>

      {groups.length === 0 ? (
        <p className="text-muted-foreground flex min-h-[240px] items-center justify-center text-sm">
          아직 하달된 팀 액션이 없습니다.
        </p>
      ) : (
        groups.map((group) => {
          const tagColor = pickPaletteColor(group.projectTag);
          return (
            <section
              key={group.projectId}
              className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border"
            >
              <div className="border-border flex shrink-0 items-baseline justify-between gap-3 border-b px-7 pt-6 pb-3">
                <h3 className="flex items-center gap-2 text-[17px] leading-7 font-semibold tracking-[-0.3px]">
                  <span className="bg-foreground size-2 rounded-full" aria-hidden />
                  {group.projectName}
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-xs leading-none font-semibold"
                    style={{ backgroundColor: tagColor.bgColor, color: tagColor.textColor }}
                  >
                    {group.projectTag}
                  </span>
                </h3>
                {/* 그룹 건수는 **지금까지 받은 것만** 센다 — 다음 페이지가 오면 늘 수 있다 */}
                <p className="text-muted-foreground text-[12px] leading-4 tabular-nums">
                  {group.teamActions.length}개 팀 액션
                </p>
              </div>
              <ActionTimeline
                items={toTimelineItems(group, group.teamActions)}
                today={new Date()}
              />
            </section>
          );
        })
      )}

      {/*
        ⚠️ 목록 끝의 빈 요소가 **감시 대상**이다(IntersectionObserver) — 화면에 걸리면 자동으로
           다음 페이지를 부른다. [더 보기] 버튼은 없다(2026-08-10 폐기). 실패하면 조용히 멈추지
           않는다 — [다시 시도]를 띄운다(§목록 3상태).
      */}
      <InfiniteListFooter
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        error={error}
        onLoadMore={loadMore}
        sentinelRef={sentinelRef}
      />

      <ActionTimelineLegend />
    </div>
  );
}
