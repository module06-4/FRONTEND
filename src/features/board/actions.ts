"use server";

import { revalidatePath } from "next/cache";

import { ACTION_STATUS } from "@/constants/domain";
import { requireAccessToken } from "@/features/auth/session";
import { TOP_LEVEL_PROJECTS } from "@/features/project/mock/projects";
import { TEAM_ACTION_PERSONAL_ITEMS_MOCK } from "@/features/project/mock/team-action-detail";
import { serverApi } from "@/lib/api";
import { todayIso } from "@/lib/date";
import { ep } from "@/lib/endpoints";
import { isMock } from "@/mocks/config";

import { canMoveCard, getBoardColumn } from "./lib";
import { getMyActionBoard, getProjectBoard } from "./server";
import {
  BOARD_COLUMN,
  type BoardCard,
  type BoardChange,
  type BoardColumnId,
  type BoardType,
} from "./types";

const BOARD_PATH = "/app/board";

/**
 * 보드 저장 — 드래그로 만든 변경을 한 번에 반영한다.
 * ⚠️ 화면의 드래그 제약은 UX일 뿐이다 — 여기서도 `canMoveCard`로 다시 검증한다
 *    (§권한과 같은 원칙: 화면 숨김은 보안이 아니다).
 */
/**
 * 옮긴 카드를 저장한다 — **실제로 반영한 건수를 돌려준다.**
 *
 * ⚠️ 요청한 수와 반영한 수는 다를 수 있다. 카드가 그 사이 사라졌거나(`!item`) 옮길 수 없는
 *    칸이면(`canMoveCard`) 조용히 건너뛴다 — 부르는 쪽이 요청 수를 그대로 "N건 반영했습니다"
 *    라고 말하면 화면이 거짓말을 한다(§정직성).
 */
export async function commitBoardChangesAction(
  boardType: BoardType,
  changes: BoardChange[],
): Promise<{ appliedCount: number }> {
  if (!isMock) return commitBoardChangesLive(boardType, changes);

  const today = new Date();
  const items = boardType === "project" ? TOP_LEVEL_PROJECTS : findAllPersonalItems();

  let appliedCount = 0;

  for (const change of changes) {
    const item = items.find((candidate) => candidate.id === change.id);
    if (!item) continue;

    const currentColumn = getBoardColumn(
      { isDone: item.status === ACTION_STATUS.DONE, startDate: item.startDate },
      today,
    );
    if (!canMoveCard(currentColumn, change.toColumn)) continue;

    applyColumnChange(item, change.toColumn);
    appliedCount += 1;
  }

  revalidatePath(BOARD_PATH);
  return { appliedCount };
}

/**
 * 실연동 저장 — mock의 `applyColumnChange`(로컬 배열 직접 수정)를 못 쓴다. 대신 **지금
 * 카드 상태를 다시 조회**해 각 변경의 현재 칸을 알아내고(§권한: 화면 숨김은 보안이 아니다,
 * 클라가 보낸 `toColumn`만 믿지 않는다), `canMoveCard`로 한 번 더 거른 뒤 유효한 것만
 * bulk API로 보낸다. 두 벌크 API(`/api/projects/status/bulk`·`/api/actions/complete/bulk`)
 * 둘 다 all-or-nothing이라, 유효한 항목만 추려 보내면 실패할 이유가 없다(호출자 소유
 * 액션만 보드에 뜨므로 "담당자 본인" 검사도 걸릴 게 없다).
 */
async function commitBoardChangesLive(
  boardType: BoardType,
  changes: BoardChange[],
): Promise<{ appliedCount: number }> {
  const today = new Date();
  /*
    ⚠️ **현재 카드 조회 실패도 잡는다**(2026-08-15, `rooms/actions.ts`의 `getMeetingRooms()`와
       같은 사고 — #553/#554/#556). 호출부(`board-view.tsx`)가 이미 이 액션이 던지는 경우를
       잡아 토스트로 보여주지만(§정직성 주석), `appliedCount: 0`으로 곱게 돌려주면 호출부의
       기존 "옮기지 못했습니다" 분기를 그대로 타서 새 처리를 안 만들어도 된다.
  */
  let currentCards: BoardCard[];
  try {
    // ⚠️ `getMyActionBoard()`를 인자 없이 부른다 — 실연동에서는 `GET /api/actions`가 이미
    //    토큰의 본인 소유분만 돌려주므로 assigneeName이 필요 없다(mock 분기 전용 파라미터).
    //    예전엔 빈 문자열("")을 넘겼는데, 그건 이 분기가 실수로 mock 쪽을 타게 되면 "담당자
    //    이름이 빈 문자열"로 필터링돼 카드가 전부 사라지는 걸 아무 신호 없이 통과시키는
    //    지뢰였다 — 지금은 값이 없으면 mock 쪽이 바로 던지고, 여기서 잡아 로그를 남긴다.
    currentCards = boardType === "project" ? await getProjectBoard() : await getMyActionBoard();
  } catch (error) {
    console.error("보드 카드 현재 상태 조회 실패", error);
    return { appliedCount: 0 };
  }

  const validItems = changes
    .map((change) => {
      const card = currentCards.find((candidate) => candidate.id === change.id);
      if (!card) return null;
      const currentColumn = getBoardColumn(card, today);
      if (!canMoveCard(currentColumn, change.toColumn)) return null;
      return { id: change.id, status: change.toColumn };
    })
    .filter((item): item is { id: number; status: BoardColumnId } => item !== null);

  if (validItems.length === 0) {
    revalidatePath(BOARD_PATH);
    return { appliedCount: 0 };
  }

  const accessToken = await requireAccessToken();
  if (boardType === "project") {
    await serverApi(ep.projectStatusBulk(), {
      method: "PATCH",
      accessToken,
      json: { items: validItems.map((item) => ({ projectId: item.id, status: item.status })) },
    });
  } else {
    await serverApi(ep.actionCompleteBulk(), {
      method: "PATCH",
      accessToken,
      json: { items: validItems.map((item) => ({ actionId: item.id, status: item.status })) },
    });
  }

  revalidatePath(BOARD_PATH);
  return { appliedCount: validItems.length };
}

function findAllPersonalItems() {
  return Object.values(TEAM_ACTION_PERSONAL_ITEMS_MOCK).flat();
}

/** `status`가 도메인마다 다른 enum이지만 값(TODO/IN_PROGRESS/DONE)은 같아 그대로 대입한다. */
function applyColumnChange(
  item: { status: string; startDate: string },
  toColumn: BoardColumnId,
): void {
  if (toColumn === BOARD_COLUMN.DONE) {
    item.status = ACTION_STATUS.DONE;
    return;
  }
  if (toColumn === BOARD_COLUMN.IN_PROGRESS) {
    // ⚠️ 할 일에서 왔으면 당겨서 시작한 것이므로 시작일을 오늘로 조정한다.
    //    완료에서 돌아온 것이면 날짜는 손대지 않는다(§상태 정책).
    if (item.status === ACTION_STATUS.TODO) item.startDate = todayIso();
    item.status = ACTION_STATUS.IN_PROGRESS;
    return;
  }
  // toColumn === TODO는 드래그로 못 만드는 상태 전이라 여기 안 온다(canMoveCard가 막음).
}
