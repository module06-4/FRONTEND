"use server";

import type { PaginatedResult } from "@/lib/paginate";

import { getMyActionsPage, getTeamActionsPage } from "./server";
import type { MyActionListItem, TeamActionListItem } from "./types";

/**
 * 액션 목록의 **다음 페이지** — 무한 스크롤 훅(`useInfiniteScrollList`)이 부른다.
 * 첫 페이지는 서버 컴포넌트가 이미 렌더했다(§핵심 4원칙 ① — 여기서 다시 부르지 않는다).
 *
 * ⚠️ 실패는 **빈 페이지로 돌려주지 않는다** — 던지면 훅이 받아 [다시 시도]를 띄운다
 *    (member/manage-actions.ts `fetchMembersPageAction`과 같은 이유, §목록 3상태).
 * ⚠️ 권한 게이트는 따로 안 건다 — 두 목록 다 로그인 전원이 볼 수 있고, 스코프는 BE가
 *    토큰(memberId·teamId)으로 이미 자른다([확인] `ActionController`·`TeamActionController`).
 */

/** ⚠️ `assigneeName`은 mock 분기 전용이다 — 실연동은 토큰의 본인 소유분만 온다(server.ts). */
export async function fetchMyActionsPageAction(
  assigneeName: string,
  page: number,
): Promise<PaginatedResult<MyActionListItem>> {
  // ⚠️ `page`는 0-base다(BE 표준 확정, 2026-08-10) — NaN·Infinity·음수는 모두 0으로 당긴다.
  const safePage = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0;
  return getMyActionsPage(assigneeName, safePage);
}

/** ⚠️ `teamName`은 mock 분기 전용이다 — 실연동은 JWT teamId로 이미 자동 스코프한다(server.ts). */
export async function fetchTeamActionsPageAction(
  teamName: string | undefined,
  page: number,
): Promise<PaginatedResult<TeamActionListItem>> {
  const safePage = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0;
  return getTeamActionsPage(teamName, safePage);
}
