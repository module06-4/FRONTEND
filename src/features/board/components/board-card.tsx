"use client";

import { useDraggable } from "@dnd-kit/core";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { ProjectTag } from "@/components/common/project-tag";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { ACTION_DELAYED_LABEL } from "@/constants/action";
import { formatMonthDayWeekday } from "@/lib/date";
import { directionParticle } from "@/lib/korean";
import { pickPaletteColor } from "@/lib/palette";
import { cn } from "@/lib/utils";

import {
  BOARD_COLUMN_LABEL,
  BOARD_NEXT_STEP_LABEL,
  type BoardCard as BoardCardModel,
  type BoardColumnId,
} from "../types";

interface BoardCardProps {
  card: BoardCardModel;
  isDelayed: boolean;
}

interface BoardCardBodyProps extends BoardCardProps {
  actions?: ReactNode;
}

/** 카드 내용 — 실제 카드와 드래그 중 떠다니는 사본(`BoardCardOverlay`)이 같이 쓴다. */
function BoardCardBody({ card, isDelayed, actions }: BoardCardBodyProps) {
  const due = formatMonthDayWeekday(card.dueDate);
  return (
    <>
      {/*
        ⚠️ **왼쪽에 프로젝트 색 띠를 세운다**(2026-08-11). 카드가 흰 상자로 줄줄이 쌓이니 전부
           같은 무게로 읽혀 훑을 때 눈에 안 걸렸다 — 색 한 줄이 카드마다 다른 표식이 되어
           같은 프로젝트끼리 세로로 이어 보인다(검색 `최근 본 항목`·둘러보기와 같은 방식).
        ⚠️ **칩과 겹치는 게 아니다.** 칩은 어느 프로젝트인지(글자), 띠는 훑을 때 걸리는
           표식(색)이다 — 눈은 글자를 읽기 전에 색을 먼저 본다.
        ⚠️ 색은 **태그 이름에서 나온다**(`pickPaletteColor`) — 어느 화면에서든 같은 프로젝트는
           같은 색이다. 상태색(회색·초록·보라)과 다른 팔레트라 뜻이 섞이지 않는다.
        ⚠️ **색이 모서리를 넉넉히 감싼다**(원뿔 그러데이션 테두리, 2026-08-11). 네 번 고쳐 온
           자리다 — 카드 안에 띄운 막대는 위아래가 뜬 **눈금**, 모서리에 붙인 막대는 곡선에 깎여
           **잘린 것**, 왼쪽 테두리(`border-l`)는 색이 곡선 중간에서 회색으로 **뚝 끊긴** 느낌,
           왼쪽 변을 각지게 한 건 곡선을 잃었다.
        ⚠️ 답은 **테두리 전체를 한 겹으로 두고 그 위에 색을 칠하는 것**이다. `conic-gradient`로
           왼쪽 270°를 중심으로 ±55°를 색으로, 나머지를 테두리색으로 칠하면 색이 위·아래
           모서리 곡선을 **타고 넘어가며** 끊기는 자리 없이 이어진다.
        ⚠️ 경계는 10°씩 **번지게** 둔다. 딱 끊으면 그 지점이 또 "끊긴 자리"로 보인다.
        ⚠️ 안쪽 면은 `padding-box`, 색은 `border-box`다 — 한 요소에 배경 두 겹을 겹쳐
           테두리에만 색이 보이게 하는 방법이다.
      */}
      <ColorEdge tag={card.tagLabel} />
      {/*
        ⚠️ **두 세로줄이다**(2026-08-19 재수정 — "날짜가 지금 옮기기 자리에, 그 밑에
           옮기기, 제목·칩은 위로"라는 지적). 왼쪽 줄은 무슨 일인가(제목)·어느 프로젝트인가
           (칩), 오른쪽 줄은 언제까지·다음 걸음(옮기기) — 같은 줄끼리 세로로 쌓이고, 두
           줄은 위아래 같은 높이에서 나란히 간다.
        ⚠️ 글자는 다섯 크기다(DESIGN §4). `text-[13px]`(14px)·`text-[12px] leading-4`(12px)는 규격 밖이라
           13px·12px로 맞춘다.
      */}
      <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-foreground text-[13px] leading-5 font-medium break-keep">
            {card.title}
          </p>

          {/* ⚠️ 공용 칩을 쓴다(`components/common/project-tag`). 여기만 손으로 그린 칩이라 같은
             프로젝트가 회의·검색·보드에서 저마다 다른 모양으로 떴다. */}
          <ProjectTag tag={card.tagLabel} />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {isDelayed ? (
            <StatusDot
              tone="DELAYED"
              label={ACTION_DELAYED_LABEL}
              className="text-[12px] leading-4 font-medium"
            />
          ) : (
            <span className="text-muted-foreground text-[12px] leading-4 tabular-nums">
              {due ? `${due}까지` : "-"}
            </span>
          )}
          {actions}
        </div>
      </div>
    </>
  );
}

/**
 * 카드 겉모양 — 실제 카드와 사본이 같은 값을 쓴다.
 *
 * ⚠️ 라운드는 **20px**이다. 규격(`lg` 10 · `xl` 14 · `2xl` 18)보다 큰 값을 쓰는 이유는 왼쪽
 *    색 막대 때문이다 — 곡선이 커야 얇은 막대(6px) 끝이 둥글게 깎인다(§ColorEdge).
 * ⚠️ 세로 여백은 `py-4`다(2026-08-19 재조정 — `py-6`(원본, 헐렁) → `py-3`(사용자
 *    지적, 지금은 너무 작다) → `py-4`(가운데). 두 세로줄 레이아웃이라 안쪽 내용이
 *    두 줄로 짧아졌으니 여백이 조금 더 필요하다).
 */
const CARD_SHAPE = "border-border bg-card relative flex rounded-[20px] border py-4 pr-4 pl-4";

/** 카드 모서리 반지름(px) — 색 띠가 얇아지기 시작하는 지점이기도 하다 */
const CARD_RADIUS = 20;

/** 직선 구간에서의 색 띠 두께(px) */
const EDGE_WIDTH = 4;

/*
  ⚠️ 모서리 구간의 **두께가 줄어드는** 도형이다. 테두리(`border`)나 곧은 막대로는 안 된다 —
     테두리는 두께가 일정하고, 곧은 막대를 카드가 깎으면 모서리 절반에서 멈춘다.
  ⚠️ 원호를 **96등분**해 바깥선과 안쪽선을 각각 찍고 닫은 다각형이다. 24등분일 때는 직선
     조각이 눈에 보여 가장자리가 울퉁불퉁했다.
  ⚠️ 두께는 **코사인 제곱**으로 줄인다(`W·cos²(πu/2)`). 직선으로 줄이면 직선 구간과 만나는
     자리에서 기울기가 갑자기 꺾여 각이 진다 — 코사인은 시작과 끝 양쪽에서 기울기가 0이라
     직선 구간에서 자연스럽게 이어지고 끝에서도 부드럽게 사라진다(2026-08-11 확정).
  ⚠️ 값은 `CARD_RADIUS`·`EDGE_WIDTH`로 계산해 박아 둔 것이다 — 둘을 바꾸면 이 경로도 다시
     만들어야 한다.
*/
const CORNER_TOP_PATH =
  "M0.00 20.00 L0.04 18.69 L0.17 17.39 L0.38 16.10 L0.68 14.82 L1.06 13.57 L1.52 12.35 L2.06 11.15 L2.68 10.00 L3.37 8.89 L4.13 7.82 L4.96 6.81 L5.86 5.86 L6.81 4.96 L7.82 4.13 L8.89 3.37 L10.00 2.68 L11.15 2.06 L12.35 1.52 L13.57 1.06 L14.82 0.68 L16.10 0.38 L17.39 0.17 L18.69 0.04 L20.00 0.00 L20.00 0.00 L18.70 0.21 L17.43 0.50 L16.20 0.87 L15.00 1.33 L13.84 1.85 L12.73 2.45 L11.67 3.11 L10.67 3.83 L9.72 4.62 L8.84 5.46 L8.02 6.34 L7.27 7.27 L6.59 8.24 L5.98 9.25 L5.45 10.28 L4.99 11.33 L4.60 12.41 L4.29 13.49 L4.06 14.59 L3.90 15.69 L3.82 16.78 L3.81 17.87 L3.87 18.94 L4.00 20.00 Z";
const CORNER_BOTTOM_PATH =
  "M0.00 0.00 L0.04 1.31 L0.17 2.61 L0.38 3.90 L0.68 5.18 L1.06 6.43 L1.52 7.65 L2.06 8.85 L2.68 10.00 L3.37 11.11 L4.13 12.18 L4.96 13.19 L5.86 14.14 L6.81 15.04 L7.82 15.87 L8.89 16.63 L10.00 17.32 L11.15 17.94 L12.35 18.48 L13.57 18.94 L14.82 19.32 L16.10 19.62 L17.39 19.83 L18.69 19.96 L20.00 20.00 L20.00 20.00 L18.70 19.79 L17.43 19.50 L16.20 19.13 L15.00 18.67 L13.84 18.15 L12.73 17.55 L11.67 16.89 L10.67 16.17 L9.72 15.38 L8.84 14.54 L8.02 13.66 L7.27 12.73 L6.59 11.76 L5.98 10.75 L5.45 9.72 L4.99 8.67 L4.60 7.59 L4.29 6.51 L4.06 5.41 L3.90 4.31 L3.82 3.22 L3.81 2.13 L3.87 1.06 L4.00 0.00 Z";

/**
 * 왼쪽 색 띠 — 직선 구간은 제 두께로 서고, **모서리가 시작되는 지점부터 얇아져 모서리가
 * 끝나는 지점에서 사라진다.**
 */
function ColorEdge({ tag }: { tag: string }) {
  const color = pickPaletteColor(tag).solidColor;
  const box = { width: CARD_RADIUS, height: CARD_RADIUS };

  return (
    <span className="pointer-events-none absolute inset-y-0 left-0" aria-hidden>
      <svg className="absolute top-0 left-0" {...box} viewBox={`0 0 ${CARD_RADIUS} ${CARD_RADIUS}`}>
        <path d={CORNER_TOP_PATH} fill={color} />
      </svg>
      <span
        className="absolute left-0"
        style={{
          top: CARD_RADIUS,
          bottom: CARD_RADIUS,
          width: EDGE_WIDTH,
          backgroundColor: color,
        }}
      />
      <svg
        className="absolute bottom-0 left-0"
        {...box}
        viewBox={`0 0 ${CARD_RADIUS} ${CARD_RADIUS}`}
      >
        <path d={CORNER_BOTTOM_PATH} fill={color} />
      </svg>
    </span>
  );
}

interface BoardCardMoveProps {
  /** 카드가 지금 있는 칸(§`BOARD_NEXT_STEP_LABEL` — 다음-단계 워딩을 뽑는다) */
  sourceColumn: BoardColumnId;
  /** 지금 이 카드가 옮겨 갈 수 있는 유일한 칸(§canMoveCard) — 없으면 버튼을 안 그린다. */
  moveTarget: BoardColumnId | null;
  onMove: () => void;
}

/**
 * 보드 카드 한 장 — 드래그 핸들은 카드 전체(클릭해서 상세로 이동하는 화면이 아니라 옮기는 화면).
 * ⚠️ **드래그 중엔 내용을 비운 빈 자리만 남긴다** — 실제로 손에 들려 움직이는 모습은
 *    `BoardCardOverlay`가 `DragOverlay`로 따로 그린다. 처음엔 원본에 반투명 내용을 그대로
 *    두고 `transform`까지 얹었더니, 사본과 원본이 같이 움직여 겹쳐 보이는 "반사"처럼
 *    보였다(2026-08-09 디자인 리뷰) — 원본은 **제자리에 고정된 빈 칸**으로만 남기고
 *    (transform 제거, 내용 숨김), 움직이는 건 사본 하나뿐이어야 한다.
 * ⚠️ **`tabIndex: -1`로 dnd-kit의 기본 포커스를 끈다**(#609). `useDraggable`은 등록된
 *    센서와 무관하게 이 div에 `role="button" tabIndex=0`을 항상 붙이는데, 이 보드엔
 *    `PointerSensor`만 있어 Tab으로 여기 와서 Enter를 눌러도 아무 일도 안 났다 — 누르면
 *    반응해야 하는데 안 하는 가짜 버튼이었다. 진짜 키보드 경로는 아래 [옮기기] 버튼이다
 *    (CLAUDE.md §a11y "DnD 보드는 키보드 대체 경로 필수").
 */
export function BoardCard({
  card,
  isDelayed,
  sourceColumn,
  moveTarget,
  onMove,
}: BoardCardProps & BoardCardMoveProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    attributes: { tabIndex: -1 },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        CARD_SHAPE,
        /*
          ⚠️ 얹으면 **살짝 뜬다**(그림자 + 1px). 집어서 옮기는 카드라 "들린다"는 느낌이 있어야
             드래그할 수 있다는 걸 알아챈다 — 커서 모양은 얹어야 보이고 터치에는 아예 없다.
        */
        "cursor-grab transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md active:cursor-grabbing",
        /*
          ⚠️ **내용만 감춘다**(`[&>*]:invisible`). 감싸는 `div`로 숨기면 그 `div`가 카드의
             가로 배치(띠 + 내용)에 끼어들어 **색 띠가 늘어나질 못한다** — 자식에 바로 건다.
        */
        isDragging && "opacity-40 [&>*]:invisible",
      )}
    >
      <BoardCardBody
        card={card}
        isDelayed={isDelayed}
        actions={
          moveTarget && (
            <Button
              variant="ghost"
              size="xs"
              /*
                ⚠️ **워딩은 목표 칸이 아니라 일 자체다**(2026-08-19, "옮기기 말고 좀 이쁜
                   워딩 없나"라는 지적). `BOARD_MOVE_LABEL`이 목표 칸에 맞춰 시작하기·
                   완료하기·다시 열기를 준다 — "진행중으로 옮기기"보다 사람 말에 가깝고,
                   4자로 맞춰 뒀으니 카드마다 버튼 폭이 흔들리지 않는다.
                ⚠️ `aria-label`은 여전히 어디로 가는지 그대로 말한다 — 스크린리더는 목표
                   칸을 눈으로 못 보므로 `시작하기`만 들리면 어디로인지 알 수 없다.
                ⚠️ **`-mr-2`** — 버튼의 오른쪽 `px-2`(=8px)를 카드 안쪽으로 흡수시킨다.
                   그러면 버튼의 **글자 오른쪽 끝**이 날짜의 오른쪽 끝과 정확히 같은 세로선에
                   붙는다(호버 배경만 8px 더 오른쪽으로 늘어난 채, 카드 안쪽 여백을 잠식하지
                   않는다).
              */
              className="text-muted-foreground hover:text-foreground -mr-2"
              aria-label={`${BOARD_COLUMN_LABEL[moveTarget]}${directionParticle(BOARD_COLUMN_LABEL[moveTarget])} 옮기기`}
              /*
                ⚠️ 드래그 핸들(이 카드 전체)의 pointerdown이 먼저 안 채가게 막는다 — 안 그러면
                   버튼을 눌러도 dnd-kit이 드래그 시작으로 먼저 잡아챈다.
              */
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onMove();
              }}
            >
              {BOARD_NEXT_STEP_LABEL[sourceColumn]}
              <ArrowRight />
            </Button>
          )
        }
      />
    </div>
  );
}

/**
 * 드래그 중 커서를 따라다니는 사본 — `DragOverlay` 안에서만 쓴다.
 * ⚠️ **흐려지지 않는다.** 지금 손에 들고 있는 카드라 원본 카드보다 오히려 진하게(그림자)
 *    보여야 "이걸 옮기는 중"이라는 게 분명하다.
 */
export function BoardCardOverlay({ card, isDelayed }: BoardCardProps) {
  return (
    <div className={cn(CARD_SHAPE, "cursor-grabbing shadow-lg")}>
      <BoardCardBody card={card} isDelayed={isDelayed} />
    </div>
  );
}
