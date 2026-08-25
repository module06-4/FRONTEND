"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

import type { BoardCard, BoardType } from "../types";

/**
 * `BoardView`를 **서버 렌더 없이** 불러오는 자리.
 *
 * ⚠️ **여기서만 SSR을 끈다**(2026-08-19, "새로고침마다 hydration mismatch 콘솔 경고가
 *    뜬다"는 지적). 원인은 `@dnd-kit/utilities`의 `useUniqueId`다 — 그 안의 카운터
 *    (`let ids = {}`)가 **모듈 전역**이라, Next 서버 프로세스가 요청마다 그 모듈을
 *    다시 불러오지 않고 카운터가 계속 올라간다. 반면 브라우저는 페이지를 열 때마다
 *    JS를 처음부터 실행해 늘 0에서 시작한다 — 그래서 서버가 그린 `aria-describedby`
 *    (`DndDescribedBy-3`처럼 서버 프로세스가 오래 켜져 있을수록 커지는 값)와 클라이언트가
 *    계산한 값(`DndDescribedBy-0`)이 **두 번째 요청부터 항상** 어긋난다.
 * ⚠️ dnd-kit이 이 id를 밖에서 지정하게 해 주지 않아(`DndContext`의 `accessibility` prop에
 *    id 옵션이 없다) 고칠 자리가 없다 — 라이브러리 쪽 결함이다.
 * ⚠️ **이 화면 전체가 어차피 드래그 상호작용 위젯**이라(정적으로 보여줄 내용이 없다),
 *    서버 렌더를 꺼서 비교 자체를 없앤다 — 데이터는 이미 서버 컴포넌트(`page.tsx`)가
 *    받아 props로 넘기므로 잃는 건 없다. `next/dynamic`의 `ssr: false`는 서버 컴포넌트
 *    안에서 직접 못 써서 이 클라이언트 컴포넌트로 한 겹 감싼다.
 */
const BoardView = dynamic(() => import("./board-view").then((mod) => mod.BoardView), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
      <Skeleton className="h-full w-full rounded-2xl" />
      <Skeleton className="h-full w-full rounded-2xl" />
      <Skeleton className="h-full w-full rounded-2xl" />
    </div>
  ),
});

interface BoardViewLoaderProps {
  boardType: BoardType;
  cards: BoardCard[];
  todayIso: string;
}

export function BoardViewLoader(props: BoardViewLoaderProps) {
  return <BoardView {...props} />;
}
