"use client";

import { useDroppable } from "@dnd-kit/core";

import { cn } from "@/lib/utils";

import {
  BOARD_BLOCKED_HINT,
  BOARD_COLUMN,
  BOARD_EMPTY_HINT,
  type BoardCard as BoardCardModel,
  type BoardColumnId,
} from "../types";
import { BoardCard } from "./board-card";

interface BoardColumnProps {
  id: BoardColumnId;
  label: string;
  cards: BoardCardModel[];
  isDelayed: (card: BoardCardModel) => boolean;
  /** 지금 드래그 중인 카드가 여기로 못 오면(§canMoveCard) 놓는 순간 시각적으로도 알린다. */
  isInvalidTarget: boolean;
  /** 카드별 키보드 대체 경로(§canMoveCard) — 갈 수 있는 칸이 없으면 null(#609). */
  moveTargetOf: (card: BoardCardModel) => BoardColumnId | null;
  onMoveCard: (card: BoardCardModel, to: BoardColumnId) => void;
}

/**
 * 칸 머리의 색 — **상태점이 쓰는 그 색 그대로**다(할 일=회색·진행중=초록·완료=보라).
 *
 * ⚠️ 새 색을 만들지 않는다. `--status-*`는 상태를 가리키는 색으로 이미 정해져 있고
 *    (DESIGN §5: 상태점은 색을 써도 되는 자리), 보드의 칸은 그 상태 자체다 — 같은 뜻에
 *    같은 색을 쓰는 것이라 뜻이 둘로 갈리지 않는다.
 * ⚠️ **아주 옅게 쓴다**(배경 10%·점 100%). 머리를 진하게 칠하면 정작 읽어야 할 카드보다
 *    머리가 먼저 읽힌다 — 색은 "여기가 무슨 칸인가"를 스치듯 알리는 몫이다.
 */
const COLUMN_TONE: Record<
  BoardColumnId,
  { head: string; dot: string; count: string; empty: string }
> = {
  [BOARD_COLUMN.TODO]: {
    head: "bg-status-todo/10",
    dot: "bg-status-todo",
    count: "text-status-todo",
    empty: "border-status-todo/25 text-status-todo/70",
  },
  [BOARD_COLUMN.IN_PROGRESS]: {
    head: "bg-status-progress/10",
    dot: "bg-status-progress",
    count: "text-status-progress",
    empty: "border-status-progress/25 text-status-progress/70",
  },
  [BOARD_COLUMN.DONE]: {
    head: "bg-status-done/10",
    dot: "bg-status-done",
    count: "text-status-done",
    empty: "border-status-done/25 text-status-done/70",
  },
};

export function BoardColumn({
  id,
  label,
  cards,
  isDelayed,
  isInvalidTarget,
  moveTargetOf,
  onMoveCard,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const tone = COLUMN_TONE[id];
  const isBlocked = isOver && isInvalidTarget;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        /*
          ⚠️ **칸 바탕을 비운다**(2026-08-11). 세 칸에 회색(`bg-secondary/30`)을 깔았더니 화면
             대부분이 회색 면이라 **시멘트처럼** 보였고, 그 위의 흰 카드는 오히려 묻혔다 —
             칸을 알리는 일은 테두리와 머리 색이 하고, 바탕은 셸과 같은 색으로 비운다.
        */
        "border-border flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border transition-all",
        isOver &&
          (isBlocked
            ? /*
                ⚠️ **못 놓는 자리는 점선이다**(2026-08-10). 실선 테두리에 옅은 빨강만 깔았더니
                   "여기가 지금 대상"과 "여기는 안 된다"가 같은 생김새라, 색이 조금 붉은지
                   눈여겨봐야 알 수 있었다 — **끊긴 선**은 색을 못 보는 사람에게도 막힌 자리로
                   읽힌다(§DESIGN 5: 색 하나로만 알리지 않는다).
                ⚠️ 빨강은 **토큰(`--destructive`)을 옅게** 쓴다. 진한 경고색을 그대로 두면
                   드래그 중 화면 절반이 빨개져 에러가 난 것처럼 보인다.
                ⚠️ **커지지 않는다.** 받아 주는 칸만 살짝 커져야 그 차이가 뜻을 갖는다.
              */
              "border-destructive/45 bg-destructive/[0.04] border-2 border-dashed"
            : // ⚠️ 점선(두껍게)+살짝 확대 — "여기로 옮기려는 중"이 배경색 하나보다 분명하게 보이도록(2026-08-09 디자인 리뷰).
              "border-foreground/60 bg-secondary/60 scale-[1.02] border-2 border-dashed"),
      )}
    >
      {/*
        ⚠️ **머리에도 옅게 깐다.** 셋이 회색 상자 세 개로 똑같이 생겨서 제목 글자를 읽어야만
           어느 칸인지 알 수 있었다 — 색은 훑을 때 걸리는 표식이고, 글자는 그다음이다.
      */}
      <div className={cn("shrink-0", isBlocked ? "bg-destructive/[0.06]" : tone.head)}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="flex items-center gap-2">
            {/* 점은 상태점과 같은 색·같은 크기다(`components/common/status-dot`) */}
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                isBlocked ? "bg-destructive" : tone.dot,
              )}
              aria-hidden
            />
            {/* 글자는 다섯 크기다(DESIGN §4) — `text-[13px]`·`text-[12px] leading-4`는 규격 밖이라 13px·12px로 맞춘다 */}
            <h3 className="text-[13px] leading-5 font-semibold">{label}</h3>
          </span>
          {/*
            ⚠️ **개수를 알약에 담는다**(2026-08-11). 맨 숫자 하나가 오른쪽 끝에 떠 있어 제목과
               한 줄인지 아닌지 애매했다 — 상자에 담으면 "이 칸에 든 수"라는 게 모양으로 읽힌다.
            ⚠️ 바탕은 머리 색 위에 얹는 **흰 반투명**이다. 새 회색을 만들지 않으면서 칸마다
               제 머리 색과 어울린다.
          */}
          {/*
            ⚠️ 개수 **글자만** 그 칸의 상태색이다. 알약 바탕은 흰 반투명이라 칸마다 제 머리 색
               위에 얹히고, 색은 점·글자 둘만 든다 — 면까지 물들이면 머리가 카드보다 진해진다.
          */}
          <span
            className={cn(
              "bg-card/70 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-4 font-semibold tabular-nums",
              isBlocked ? "text-destructive" : tone.count,
            )}
          >
            {cards.length}
          </span>
        </div>
        {/* ⚠️ 머리와 카드를 가르는 선 — 색은 세로 띠가 맡으므로 여기선 보통 테두리색이다 */}
        <div
          className={cn("h-px w-full", isBlocked ? "bg-destructive/30" : "bg-border")}
          aria-hidden
        />
      </div>

      <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {cards.length === 0 ? (
          /*
            ⚠️ **빈 칸에도 자리를 그린다**(2026-08-11). 글자 한 줄만 띄워 두니 그 아래가 통째로
               빈 흰 면이라 칸이 죽어 보였다 — 점선 상자는 "여기에 카드가 들어온다"를 모양으로
               말한다(드래그로 옮기는 화면이라 더 그렇다).
            ⚠️ 점선과 글자는 그 칸의 상태색을 옅게 쓴다. 새 색이 아니라 머리와 같은 색이라
               칸 하나가 한 덩이로 읽힌다.
          */
          /* ⚠️ **못 놓는 칸에는 권하지 않는다**(코드래빗 지적) — 끌고 온 카드가 못 오는
             자리인데 "여기로 옮겨 주세요"가 떠 있으면 화면이 서로 다른 말을 한다(§정직성) */
          <p
            className={cn(
              "flex h-24 items-center justify-center rounded-xl border border-dashed text-[12px] leading-4",
              isBlocked ? "border-destructive/25 text-destructive/70" : tone.empty,
            )}
          >
            {isBlocked ? BOARD_BLOCKED_HINT : BOARD_EMPTY_HINT}
          </p>
        ) : (
          cards.map((card) => {
            const moveTarget = moveTargetOf(card);
            return (
              <BoardCard
                key={card.id}
                card={card}
                isDelayed={isDelayed(card)}
                sourceColumn={id}
                moveTarget={moveTarget}
                onMove={() => moveTarget && onMoveCard(card, moveTarget)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
