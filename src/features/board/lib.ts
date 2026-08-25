import { ACTION_STATUS, isDelayed } from "@/constants/action";

import { BOARD_COLUMN, type BoardCard, type BoardColumnId } from "./types";

/**
 * `YYYY-MM-DD`를 로컬 자정 기준 `Date`로 — 마감일 비교는 시각이 아니라 날짜다(§isPastDue와 동일).
 * ⚠️ `getBoardColumn`의 시작일 비교가 여기 쓴다 — 마감 경과 비교는 `isPastDue`로 공용화됐다.
 */
function toLocalMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function startOfToday(today: Date): Date {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 카드가 지금 몇 칸에 있는지 — **완료만 저장된 값**이고 나머지는 항상 날짜로 계산한다.
 * 오늘이 시작일보다 이르면 할 일, 아니면 진행중(마감이 지났어도 진행중 칸 안에서
 * "지연" 배지로만 표시한다 — 별도 칸이 아니다, `isCardDelayed` 참고).
 */
export function getBoardColumn(
  card: Pick<BoardCard, "isDone" | "startDate">,
  today: Date,
): BoardColumnId {
  if (card.isDone) return BOARD_COLUMN.DONE;
  return startOfToday(today) < toLocalMidnight(card.startDate)
    ? BOARD_COLUMN.TODO
    : BOARD_COLUMN.IN_PROGRESS;
}

/**
 * 지연 배지 — 마감 경과 여부만 본다. **칸(진행중 한정) 판정은 호출부**가 한다.
 *
 * ⚠️ 여기서 `getBoardColumn`을 부르지 않는다 — 화면(`board-view.tsx`)이 낙관적으로 잠시
 *    옮긴 칸(`pendingMoves[card.id]`, #686)까지 함께 봐야 하고, 그건 저장된 값(`isDone`)만
 *    보는 `getBoardColumn`이 모른다. 여기서 칸을 판정하면 카드를 완료로 끌어다 놓아도
 *    서버 응답이 오기 전까지 지연 배지가 남는다.
 * ⚠️ **판정 자체는 `isDelayed` 하나뿐이다**(2026-08-18 정정 — 전엔 `isPastDue`를 여기서
 *    한 번 더 조합해 같은 규칙이 두 벌이었다). 보드 카드는 `ActionStatus`가 아니라
 *    `isDone`만 들고 있어 입력 모양만 맞춰 준다 — `isDone`이면 완료로, 아니면 진행중으로
 *    본다(칸 판정은 위에서 이미 걸러졌으므로 할일 칸일 가능성은 여기 안 온다).
 */
export function isCardDelayed(card: Pick<BoardCard, "isDone" | "dueDate">, today: Date): boolean {
  return isDelayed(
    { status: card.isDone ? ACTION_STATUS.DONE : ACTION_STATUS.IN_PROGRESS, dueDate: card.dueDate },
    today,
  );
}

/**
 * 드래그 허용 규칙 — 할 일→진행중·진행중→완료·완료→진행중만 된다.
 * 그 외(할 일↔완료 직행, 진행중→할 일)는 전부 막는다(§상태 정책).
 */
export function canMoveCard(from: BoardColumnId, to: BoardColumnId): boolean {
  if (from === to) return true;
  if (from === BOARD_COLUMN.TODO && to === BOARD_COLUMN.IN_PROGRESS) return true;
  if (from === BOARD_COLUMN.IN_PROGRESS && to === BOARD_COLUMN.DONE) return true;
  if (from === BOARD_COLUMN.DONE && to === BOARD_COLUMN.IN_PROGRESS) return true;
  return false;
}

/** 카드 목록을 칸별로 나눈다. */
export function groupCardsByColumn(
  cards: BoardCard[],
  today: Date,
): Record<BoardColumnId, BoardCard[]> {
  const groups: Record<BoardColumnId, BoardCard[]> = {
    TODO: [],
    IN_PROGRESS: [],
    DONE: [],
  };
  for (const card of cards) {
    groups[getBoardColumn(card, today)].push(card);
  }
  return groups;
}

/**
 * `DragOverlay` 좌표를 화면 배율만큼 보정한다(§appearance/scale `getAppScale`).
 *
 * `body`에 `transform: scale(--app-scale)`(origin `0 0`)이 걸려 있고, 오버레이는
 * 포털로 그 `body` 안에 그려진다. dnd-kit은 오버레이의 초기 위치(`activeNodeRect`)와
 * 이동량(`transform`)을 **화면 px**로 재는데, 그려지는 쪽은 **레이아웃 px**라
 * 배율(s)이 걸리면 초기 위치·이동량이 전부 s배로 눌려 카드가 커서를 못 따라온다
 * (2026-08-19 보고 — 커서와 카드가 점점 벌어지는 문제).
 *
 * 원하는 것: 화면에서 `rect + Δ` 자리에 보이는 것.
 * 그려지는 자리: `s × (rect + t)` (t = 우리가 넘길 transform).
 * 풀면 `t = Δ/s + rect × (1/s − 1)` — 초기 위치 몫과 이동량 몫이 둘 다 들어간다.
 *
 * ⚠️ **충돌 판정은 건드리면 안 된다.** 칸 판정(rect 교차)은 전부 화면 px끼리라 이미 맞다 —
 *    그래서 `DndContext`가 아니라 **`DragOverlay`의 `modifiers`에만** 건다(그리기 전용).
 * ⚠️ 배율 1이면 원본 그대로 돌려준다 — 보정이 항등이어야 배율 없는 화면이 영향을 안 받는다.
 */
export function compensateOverlayForScale<T extends { x: number; y: number }>(
  transform: T,
  activeNodeRect: { top: number; left: number } | null,
  scale: number,
): T {
  if (scale === 1 || scale <= 0 || !activeNodeRect) return transform;
  const stretch = 1 / scale - 1;
  return {
    ...transform,
    x: transform.x / scale + activeNodeRect.left * stretch,
    y: transform.y / scale + activeNodeRect.top * stretch,
  };
}
