import { headers } from "next/headers";

import { AUTHORITY, type Authority } from "@/constants/authority";
import { getMe } from "@/features/auth/me";
import { PATHNAME_HEADER } from "@/lib/pathname-header";
import type { Actor } from "@/lib/permission";
import { isMock } from "@/mocks/config";

/**
 * 지금 보고 있는 사람 — **세션이 붙기 전까지 이 파일 하나가 목이다.**
 *
 * ⚠️ 화면마다 `role: AUTHORITY.OWNER`를 적어 두면, 로그인이 붙었을 때 고칠 자리를 다 찾아야 한다.
 *    셸·결제·완료 창이 전부 여기서 읽는다(Mock → Live 격리막).
 * ⚠️ 실연동 때는 **httpOnly 쿠키의 세션**을 읽는다 — 브라우저가 아니라 서버에서 판정한다
 *    (CLAUDE.md §권한: 화면 숨김은 UX일 뿐 보안이 아니다).
 * ⚠️ **판정은 여기 없다.** 누가 무엇을 할 수 있는지는 `lib/permission.ts` 한 곳이 정한다 —
 *    이 파일은 "지금 보고 있는 사람이 누구인가"만 답한다.
 */
/*
  ⚠️ `Actor`를 그대로 확장한다. 권한 판정(`lib/permission.ts`)이 받는 모양과 어긋나면
     화면마다 `{ id, role, isAdmin }`을 손으로 다시 만들게 되고, 그러다 한 곳을 빠뜨린다.
*/
export interface Viewer extends Actor {
  name: string;
  /**
   * 세션의 기업 id — 결제(`requestCardAuth`의 customerKey)처럼 BE가 principal의
   * companyId와 대조하는 값에 쓴다.
   * ⚠️ 목에서는 `MOCK_COMPANY_ID` 하나로 고정한다 — 화면마다 따로 자리표시자를 박아 두면
   *    (billing 페이지가 그랬다) 실연동 전환 때 그 자리를 다 찾아야 한다(§Mock → Live 격리막).
   */
  companyId: number;
}

/**
 * 목으로 돌 때 **주소가 사람을 정한다** — `/team`은 팀장, `/my`는 사원.
 *
 * ⚠️ **로그인 전까지만이다.** 세션이 붙으면 이 함수는 안 불리고 `getMe()`가 사람을 준다 —
 *    화면을 바꿀 필요가 없도록 판정은 계속 이 파일 한 곳에 있다(§Mock → Live 격리막).
 * ⚠️ 이 값으로 **권한 판정까지 돈다.** 대표 대시보드(`/owner`)를 보는 동안에는 대표고,
 *    팀 화면으로 옮기면 팀장이다 — 목에서 역할별 화면을 확인하려면 이 편이 맞다.
 * ⚠️ `/app/*`은 **전원이 쓰는 공용 워크벤치**라 여기서 가르지 않는다(기본은 대표).
 */
/*
  ⚠️ `teamName`은 **지어낸 값이 아니다** — 같은 id의 사원 목(`features/rooms/mock/members.ts`,
     `features/member/mock/managed.ts`)과 같은 팀이다(§정직한 목업: 화면을 오가는 동안 같은
     사람의 소속이 달라 보이면 안 된다). Owner·System은 팀이 없다(CLAUDE.md §조직 계층).
  ⚠️ 비워 두면 **팀 범위로 도는 화면이 목에서 통째로 빈다**(2026-08-13 채움) — 참석자 피커의
     "자기 팀만"과 예약 폼의 "상위 팀 액션" 목록이 둘 다 `teamName`으로 걸러서다.
*/
/** 목 전용 — 이 도메인이 아직 세션을 안 읽는 동안 회사 하나로 고정한다. */
const MOCK_COMPANY_ID = 1;

const MOCK_PEOPLE: Record<Authority, { id: number; name: string; teamName?: string }> = {
  [AUTHORITY.OWNER]: { id: 1, name: "대표 계정" },
  [AUTHORITY.LEADER]: { id: 2, name: "김서준", teamName: "개발팀" },
  [AUTHORITY.MEMBER]: { id: 3, name: "이하윤", teamName: "개발팀" },
  [AUTHORITY.SYSTEM]: { id: 0, name: "Z 운영자" },
};

/**
 * 목 전용 **미리보기 스위치** — `?as=member`처럼 붙이면 그 역할로 화면을 본다.
 *
 * ⚠️ 주소로만 역할을 정하면 `/owner`는 언제나 대표라, **막히는 화면(403)을 확인할 길이 없다** —
 *    가드가 실제로 도는지 눈으로 보려면 다른 사람으로 그 주소를 열어 봐야 한다.
 * ⚠️ 로그인이 붙으면 이 분기 자체가 안 돈다(`isMock`) — 세션이 사람을 정한다.
 */
function previewRoleFrom(search: string): Authority | null {
  const value = new URLSearchParams(search).get("as")?.toUpperCase();
  if (!value) return null;
  return AUTHORITY_BY_NAME[value] ?? null;
}

const AUTHORITY_BY_NAME: Record<string, Authority> = {
  OWNER: AUTHORITY.OWNER,
  LEADER: AUTHORITY.LEADER,
  MEMBER: AUTHORITY.MEMBER,
};

function mockRoleFor(pathname: string): Authority {
  if (pathname === "/team" || pathname.startsWith("/team/")) return AUTHORITY.LEADER;
  if (pathname === "/my" || pathname.startsWith("/my/")) return AUTHORITY.MEMBER;
  if (pathname === "/system" || pathname.startsWith("/system/")) return AUTHORITY.SYSTEM;
  return AUTHORITY.OWNER;
}

export async function getViewer(): Promise<Viewer> {
  if (isMock) {
    /*
      ⚠️ 주소는 **문지기가 헤더로** 넘겨준다(`proxy.ts`) — 서버 컴포넌트는 지금 주소를 모른다.
      ⚠️ 헤더가 없으면(문지기를 안 거치는 자리) 대표로 둔다 — 지금까지와 같다.
    */
    const url = (await headers()).get(PATHNAME_HEADER) ?? "";
    const [pathname = "", search = ""] = url.split("?");
    const role = previewRoleFrom(search) ?? mockRoleFor(pathname);
    const person = MOCK_PEOPLE[role];

    return {
      id: person.id,
      name: person.name,
      role,
      isAdmin: false,
      teamName: person.teamName,
      companyId: MOCK_COMPANY_ID,
    };
  }

  /*
    ⚠️ **여기서 던지는 건 의도한 것이다.** 누군지 모르는 채로 그린 사이드바는 메뉴도 권한도
       틀린 화면이라, 조용히 빈 값으로 넘기면 더 나쁘다(셸 레이아웃 주석과 같은 판단).
       로그인 안 한 사람은 `middleware.ts`가 이 앞에서 막으므로 여기까지 오지 않는다.
    ⚠️ `teamId`·`teamName`은 **온보딩 전 오너에게 없다** — `null`을 `undefined`로 옮긴다.
       `Actor`는 "없음"을 `undefined`로 적기 때문에, `null`을 그대로 넣으면
       `isWithinTeamScope`가 `null === null`로 **팀이 같다고 판정**한다.
  */
  const me = await getMe();
  if (!me) throw new Error("세션을 읽을 수 없습니다");

  return {
    id: me.id,
    name: me.name,
    role: me.authority,
    isAdmin: me.isAdmin,
    teamId: me.teamId ?? undefined,
    teamName: me.teamName ?? undefined,
    companyId: me.companyId,
  };
}
