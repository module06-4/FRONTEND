import { type NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  isSecureRequest,
  KEEP_SIGNED_IN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
  tokenCookieOptions,
} from "@/features/auth/cookie";
import { BACKEND_BASE_URL, ep } from "@/lib/endpoints";
import { PATHNAME_HEADER } from "@/lib/pathname-header";

/**
 * 문지기 — **로그인 안 한 사람을 로그인 뒤 화면에 들이지 않고, 만료된 토큰은 조용히 갈아끼운다.**
 *
 * ⚠️ 파일명이 `proxy.ts`다. Next 16에서 `middleware.ts`가 이 이름으로 바뀌었다 —
 *    옛 이름으로 두면 뜰 때마다 deprecated 경고가 나온다.
 *
 * ⚠️ **판정은 여기서 끝나지 않는다.** 쿠키가 있는지만 본다 — 그 사람이 이 화면을 볼 권한이
 *    있는지는 **서버 컴포넌트와 Server Action이 다시 본다**(§권한: 화면 숨김은 보안이 아니다).
 * ⚠️ **값을 봐야 하는 가드는 여기 두지 않는다**(온보딩 여부·구독 상태). 그건 매 이동마다
 *    BE 왕복이 붙는다 — 레이아웃에서 한다(`(shell)/layout.tsx` · `guardOnboardingStep`).
 * ⚠️ 목으로 돌 때는 아무것도 안 한다 — 로그인시킬 서버가 없는데 막으면 화면 확인이 불가능하다.
 */

/**
 * 로그인해야 들어갈 수 있는 자리. 괄호 라우트 그룹은 URL에 안 붙으므로 실제 주소로 적는다.
 *
 * ⚠️ **`/system`은 여기 없다.** 시스템 관리자는 기업 계정과 다른 축(`features/system-auth`,
 *    env var 단일 계정)이라 이 목록의 회사 세션 쿠키(`ACCESS_TOKEN_COOKIE`)로 판단하면
 *    안 된다 — `(system)/layout.tsx`가 자기 쿠키로 직접 가드한다.
 */
const PROTECTED_PREFIXES = [
  "/owner",
  "/team",
  "/my",
  "/manage",
  "/app",
  "/onboarding",
  "/subscription",
];

const isMock = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

function withPathname(request: NextRequest) {
  /*
    ⚠️ **요청 헤더에 얹는다.** 응답 헤더에 적으면 브라우저만 보고 서버 컴포넌트는 못 읽는다 —
       `NextResponse.next({ request })`가 이번 렌더에 넘길 헤더를 갈아 끼우는 자리다.
  */
  const headers = new Headers(request.headers);
  /* ⚠️ 조건(`?as=`)까지 싣는다 — 목에서 다른 역할로 화면을 확인할 때 쓴다(`getViewer`). */
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export default async function proxy(request: NextRequest) {
  /*
    ⚠️ 목으로 돌 때는 문지기가 아무도 막지 않는다 — 로그인시킬 서버가 없는데 막으면
       화면 확인이 불가능하다. 대신 **지금 주소만** 실어 보낸다. `getViewer()`가 그 값으로
       `/team`은 팀장, `/my`는 사원 사이드바를 그린다(로그인이 붙으면 세션이 그 자리를 맡는다).
  */
  if (isMock) return withPathname(request);

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  /*
    ⚠️ **액세스 쿠키가 없는데 갱신표가 있으면 재발급할 때다.** 액세스 쿠키 수명을 토큰과
       같은 30분으로 맞춰 뒀기 때문에(`cookie.ts`), 쿠키가 사라진 그 순간이 곧 신호다.
    ⚠️ **여기 말고 할 자리가 없다.** 서버 컴포넌트는 쿠키를 못 굽는다(Next 제약) —
       `getMe()`가 401을 받아도 그 자리에서 새 토큰을 저장할 수 없다.
    ⚠️ 30분에 한 번 도는 호출이라 모든 이동에 왕복이 붙지는 않는다.
  */
  const hasAccess = request.cookies.has(ACCESS_TOKEN_COOKIE);
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!hasAccess && refreshToken) {
    const keepSignedIn = request.cookies.get(KEEP_SIGNED_IN_COOKIE)?.value === "1";
    const reissued = await reissue(refreshToken, keepSignedIn);

    if (reissued) return withSession(request, reissued, keepSignedIn);

    /*
      ⚠️ 갱신표도 죽었다 — **쿠키를 지운다.** 남겨 두면 다음 이동마다 재발급을 다시 시도해
         BE를 계속 두드린다. 지우고 나면 아래 문지기가 로그인 화면으로 보낸다.
    */
    return clearedSession(request, isProtected);
  }

  if (isProtected && !hasAccess) {
    /*
      ⚠️ 원래 가려던 곳(`next`)을 담지 않는다. 로그인 뒤 갈 곳은 **서버가 정하고**
         (`landingPath`), 그 값이 온보딩 여부·권한까지 반영한다 — `next`를 얹으면
         온보딩을 안 끝낸 사람이 대시보드로 튀어 가드에 다시 걸린다.
    */
    return NextResponse.redirect(new URL("/login", request.url));
  }

  /*
    ⚠️ **이미 로그인한 사람을 여기서 로그인 화면 밖으로 밀지 않는다.** 문지기가 아는 건
       "쿠키가 있다"뿐인데, 그 토큰은 폐기됐을 수 있다(BE는 권한이 바뀌면 폐기한다) —
       그러면 로그인하러 온 사람을 홈으로 밀고, 홈은 다시 로그인 화면을 권하는 고리가 생긴다.
       **토큰이 살아 있는지는 `/api/auth/me`를 부르는 쪽만 안다**(`redirectIfSignedIn`).
  */
  return withPathname(request);
}

/**
 * 갱신표로 새 토큰 한 벌 — `POST /api/auth/refresh`([확인] BE `AuthController`, `permitAll`).
 *
 * ⚠️ 경로는 `ep.refresh()`에서 가져온다 — URL 문자열을 손으로 적지 않는다(§엔드포인트 레지스트리).
 *
 * ⚠️ **갱신표도 함께 교체된다**(로테이션). 응답의 새 갱신표를 안 저장하면 다음 재발급이 막힌다.
 * ⚠️ `keepSignedIn`을 같이 보낸다 — 안 보내면 BE가 `false`로 보고 14일짜리를 1일로 줄인다.
 * ⚠️ 실패는 **조용히 `null`이다.** 여기서 던지면 화면이 통째로 500이 된다 — 재발급은
 *    사용자가 요청한 일이 아니라 배경에서 도는 일이라, 안 되면 로그인 화면으로 보내면 된다.
 */
async function reissue(
  refreshToken: string,
  keepSignedIn: boolean,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}${ep.refresh()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, keepSignedIn }),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const envelope: unknown = await response.json();
    const data = (envelope as { data?: { accessToken?: unknown; refreshToken?: unknown } })?.data;
    if (typeof data?.accessToken !== "string" || typeof data?.refreshToken !== "string")
      return null;

    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    // BE가 내려가 있거나 주소가 틀렸다 — 재발급을 못 했을 뿐이라 화면을 죽이지 않는다
    return null;
  }
}

/**
 * 새 토큰을 **요청과 응답 양쪽에** 심고 계속 진행한다.
 *
 * ⚠️ 응답에만 굽으면 **이번 화면은 여전히 옛 쿠키로 그려진다** — 방금 갱신했는데 로그인
 *    화면으로 튕기고, 새로고침해야 들어가진다. `request.cookies`에도 넣어야 이번 요청의
 *    서버 컴포넌트가 새 토큰을 본다.
 */
function withSession(
  request: NextRequest,
  tokens: { accessToken: string; refreshToken: string },
  keepSignedIn: boolean,
) {
  request.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken);
  request.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken);

  const response = NextResponse.next({ request });
  const refreshMaxAge = keepSignedIn ? REFRESH_TOKEN_MAX_AGE : undefined;
  // ⚠️ 재발급한 쿠키도 로그인 때와 **같은 기준**으로 구워야 한다 — 여기만 `secure`가 어긋나면
  //    갱신 직후에 쿠키가 버려져 30분마다 로그인 화면으로 튕긴다.
  const isSecure = isSecureRequest(request.headers.get("x-forwarded-proto"));

  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    tokens.accessToken,
    tokenCookieOptions(ACCESS_TOKEN_MAX_AGE, isSecure),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    tokens.refreshToken,
    tokenCookieOptions(refreshMaxAge, isSecure),
  );
  response.cookies.set(
    KEEP_SIGNED_IN_COOKIE,
    keepSignedIn ? "1" : "0",
    tokenCookieOptions(refreshMaxAge, isSecure),
  );

  return response;
}

/** 갱신표까지 죽었다 — 쿠키를 지우고, 보호 구역이면 로그인 화면으로 보낸다. */
function clearedSession(request: NextRequest, isProtected: boolean) {
  const response = isProtected
    ? NextResponse.redirect(new URL("/login", request.url))
    : NextResponse.next();

  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  response.cookies.delete(KEEP_SIGNED_IN_COOKIE);

  return response;
}

export const config = {
  /** 정적 파일·이미지·API 라우트는 문지기를 거치지 않는다 — 매 요청마다 도는 코드다 */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
