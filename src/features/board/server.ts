import { ACTION_STATUS, AUTHORITY, type Authority, PROJECT_STATUS } from "@/constants/domain";
import { type BeActionSummary, fallbackActionStartDate } from "@/features/action/mapper";
import { requireAccessToken } from "@/features/auth/session";
import type { BePageResponse, BeProjectSummary } from "@/features/project/mapper";
import { TOP_LEVEL_PROJECTS } from "@/features/project/mock/projects";
import {
  TEAM_ACTION_DETAIL_MOCK,
  TEAM_ACTION_PERSONAL_ITEMS_MOCK,
} from "@/features/project/mock/team-action-detail";
import { serverApi } from "@/lib/api";
import { ep } from "@/lib/endpoints";
import { pickPaletteColor } from "@/lib/palette";
import { isMock } from "@/mocks/config";

import type { BoardCard, BoardType } from "./types";

/** 오너 보드 — 전체 프로젝트. */
export async function getProjectBoard(): Promise<BoardCard[]> {
  if (isMock) {
    return TOP_LEVEL_PROJECTS.map((project) => {
      const tagColor = pickPaletteColor(project.tag);
      return {
        id: project.id,
        title: project.name,
        tagLabel: project.tag,
        tagBgColor: tagColor.bgColor,
        tagTextColor: tagColor.textColor,
        startDate: project.startDate,
        dueDate: project.dueDate,
        isDone: project.status === PROJECT_STATUS.DONE,
      };
    });
  }

  // ⚠️ 무한스크롤은 이 화면(보드)에 안 맞는다 — 칸반은 처음부터 전체가 보여야 하니
  //    size를 크게 잡아 사실상 전체를 받는다(project/server.ts의 fetchAllProjects와 같은 방식).
  const accessToken = await requireAccessToken();
  const page = await serverApi<BePageResponse<BeProjectSummary>>(ep.projects({ size: 9999 }), {
    accessToken,
  });
  return page.content.map((project) => {
    const tagColor = pickPaletteColor(project.tag);
    return {
      id: project.id,
      title: project.name,
      tagLabel: project.tag,
      tagBgColor: tagColor.bgColor,
      tagTextColor: tagColor.textColor,
      startDate: project.startDate ?? new Date().toISOString().slice(0, 10),
      dueDate: project.dueDate,
      isDone: project.status === PROJECT_STATUS.DONE,
    };
  });
}

/**
 * 팀장·사원 보드 — 담당자 이름이 일치하는 개인 액션 전체.
 * ⚠️ 팀 액션은 여기 안 나온다(§상태 정책) — 팀 액션 완료 여부는 하위 개인 액션 집계로
 *    파생되지, 사람이 보드에서 직접 옮기는 대상이 아니다.
 */
export async function getMyActionBoard(assigneeName?: string): Promise<BoardCard[]> {
  if (isMock) {
    // ⚠️ mock 분기는 이 값 없이는 아무것도 못 고른다 — 빈 문자열("")을 넘기면 전부 필터링돼
    //    "카드가 0건"으로 조용히 보이는 게 제일 위험하다. 없으면 바로 던져서 호출부
    //    (`commitBoardChangesLive`)의 기존 catch가 appliedCount: 0으로 잡게 한다.
    if (!assigneeName) throw new Error("getMyActionBoard: mock 분기는 assigneeName이 필요하다");
    const cards: BoardCard[] = [];
    for (const [teamActionIdText, items] of Object.entries(TEAM_ACTION_PERSONAL_ITEMS_MOCK)) {
      const teamAction = TEAM_ACTION_DETAIL_MOCK[Number(teamActionIdText)];
      if (!teamAction) continue;
      const tagColor = pickPaletteColor(teamAction.projectTag);
      for (const item of items) {
        if (item.assigneeName !== assigneeName) continue;
        cards.push({
          id: item.id,
          title: item.title,
          tagLabel: teamAction.projectTag,
          tagBgColor: tagColor.bgColor,
          tagTextColor: tagColor.textColor,
          startDate: item.startDate,
          dueDate: item.dueDate,
          isDone: item.status === ACTION_STATUS.DONE,
        });
      }
    }
    return cards;
  }

  // ⚠️ `assigneeName`은 실연동에선 안 쓴다 — `GET /api/actions`가 이미 토큰의 본인 소유분만
  //    돌려준다(BE 실코드 확인). 파라미터는 mock 분기 전용으로 시그니처만 유지한다.
  const accessToken = await requireAccessToken();
  const page = await serverApi<BePageResponse<BeActionSummary>>(ep.actions({ size: 9999 }), {
    accessToken,
  });
  return page.content
    .filter((action) => action.actionType === "PERSONAL")
    .map((action) => {
      const tagColor = pickPaletteColor(action.projectTag ?? "");
      return {
        id: action.id,
        title: action.title,
        tagLabel: action.projectTag ?? "",
        tagBgColor: tagColor.bgColor,
        tagTextColor: tagColor.textColor,
        startDate: fallbackActionStartDate(action.startDate),
        dueDate: action.dueDate,
        isDone: action.status === ACTION_STATUS.DONE,
      };
    });
}

/**
 * 권한에 따라 오너=프로젝트 보드, 팀장·사원=본인 개인 액션 보드를 고른다.
 * ⚠️ `assigneeName`은 로그인한 그 사람 이름이어야 한다 — 로그인 전인 지금은 대시보드 목에서도
 *    쓰는 대표 인물(김서준·이하윤)로 대신한다. 세션이 붙으면 `viewer.name`으로 바꾼다.
 */
export async function loadBoardForRole(
  role: Authority,
): Promise<{ boardType: BoardType; cards: BoardCard[] }> {
  if (role === AUTHORITY.OWNER) {
    return { boardType: "project", cards: await getProjectBoard() };
  }
  const assigneeName = role === AUTHORITY.LEADER ? "김서준" : "이하윤";
  return { boardType: "my-action", cards: await getMyActionBoard(assigneeName) };
}
