import { AUTHORITY, type Authority, AUTHORITY_LABEL } from "@/constants/authority";
import { NotificationProvider } from "@/features/notification/notification-provider";

import { dashboardFor, navFor } from "../nav-config";
import type { Viewer } from "../viewer";
import { RoleSidebar } from "./role-sidebar";

/**
 * 역할별 사이드바를 **한 화면에 늘어놓는 개발용 화면**.
 *
 * ⚠️ **제품 화면이 아니다.** 명세에 없다(§라우트 그룹: 명세에 없는 화면은 안 만든다) —
 *    목을 네 번 바꿔 가며 확인하는 대신 네 벌을 나란히 놓고 배치를 판단하려고 둔 것이다.
 *    배포 전에 지울지 팀이 정한다. 그래서 화면 안에도 개발용이라고 적는다(§정직성).
 * ⚠️ **실제 컴포넌트를 그대로 쓴다.** 그림을 따로 그리면 진짜 사이드바와 어긋나서,
 *    여기서 괜찮아 보이던 게 실제로는 다르게 나온다.
 */

interface PreviewCase {
  key: string;
  title: string;
  note: string;
  viewer: Viewer;
}

const person = (role: Authority, name: string, isAdmin = false): Viewer => ({
  id: 1,
  name,
  role,
  isAdmin,
  companyId: 1,
});

/**
 * 보여줄 경우들.
 *
 * ⚠️ **Admin 겸직을 역할마다 따로 둔다.** Admin은 역할이 아니라 덧붙는 권한이라
 *    (WORKFLOW §9), "Leader + Admin"과 "Member + Admin"이 서로 다른 사이드바가 된다 —
 *    한 줄로 뭉뚱그리면 그 차이를 못 본다.
 * ⚠️ Owner는 겸직 경우를 두지 않는다. **Owner는 Admin을 겸할 수 없다**(`canGrantAdmin`).
 */
const CASES: PreviewCase[] = [
  {
    key: "owner",
    title: AUTHORITY_LABEL[AUTHORITY.OWNER],
    note: "회사 운영이 늘 보인다. 계정 발급은 사원 관리 화면 안 버튼이다",
    viewer: person(AUTHORITY.OWNER, "박대표"),
  },
  {
    key: "leader",
    title: AUTHORITY_LABEL[AUTHORITY.LEADER],
    note: "팀 관리 구역이 붙는다. 회사 운영은 없다",
    viewer: person(AUTHORITY.LEADER, "김팀장"),
  },
  {
    key: "leader-admin",
    title: `${AUTHORITY_LABEL[AUTHORITY.LEADER]} + Admin`,
    note: "팀 관리를 그대로 두고 회사 운영이 덧붙는다 — 권한을 갈아치우지 않는다",
    viewer: person(AUTHORITY.LEADER, "김팀장", true),
  },
  {
    key: "member",
    title: AUTHORITY_LABEL[AUTHORITY.MEMBER],
    note: "워크벤치만 본다",
    viewer: person(AUTHORITY.MEMBER, "이사원"),
  },
  {
    key: "member-admin",
    title: `${AUTHORITY_LABEL[AUTHORITY.MEMBER]} + Admin`,
    note: "사원인 채로 회사 운영이 덧붙는다. 기업 설정·인수인계서 관리는 Owner 것이라 없다",
    viewer: person(AUTHORITY.MEMBER, "이사원", true),
  },
];

export function NavPreview() {
  return (
    <div className="bg-background min-h-screen-z overflow-x-auto p-8">
      <div className="mx-auto w-fit">
        <header className="pb-6">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.48px]">권한별 사이드바</h1>
          {/*
            ⚠️ **개발용이라고 화면에 적는다.** 안 적으면 다음 사람이 제품 화면으로 알고
               링크를 걸거나 명세에 없는 화면을 유지보수하게 된다(§정직성).
          */}
          <p className="text-muted-foreground pt-1.5 text-[13px] leading-5 break-keep">
            배치를 비교하려고 둔 개발용 화면입니다. 명세에 없는 화면이라 배포 전에 지울지 정해야
            합니다. 실제 사이드바 컴포넌트를 그대로 그립니다.
          </p>
        </header>

        <div className="flex items-start gap-5">
          {CASES.map((item) => (
            <PreviewColumn key={item.key} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewColumn({ item }: { item: PreviewCase }) {
  return (
    <section className="flex w-[220px] shrink-0 flex-col gap-2.5">
      <div className="min-h-[72px]">
        <h2 className="text-[17px] leading-7 font-semibold tracking-[-0.3px]">{item.title}</h2>
        <p className="text-muted-foreground/80 pt-1 text-[12px] leading-[18px] break-keep">
          {item.note}
        </p>
      </div>

      {/*
        ⚠️ **높이를 고정하지 않는다.** 620px으로 묶었더니 항목이 많은 역할(Leader + Admin은
           구역 넷·항목 스물)에서 아래가 잘렸다 — 배치를 비교하려고 만든 화면인데 정작
           비교할 항목이 안 보였다.
        ⚠️ 사이드바 안의 `nav`는 `flex-1 overflow-y-auto`라, 높이를 안 주면 내용만큼 늘어나
           스크롤이 안 생긴다. 열마다 높이가 달라지는 건 의도다 — 그 차이가 곧 정보다.
      */}
      {/*
        ⚠️ **자기만의 `NotificationProvider`로 감싼다.** `RoleSidebar`가 이제 종 드롭다운의
           안 읽은 알림을 읽는다(`role-sidebar.tsx`) — 실제 셸 밖인 이 개발용 화면에서
           프로바이더 없이 그리면 `useNotificationCenter`가 곧바로 던진다. 넷 다 알림이
           없어 점은 안 뜨지만, 그래도 배치는 실제 사이드바와 똑같이 나온다.
      */}
      <div className="border-border overflow-hidden rounded-xl border">
        <NotificationProvider>
          <RoleSidebar
            sections={navFor(item.viewer)}
            home={dashboardFor(item.viewer.role)}
            user={item.viewer}
          />
        </NotificationProvider>
      </div>
    </section>
  );
}
