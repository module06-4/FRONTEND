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
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { getAppScale } from "@/features/appearance/scale";

import { commitBoardChangesAction } from "../actions";
import { canMoveCard, compensateOverlayForScale, getBoardColumn, isCardDelayed } from "../lib";
import {
  BOARD_COLUMN,
  BOARD_COLUMN_LABEL,
  BOARD_COLUMNS,
  BOARD_SAVE_HINT,
  type BoardCard,
  type BoardChange,
  type BoardColumnId,
  type BoardType,
} from "../types";
import { BoardCardOverlay } from "./board-card";
import { BoardColumn } from "./board-column";
import { BoardLeaveGuard } from "./board-leave-guard";

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
 * 보드 칸반 — 드래그로 칸을 옮기고 [저장하기]를 눌러야 실제로 반영된다.
 * ⚠️ 드래그 자체는 로컬 상태만 바꾼다(낙관적 미리보기) — 서버 반영은 확인 창을 거친 뒤
 *    [확인]을 눌러야 `commitBoardChangesAction`이 불린다.
 */
export function BoardView({ boardType, cards, todayIso }: BoardViewProps) {
  const today = useMemo(() => new Date(`${todayIso}T00:00:00`), [todayIso]);
  // 카드 id → 드래그로 옮긴 칸. 없으면 날짜로 계산한 원래 칸을 그대로 쓴다.
  const [overrides, setOverrides] = useState<Record<number, BoardColumnId>>({});
  const [activeInvalidTarget, setActiveInvalidTarget] = useState<BoardColumnId | null>(null);
  /** 지금 손에 들려 있는 카드 id — `DragOverlay`에 띄울 사본을 찾는 용도. */
  const [activeId, setActiveId] = useState<number | null>(null);
  /**
   * 집어든 순간 원본 카드의 실제 폭(px) — `DragOverlay`는 내용 크기에 맞춰 저절로
   * 좁아지므로, 원본과 같은 폭을 직접 지정해 줘야 "같은 카드를 들고 있다"로 보인다
   * (2026-08-09 디자인 리뷰 — 사본이 원본보다 좁아 보이던 문제).
   */
  const [activeWidth, setActiveWidth] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function columnOf(card: BoardCard): BoardColumnId {
    return overrides[card.id] ?? getBoardColumn(card, today);
  }

  /**
   * 서버에 실제로 저장된 칸 — override를 무시한다.
   * ⚠️ **드래그 유효성은 항상 이 값 기준으로 본다**, 화면에 보이는 `columnOf`(override 포함) 기준이
   *    아니다(2026-08-11 버그 수정). override 기준으로 검사하면 두 가지 문제가 있었다:
   *    ① 할일→진행중으로 옮긴 걸 다시 할일로 되돌리려 하면 "진행중→할일은 금지"에 걸려 막혔다 —
   *       원본과 같은 칸으로 돌아가는 건 사실 아무것도 안 바뀐 것인데 금지 규칙이 잘못 적용됨.
   *    ② 할일→진행중→완료를 드래그 두 번으로 이으면 로컬에서는 통과됐지만, 저장 시 서버는
   *       "할일→완료 직행"으로 보고 거부했다(서버는 마지막 상태만 본다) — 잠재 버그였다.
   *    원본 기준으로 보면 되돌리기는 항상 허용(같은 칸)되고, 두 번째 문제도 드래그 시점에
   *    바로 막혀서 저장 실패로 이어지지 않는다.
   */
  function originalColumnOf(card: BoardCard): BoardColumnId {
    return getBoardColumn(card, today);
  }

  const groups: Record<BoardColumnId, BoardCard[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
  for (const card of cards) groups[columnOf(card)].push(card);

  const changeCount = Object.keys(overrides).length;
  const activeCard = cards.find((card) => card.id === activeId) ?? null;

  /**
   * 지연 배지 — **지금 서 있는 칸**(드래그 override 포함)이 진행중일 때만 단다.
   *
   * ⚠️ 칸과 드래그 사본이 **같은 함수**를 쓴다. 따로 적어 두면 한쪽만 고쳐져 같은 카드가
   *    자리에 따라 다른 배지를 단다(2026-08-11 코드래빗 지적).
   * ⚠️ **칸 판정은 여기서 한다** — `isCardDelayed`는 저장된 `isDone`만 보는 `getBoardColumn`을
   *    부르지 않는다(드래그 override를 모른다). 확정 규칙(WORKFLOW.md §7 "진행중 칸 안의
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
    setActiveInvalidTarget(canMoveCard(originalColumnOf(card), targetColumn) ? null : targetColumn);
  }

  /**
   * 카드를 `to` 칸으로 옮긴다 — 드래그 드롭과 키보드 대체 경로(§BoardCard [옮기기] 버튼,
   * #609)가 **같은 함수**를 쓴다. 따로 적어 두면 한쪽만 규칙이 바뀌었을 때 어긋난다.
   */
  function moveCard(card: BoardCard, to: BoardColumnId) {
    if (columnOf(card) === to) return; // 화면에 이미 보이는 칸으로 또 놓은 것 — 아무것도 안 한다.

    const originalColumn = originalColumnOf(card);
    if (originalColumn === to) {
      // 원래 있던 칸으로 되돌아왔다 — 실제로는 변경이 없는 것이니 override를 지운다.
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[card.id];
        return next;
      });
      return;
    }
    if (!canMoveCard(originalColumn, to)) {
      toast.error("여기로는 옮길 수 없습니다");
      return;
    }
    setOverrides((prev) => ({ ...prev, [card.id]: to }));
  }

  /**
   * 카드가 지금 옮겨 갈 수 있는 **유일한** 칸(§canMoveCard) — 없으면 null.
   * `canMoveCard`가 각 칸에서 자기 자신 말고 갈 수 있는 칸을 하나만 허용하므로(할 일→진행중·
   * 진행중→완료·완료→진행중), 원래 칸에 있으면 그 하나뿐인 목적지를, 이미 override로 옮겨져
   * 있으면 원래 칸으로 되돌리는 쪽을 돌려준다 — 규칙은 `canMoveCard` 하나에서만 가져온다.
   */
  function moveTargetFor(card: BoardCard): BoardColumnId | null {
    const original = originalColumnOf(card);
    if (columnOf(card) !== original) return original;
    return (
      BOARD_COLUMNS.find((column) => column !== original && canMoveCard(original, column)) ?? null
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

  function handleConfirm() {
    const changes: BoardChange[] = Object.entries(overrides).map(([id, toColumn]) => ({
      id: Number(id),
      toColumn,
    }));
    startTransition(async () => {
      /*
        ⚠️ **요청 수가 아니라 반영 수를 말한다.** 카드가 그 사이 사라졌거나 옮길 수 없는 칸이면
           액션이 조용히 건너뛴다 — 요청 수를 그대로 적으면 안 옮겨진 것까지 옮겼다고 말한다.
        ⚠️ **던지는 경우도 잡는다.** 돌려주는 실패 값만 보면 Server Action이 reject될 때
           아무 말도 없이 창만 닫힌다 — 사용자는 저장된 줄 안다(§정직성).
      */
      try {
        const { appliedCount } = await commitBoardChangesAction(boardType, changes);
        setOverrides({});
        setConfirmOpen(false);

        if (appliedCount === 0) {
          toast.error("옮기지 못했습니다");
          return;
        }
        toast.success(`${appliedCount}건 반영했습니다`);
      } catch (error) {
        // 토스트 문구 하나로는 "카드가 서버 목록에 없었다"와 "예외가 났다"를 구분할 수 없다 —
        // 재현 시 콘솔에서 실제 원인을 보게 남겨둔다.
        console.error("보드 카드 이동 반영 실패", error);
        setConfirmOpen(false);
        toast.error("옮기지 못했습니다");
      }
    });
  }

  /*
    ⚠️ **하달된 카드 자체가 0건**이면 세 칸도 저장 줄도 뜻이 없다 — 옮길 게 없다.
       이때는 페이지 레벨 `EmptyState`로 바꿔 다른 5화면(내 액션·팀 액션·마이페이지·캘린더·
       프로젝트 타임라인)과 같은 톤으로 "아직 하달된 액션이 없습니다"만 말한다(§정직성).
    ⚠️ 이 분기는 **정말 카드가 0건일 때만** 탄다 — 특정 칸만 비었을 때는 각 칸의
       `BOARD_EMPTY_HINT`("여기로 옮겨 주세요.")가 여전히 유효한 안내라 그대로 둔다.
    ⚠️ `BoardLeaveGuard`도 여기선 필요 없다 — 이동시킬 카드가 없으니 저장 안 한 변경도 없다.
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
      {/* ⚠️ 저장 안 한 드래그가 있으면 링크 클릭·뒤로 가기·탭 닫기를 확인창으로 막는다(WORKFLOW.md §8). */}
      <BoardLeaveGuard hasUnsaved={changeCount > 0} />
      {/*
        ⚠️ **빈 줄에 안내를 둔다.** 버튼 하나만 오른쪽 끝에 떠 있어 그 줄이 통째로 비었고,
           무엇보다 **드래그가 곧 저장이 아니라는 것**을 화면이 말하지 않았다 — 옮겨 놓고
           나가면 되돌아간다(§보드는 저장 전 미리보기).
        ⚠️ 옮긴 게 없으면 문구도 없다. 늘 떠 있으면 안내가 아니라 배경이 된다.
      */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-muted-foreground text-[12px] leading-4">
          {changeCount > 0 ? BOARD_SAVE_HINT : ""}
        </p>
        <Button
          size="sm"
          disabled={changeCount === 0}
          onClick={() => setConfirmOpen(true)}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          저장하기{changeCount > 0 ? ` (${changeCount})` : ""}
        </Button>
      </div>

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
                   지연된 카드를 `완료`로 끌어다 놓아도 배지가 그대로 `지연`이었다 — 보드는
                   저장 전 미리보기 화면이라 눈에 보이는 자리와 배지가 어긋나면 안 된다.
              */
              isDelayed={isDelayedInView}
              isInvalidTarget={activeInvalidTarget === columnId}
              moveTargetOf={moveTargetFor}
              /*
                ⚠️ **되돌리기 워딩용 힌트**(§types `BOARD_REVERT_LABEL`). override가 있으면
                   이 이동은 원본 자리로 돌아가는 취소다 — `moveTargetFor`가 원본을 돌려주는
                   경로가 곧 이 경우다.
              */
              isRevertOf={(card) => columnOf(card) !== originalColumnOf(card)}
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

      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="보드 상태를 저장할까요?"
        description={`${changeCount}건의 상태가 지금 보드에 보이는 대로 바뀝니다.`}
        confirmLabel="저장"
        isPending={isPending}
        pendingLabel="저장 중"
        onConfirm={handleConfirm}
      />
    </div>
  );
}
