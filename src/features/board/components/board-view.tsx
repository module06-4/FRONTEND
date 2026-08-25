"use client";

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ListChecks } from "lucide-react";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { getAppScale } from "@/features/appearance/scale";

import { commitBoardChangesAction } from "../actions";
import { canMoveCard, compensateOverlayForScale, getBoardColumn, isCardDelayed } from "../lib";
import {
  BOARD_COLUMN,
  BOARD_COLUMN_LABEL,
  BOARD_COLUMNS,
  type BoardCard,
  type BoardColumnId,
  type BoardType,
} from "../types";
import { BoardCardOverlay } from "./board-card";
import { BoardColumn } from "./board-column";

/**
 * 화면 배율이 걸렸을 때 `DragOverlay`가 커서를 따라오게 하는 보정(§lib
 * `compensateOverlayForScale`). ⚠️ `DndContext`가 아니라 **여기(그리기)에만** 건다 —
 * 칸 판정은 화면 px끼리라 이미 맞고, 같이 보정하면 반대로 어긋난다.
 */
const appScaleOverlayModifier: Modifier = ({ transform, activeNodeRect }) =>
  compensateOverlayForScale(transform, activeNodeRect, getAppScale());

interface BoardViewProps {
  boardType: BoardType;
  cards: BoardCard[];
  /** 서버가 렌더링한 오늘(로컬 자정 보정은 클라이언트에서 다시 한다). `YYYY-MM-DD`. */
  todayIso: string;
}

/**
 * 보드 칸반 — 드래그·[옮기기] 버튼으로 놓는 즉시 서버에 반영한다(낙관적 UI).
 *
 * ⚠️ **낙관적 UI + 즉시 저장**(#686, 2026-08-24 변경). React 19 `useOptimistic`으로 드롭 순간
 *    화면을 먼저 바꾸고, `startTransition` 안에서 백그라운드로 `commitBoardChangesAction`을
 *    부른다. 실패하면 `useOptimistic`이 트랜지션 종료 시점에 자동으로 값을 걷어내 원위치되고,
 *    성공하면 `revalidatePath("/app/board")`가 서버 데이터를 다시 가져오면서 새 `cards`가
 *    같은 자리를 보여 준다(§actions `revalidatePath`).
 * ⚠️ 예전엔 로컬 `overrides` + [저장하기] 버튼 + `ConfirmDialog` + `BoardLeaveGuard`로
 *    "저장 전 미리보기" 방식이었다(WORKFLOW.md §8 옛 서술). 확인창이 흐름을 끊는데도
 *    브라우저 크래시·강제 종료엔 무력해 이동이 유실될 수 있었다 — 즉시 저장이 유실 위험도
 *    없애고 확인 단계도 없앤다.
 * ⚠️ 화면·서버 양쪽에서 `canMoveCard`로 전이를 다시 확인한다(§권한: 화면 숨김은 보안이 아니다).
 */
export function BoardView({ boardType, cards, todayIso }: BoardViewProps) {
  const today = useMemo(() => new Date(`${todayIso}T00:00:00`), [todayIso]);

  /**
   * 진행 중인 낙관적 이동 — 카드 id → 옮겨 보인 칸.
   *
   * ⚠️ 트랜지션이 끝나면(성공·실패 무관) 이 값은 자동으로 걷힌다. 성공했으면 `revalidatePath`가
   *    새 `cards`를 내려 그 자리가 실제 저장값으로 채워지고, 실패했으면 빈 override로 돌아가
   *    원위치된 그림이 된다 — 원복 코드를 따로 안 짜도 되는 이유다.
   */
  const [pendingMoves, addPendingMove] = useOptimistic(
    {} as Record<number, BoardColumnId>,
    (state, move: { id: number; to: BoardColumnId }) => ({ ...state, [move.id]: move.to }),
  );
  const [activeInvalidTarget, setActiveInvalidTarget] = useState<BoardColumnId | null>(null);
  /** 지금 손에 들려 있는 카드 id — `DragOverlay`에 띄울 사본을 찾는 용도. */
  const [activeId, setActiveId] = useState<number | null>(null);
  /**
   * 집어든 순간 원본 카드의 실제 폭(px) — `DragOverlay`는 내용 크기에 맞춰 저절로
   * 좁아지므로, 원본과 같은 폭을 직접 지정해 줘야 "같은 카드를 들고 있다"로 보인다
   * (2026-08-09 디자인 리뷰 — 사본이 원본보다 좁아 보이던 문제).
   */
  const [activeWidth, setActiveWidth] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  /**
   * 카드가 지금 보이는 칸 — 낙관적 이동이 있으면 그 값을, 없으면 저장된 값에서 계산한다.
   *
   * ⚠️ **드래그 유효성·다음-단계 버튼도 이 값 기준으로 본다** — 낙관적 이동이 걸린 카드를
   *    한 번 더 옮기려 하면, 사용자 눈에 보이는 자리(`IN_PROGRESS`)를 출발로 삼아야 다음
   *    단계(`DONE`)가 맞다. 저장된 원래 자리(`TODO`)를 기준으로 하면 아직 안 옮겨진 것처럼
   *    다시 시작하기 버튼이 뜬다.
   */
  function columnOf(card: BoardCard): BoardColumnId {
    return pendingMoves[card.id] ?? getBoardColumn(card, today);
  }

  const groups: Record<BoardColumnId, BoardCard[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
  for (const card of cards) groups[columnOf(card)].push(card);

  const activeCard = cards.find((card) => card.id === activeId) ?? null;

  /**
   * 지연 배지 — **지금 서 있는 칸**(낙관적 이동 포함)이 진행중일 때만 단다.
   *
   * ⚠️ 칸과 드래그 사본이 **같은 함수**를 쓴다. 따로 적어 두면 한쪽만 고쳐져 같은 카드가
   *    자리에 따라 다른 배지를 단다(2026-08-11 코드래빗 지적).
   * ⚠️ **칸 판정은 여기서 한다** — `isCardDelayed`는 저장된 `isDone`만 보는 `getBoardColumn`을
   *    부르지 않는다(낙관적 이동을 모른다). 확정 규칙(WORKFLOW.md §7 "진행중 칸 안의
   *    배지")대로 `IN_PROGRESS`일 때만 단다 — 할일 칸(마감 데이터 오류로 dueDate < startDate)이
   *    나 완료 칸에는 안 뜬다.
   */
  function isDelayedInView(card: BoardCard): boolean {
    return columnOf(card) === BOARD_COLUMN.IN_PROGRESS && isCardDelayed(card, today);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(Number(event.active.id));
    setActiveWidth(event.active.rect.current.initial?.width ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!event.over) {
      setActiveInvalidTarget(null);
      return;
    }
    const card = cards.find((c) => c.id === event.active.id);
    const targetColumn = event.over.id as BoardColumnId;
    if (!card) return;
    setActiveInvalidTarget(canMoveCard(columnOf(card), targetColumn) ? null : targetColumn);
  }

  /**
   * 카드를 `to` 칸으로 옮긴다 — 드래그 드롭과 키보드 대체 경로(§BoardCard [옮기기] 버튼,
   * #609)가 **같은 함수**를 쓴다.
   *
   * ⚠️ **낙관적 반영 후 백그라운드 저장**. `addPendingMove`가 화면을 먼저 바꾸고,
   *    `commitBoardChangesAction`이 그 시점의 이동을 서버에 하나 보낸다(#686). 예전엔
   *    로컬에 쌓고 [저장하기]를 눌러야 배치로 나갔다.
   * ⚠️ **실패 시 원복은 useOptimistic이 자동으로** 한다 — 트랜지션이 끝나는 순간 `pendingMoves`가
   *    빈 값으로 돌아가므로, 카드 자리는 저장된 값(`getBoardColumn`)이 다시 결정한다.
   * ⚠️ **성공 토스트는 안 낸다** — 화면이 이미 옮겨진 자리를 보여 주고 있어 토스트는
   *    소음이 된다(§DESIGN 알림 3종: 결과가 화면에 나타나면 토스트는 보조다).
   */
  function moveCard(card: BoardCard, to: BoardColumnId) {
    const from = columnOf(card);
    if (from === to) return;
    if (!canMoveCard(from, to)) {
      toast.error("여기로는 옮길 수 없습니다");
      return;
    }

    startTransition(async () => {
      addPendingMove({ id: card.id, to });
      try {
        /*
          ⚠️ **appliedCount === 0도 실패로 다룬다.** 액션이 던지지 않고도 카드가 서버 목록에서
             사라졌거나 옮길 수 없는 칸이면 조용히 0을 돌려준다(§actions 정직성 주석) — 우리
             쪽에서는 이때 화면이 옮겨진 자리를 잠깐 보여 준 뒤 revalidatePath가 원래 자리로
             되돌리게 되는데, 그 되돌림에 아무 말이 없으면 사용자는 저장된 줄 안다.
        */
        const { appliedCount } = await commitBoardChangesAction(boardType, [
          { id: card.id, toColumn: to },
        ]);
        if (appliedCount === 0) toast.error("옮기지 못했습니다");
      } catch (error) {
        // 낙관적 값은 트랜지션이 끝나면서 자동으로 걷힌다 — 카드는 원래 자리로 돌아간다.
        // 토스트 문구 하나로는 "카드가 서버 목록에 없었다"와 "예외가 났다"를 구분할 수 없으니
        // 재현 시 콘솔에서 실제 원인을 보게 남겨둔다.
        console.error("보드 카드 이동 반영 실패", error);
        toast.error("옮기지 못했습니다");
      }
    });
  }

  /**
   * 카드가 지금 옮겨 갈 수 있는 **유일한** 칸(§canMoveCard) — 없으면 null.
   * `canMoveCard`가 각 칸에서 자기 자신 말고 갈 수 있는 칸을 하나만 허용하므로(할 일→진행중·
   * 진행중→완료·완료→진행중), 지금 보이는 칸에서 갈 수 있는 그 하나를 돌려준다.
   */
  function moveTargetFor(card: BoardCard): BoardColumnId | null {
    const current = columnOf(card);
    return (
      BOARD_COLUMNS.find((column) => column !== current && canMoveCard(current, column)) ?? null
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveInvalidTarget(null);
    setActiveId(null);
    setActiveWidth(null);
    if (!event.over) return;
    const card = cards.find((c) => c.id === event.active.id);
    if (!card) return;
    moveCard(card, event.over.id as BoardColumnId);
  }

  /*
    ⚠️ **하달된 카드 자체가 0건**이면 세 칸이 뜻이 없다 — 옮길 게 없다.
       이때는 페이지 레벨 `EmptyState`로 바꿔 다른 5화면(내 액션·팀 액션·마이페이지·캘린더·
       프로젝트 타임라인)과 같은 톤으로 "아직 하달된 액션이 없습니다"만 말한다(§정직성).
    ⚠️ 이 분기는 **정말 카드가 0건일 때만** 탄다 — 특정 칸만 비었을 때는 각 칸의
       `BOARD_EMPTY_HINT`("여기로 옮겨 주세요.")가 여전히 유효한 안내라 그대로 둔다.
  */
  if (cards.length === 0) {
    /*
      ⚠️ description은 **조작 중립**이다("드래그" 같은 특정 입력 방식 안내 금지) — 카드가
         0건이라 옮길 대상 자체가 없다. 조작 방법(드래그든 [옮기기] 버튼이든)을 적어도
         뜻이 없는 자리라 아예 안 적는다.
    */
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState
          icon={ListChecks}
          title="아직 하달된 액션이 없습니다."
          description="액션이 하달되면 이 자리에 카드로 쌓입니다."
          className="flex-1"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setActiveWidth(null);
        }}
      >
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
          {BOARD_COLUMNS.map((columnId) => (
            <BoardColumn
              key={columnId}
              id={columnId}
              label={BOARD_COLUMN_LABEL[columnId]}
              cards={groups[columnId]}
              /*
                ⚠️ **지금 서 있는 칸으로 판정한다**(2026-08-11 고침). `card.isDone`은 저장된 값이라,
                   낙관적 이동으로 `완료`로 옮긴 카드도 배지가 그대로 `지연`이 될 수 있다 —
                   보이는 자리와 배지가 어긋나면 안 된다.
              */
              isDelayed={isDelayedInView}
              isInvalidTarget={activeInvalidTarget === columnId}
              moveTargetOf={moveTargetFor}
              onMoveCard={moveCard}
            />
          ))}
        </div>

        {/* ⚠️ 포털로 최상단에 그린다 — 칼럼의 overflow-y-auto에 안 잘린다(2026-08-09 디자인 리뷰). */}
        <DragOverlay modifiers={[appScaleOverlayModifier]}>
          {activeCard && (
            <div style={{ width: activeWidth ?? undefined }}>
              {/* ⚠️ 손에 든 사본도 **칸 기준**으로 판정한다 — 아니면 `완료`로 끌고 가는
                  동안에도 사본에만 `지연`이 남아 원본과 다른 말을 한다(코드래빗 지적) */}
              <BoardCardOverlay card={activeCard} isDelayed={isDelayedInView(activeCard)} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
