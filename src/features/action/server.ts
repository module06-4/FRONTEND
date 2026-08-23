import { ACTION_STATUS } from "@/constants/domain";
import { requireAccessToken } from "@/features/auth/session";
import type { BePageResponse } from "@/features/project/mapper";
import { TOP_LEVEL_PROJECTS } from "@/features/project/mock/projects";
import { TEAM_ACTION_PERSONAL_ITEMS_MOCK } from "@/features/project/mock/team-action-detail";
import { PROJECT_TEAM_ACTIONS_MOCK } from "@/features/project/mock/team-actions";
import { ApiError, serverApi } from "@/lib/api";
import { ep } from "@/lib/endpoints";
import { paginate, type PaginatedResult } from "@/lib/paginate";
import { isMock } from "@/mocks/config";

import {
  type BeActionSummary,
  parseActionDetail,
  toMyActionListItem,
  toPersonalActionDetail,
  toTeamActionListItem,
} from "./mapper";
import { PERSONAL_ACTION_DETAIL_MOCK } from "./mock/action-detail";
import type { MyActionListItem, PersonalActionDetail, TeamActionListItem } from "./types";

/** 개인 액션 상세(`/app/actions/:actionId`). 못 찾으면 `null`(호출부가 404). */
export async function getPersonalActionDetail(
  actionId: string,
): Promise<PersonalActionDetail | null> {
  if (isMock) {
    const numericId = Number(actionId);
    if (!Number.isInteger(numericId)) return null;
    return PERSONAL_ACTION_DETAIL_MOCK[numericId] ?? null;
  }

  const numericId = Number(actionId);
  if (!Number.isInteger(numericId)) return null;

  const accessToken = await requireAccessToken();
  try {
    /*
      ⚠️ `serverApi<BeActionDetail>`는 **단언일 뿐 검사가 아니다.** 회의 상세와 같이 실런타임
         검사(가드)를 세운다 — nullable 5필드가 정말 nullable로 오는데 non-null string으로
         읽으면 화면이 조용히 이상해지거나 페이지가 통째로 죽는다.
    */
    const raw = await serverApi<unknown>(ep.action(numericId), { accessToken });
    return toPersonalActionDetail(parseActionDetail(raw));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** 한 화면에 그리는 줄 수 — BE 목록 기본값과 같다([확인] `ActionController.list`의 `size` 기본 20). */
export const ACTION_PAGE_SIZE = 20;

/**
 * 내 액션 목록(`/app/my/actions`) 한 페이지 — 마감 임박순, **자르기는 서버가 한다.**
 *
 * ⚠️ `size: 9999`로 전량을 받지 않는다(CLAUDE.md §목록·페이지네이션 — 화면만 잘릴 뿐
 *    10만 건을 다 받아 온다). 첫 페이지는 서버 컴포넌트가 렌더하고, 그 아래부터
 *    스크롤이 끝에 닿으면 이어 붙인다.
 * ⚠️ 정렬도 서버에 맡긴다(`sort=dueDate&order=asc`, [확인] BE
 *    `action/presentation/api/ActionController.java` list — sort=dueDate|createdAt, order,
 *    page 0-base, size 기본 20). 받아 와서 화면이 다시 정렬하면 페이지 경계가 어긋난다.
 * ⚠️ 실연동에선 `assigneeName`을 안 쓴다 — `GET /api/actions`가 이미 토큰의 본인 소유분만
 *    돌려준다(board/server.ts와 같은 이유). 파라미터는 mock 분기 전용으로 시그니처만 유지한다.
 */
export async function getMyActionsPage(
  assigneeName: string | undefined,
  page: number,
  pageSize: number = ACTION_PAGE_SIZE,
): Promise<PaginatedResult<MyActionListItem>> {
  if (isMock) {
    // ⚠️ 값 없이 mock 분기를 타면 전부 필터링돼 "액션이 0건"으로 조용히 보이는 게 제일
    //    위험하다(`getMyActionBoard`와 같은 이유) — 바로 던져서 호출부가 알아채게 한다.
    if (!assigneeName) throw new Error("getMyActionsPage: mock 분기는 assigneeName이 필요하다");
    const list: MyActionListItem[] = [];
    for (const items of Object.values(TEAM_ACTION_PERSONAL_ITEMS_MOCK)) {
      for (const item of items) {
        if (item.assigneeName !== assigneeName) continue;
        const detail = PERSONAL_ACTION_DETAIL_MOCK[item.id];
        if (!detail) continue;
        const project = TOP_LEVEL_PROJECTS.find((p) => p.id === detail.projectId);
        if (!project) continue;
        list.push({
          id: item.id,
          title: item.title,
          description: detail.description,
          /*
            ⚠️ `PersonalActionDetail.team`·`projectTag`는 개인 액션이 팀·태그 참조를 못 가질 수
               있어 optional이지만, 이 리스트 계약(`MyActionListItem`)은 여전히 non-null이다
               (`toMyActionListItem`이 `?? "-"`·`?? ""`로 접는다). 실서버 매퍼와 같은 방어를
               mock 분기에서도 그대로 쓴다 — 목이 실서버보다 관대해서는 안 된다(§정직한 목업).
          */
          team: detail.team ?? "-",
          projectId: detail.projectId,
          projectName: project.name,
          projectTag: detail.projectTag ?? "",
          startDate: item.startDate,
          dueDate: item.dueDate,
          status: item.status,
        });
      }
    }
    // 서버 정렬(sort=dueDate&order=asc)과 같은 순서로 굳힌 뒤 자른다 — 연동 시 화면이 안 바뀐다.
    list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return paginate(list, page, pageSize);
  }

  /*
    [확인] BE `global/response/PageResponse.java` — `content`·`page`·`size`·`totalElements`·
    `totalPages`·`hasNext`. 목록 3종(projects·actions·team/actions) 공용 봉투라 사원 목록의
    `MemberPageResponse`(`totalCount`)와 **필드명이 다르다** — 이름을 잘못 읽으면 `전체 N건`이
    비고 다음 페이지 유무를 아무도 모르게 된다.
  */
  const accessToken = await requireAccessToken();
  const response = await serverApi<BePageResponse<BeActionSummary>>(
    ep.actions({ sort: "dueDate", order: "asc", page: Math.max(0, page), size: pageSize }),
    { accessToken },
  );

  /*
    ⚠️ TEAM 타입은 방어적으로 거른다 — BE는 본인 소유 **PERSONAL만** 준다([확인]
       `ActionService.getMyActions` 주석 "기본은 호출자 본인 소유 PERSONAL 액션")라 실제로는
       안 걸리지만, 계약이 바뀌어 섞여 와도 화면이 팀 액션을 개인 액션인 척 그리지 않게 한다.
    ⚠️ 거른 만큼 `totalElements`를 줄이지 않는다 — 그 숫자는 서버가 센 전체이고, 화면의
       `전체 N건`은 그 값을 말해야 다음 페이지 유무와 어긋나지 않는다(member/manage-server.ts와
       같은 규칙).
  */
  const items = response.content
    .filter((action) => action.actionType === "PERSONAL")
    .map(toMyActionListItem);

  return {
    items,
    page: response.page,
    totalPages: response.totalPages,
    totalCount: response.totalElements,
  };
}

/**
 * 팀 액션 관리(`/team/action`) 한 페이지 — **평평한 목록**으로 돌려준다. 프로젝트별 묶기는
 * 화면이 이어 붙인 전체를 대상으로 매번 다시 한다(`groupTeamActionsByProject`) — 서버가
 * 그룹을 만들면 페이지 경계에 걸린 그룹을 이어 붙일 수 없다.
 *
 * ⚠️ `size: 9999` 전량 수신을 없앴다(§목록·페이지네이션). 정렬은 서버가 한다
 *    (`sort=dueDate&order=asc`, [확인] BE `action/presentation/api/TeamActionController.java`
 *    list — sort=dueDate|createdAt, order, page 0-base, size 기본 20).
 * ⚠️ 실연동은 `GET /api/team/actions`가 JWT teamId로 이미 자동 스코프하므로 팀명을 안 넘긴다.
 *    mock은 세션이 없어 팀명 필터가 필요하다(board/server.ts와 같은 이유) — 호출부
 *    (`/team/action` 페이지)가 `getViewer().teamName`을 실어 보낸다.
 */
export async function getTeamActionsPage(
  teamName: string | undefined,
  page: number,
  pageSize: number = ACTION_PAGE_SIZE,
): Promise<PaginatedResult<TeamActionListItem>> {
  if (isMock) {
    // ⚠️ 값 없이 mock 분기를 타면 전부 필터링돼 "팀 액션이 0건"으로 조용히 보이는 게 제일
    //    위험하다(`getMyActionBoard`와 같은 이유) — 바로 던져서 호출부가 알아채게 한다.
    if (!teamName) throw new Error("getTeamActionsPage: mock 분기는 teamName이 필요하다");
    const list: TeamActionListItem[] = [];
    /*
      ⚠️ 목은 팀 액션을 **태그로** 찾는데 태그는 프로젝트끼리 겹칠 수 있다(GOODS가 둘,
         §라우트 그룹 — URL도 그래서 태그가 아니라 id로 다닌다). 그대로 펼치면 같은 액션
         id가 두 프로젝트에 중복돼, 이어 붙일 때 id로 거르는 규칙(§목록·페이지네이션)이
         뒤 페이지의 정상 행을 지워 버린다 — 먼저 만난 프로젝트가 가진다. 실 BE는 액션이
         프로젝트 FK를 직접 들고 있어 이 문제가 없다.
    */
    const seen = new Set<number>();
    for (const project of TOP_LEVEL_PROJECTS) {
      for (const action of PROJECT_TEAM_ACTIONS_MOCK[project.tag] ?? []) {
        if (action.team !== teamName) continue;
        if (seen.has(action.id)) continue;
        seen.add(action.id);
        /*
          하위 개인 액션 진척 — 목도 **같은 데이터에서 센다**(BE `childDoneCount`·`childTotalCount`,
          #355). 상수를 박으면 상세 탭의 하위 목록과 숫자가 어긋나 목이 거짓말을 한다(§정직한 목업).
          ⚠️ 목에 하위가 아예 안 잡힌 팀 액션은 `0/0`이다 — `null`이 아니다. 팀 액션은 하위를
             가질 수 있는 개념이고, `null`은 "하위 개념 자체가 없음"을 뜻한다(#421 판정 참고).
        */
        const children = TEAM_ACTION_PERSONAL_ITEMS_MOCK[action.id] ?? [];
        list.push({
          id: action.id,
          name: action.name,
          startDate: action.startDate,
          dueDate: action.dueDate,
          status: action.status,
          childDoneCount: children.filter((child) => child.status === ACTION_STATUS.DONE).length,
          childTotalCount: children.length,
          projectId: project.id,
          projectName: project.name,
          projectTag: project.tag,
        });
      }
    }
    // 서버 정렬(sort=dueDate&order=asc)과 같은 순서로 굳힌 뒤 자른다 — 연동 시 화면이 안 바뀐다.
    list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return paginate(list, page, pageSize);
  }

  /* [확인] BE `global/response/PageResponse.java` — 위 `getMyActionsPage`와 같은 공용 봉투. */
  const accessToken = await requireAccessToken();
  const response = await serverApi<BePageResponse<BeActionSummary>>(
    ep.teamActions({ sort: "dueDate", order: "asc", page: Math.max(0, page), size: pageSize }),
    { accessToken },
  );

  return {
    items: response.content.map(toTeamActionListItem),
    page: response.page,
    totalPages: response.totalPages,
    totalCount: response.totalElements,
  };
}
