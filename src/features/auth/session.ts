import "server-only";

import { cookies, headers } from "next/headers";

import { BACKEND_BASE_URL, ep } from "@/lib/endpoints";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  isSecureRequest,
  KEEP_SIGNED_IN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
  tokenCookieOptions,
} from "./cookie";

/**
 * 세션 — **httpOnly 쿠키 한 곳**(CLAUDE.md §렌더링·데이터: `localStorage` 토큰 금지).
 *
 * BE는 토큰을 본문으로 내리고 쿠키를 굽지 않는다(`TokenResponse.java` 주석) — 굽는 건 여기다.
 * 그래서 도메인·SameSite·수명을 **이 파일과 `cookie.ts`**가 정한다.
 *
 * ⚠️ **액세스 쿠키는 토큰과 같은 30분짜리다**(`ACCESS_TOKEN_MAX_AGE`). 토큰보다 길게 두면
 *    서버에서 죽은 토큰이 쿠키에 남아 재발급할 때를 알 수 없다 — 그 상태가 곧 "로그아웃"이 됐다.
 * ⚠️ 갱신표로 다시 받아 오는 일은 **`proxy.ts`가 한다.** 서버 컴포넌트는 쿠키를 못 굽기
 *    때문이다(Next 제약: `cookies().set`은 Server Action·Route Handler·미들웨어에서만 된다).
 *    그래서 `getMe()`가 401을 받았을 때 그 자리에서 갱신할 수 없다.
 */

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export async function setSession(tokens: SessionTokens, keepSignedIn: boolean): Promise<void> {
  const jar = await cookies();
  /*
    ⚠️ **이 요청이 https로 들어왔는지를 보고** `secure`를 정한다. `NODE_ENV`로 정하면
       http로 띄운 서버에서 쿠키가 통째로 버려져 로그인이 안 된다(`cookie.ts` 참고).
  */
  const isSecure = isSecureRequest((await headers()).get("x-forwarded-proto"));

  jar.set(
    ACCESS_TOKEN_COOKIE,
    tokens.accessToken,
    tokenCookieOptions(ACCESS_TOKEN_MAX_AGE, isSecure),
  );
  /*
    ⚠️ "로그인 상태 유지"를 끄면 갱신표는 **세션 쿠키**다(수명 없음) — 브라우저를 닫으면 사라진다.
       공용 PC에서 체크를 끄는 사람이 기대하는 동작이다.
  */
  jar.set(
    REFRESH_TOKEN_COOKIE,
    tokens.refreshToken,
    tokenCookieOptions(keepSignedIn ? REFRESH_TOKEN_MAX_AGE : undefined, isSecure),
  );
  /*
    ⚠️ 재발급할 때 이 값을 BE에 같이 보내야 갱신표 수명이 로그인 때와 같게 유지된다.
       안 보내면 BE가 `false`로 보고(`keepSignedInOrFalse`) 14일짜리가 1일로 줄어든다.
  */
  jar.set(
    KEEP_SIGNED_IN_COOKIE,
    keepSignedIn ? "1" : "0",
    tokenCookieOptions(keepSignedIn ? REFRESH_TOKEN_MAX_AGE : undefined, isSecure),
  );
}

/** 로그인한 사람의 토큰. 없으면 `null` — 부르는 쪽이 로그인 화면으로 보낸다. */
export async function getAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_TOKEN_COOKIE);
  jar.delete(REFRESH_TOKEN_COOKIE);
  jar.delete(KEEP_SIGNED_IN_COOKIE);
}

/**
 * 토큰이 있어야 하는 자리에서 꺼낸다 — 없으면 던진다.
 * ⚠️ 화면 가드가 아니라 **호출 직전의 마지막 확인**이다. 실제 인가는 BE가 한다(§권한).
 */
export async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("로그인이 필요합니다.");
  return token;
}

/**
 * 갱신표로 새 토큰 한 벌 — `proxy.ts`의 `reissue()`와 같은 호출이다.
 *
 * ⚠️ **`proxy.ts`와 코드를 공유하지 않는다.** `proxy.ts`는 Edge 미들웨어라 `server-only`인
 *    이 파일을 import할 수 없다(파일 위 주석 참고) — 그래서 같은 호출을 각자 갖고 있다.
 * ⚠️ 갱신표도 함께 교체된다(로테이션). 실패는 조용히 `null`이다.
 */
async function reissueTokens(
  refreshToken: string,
  keepSignedIn: boolean,
): Promise<SessionTokens | null> {
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
    return null;
  }
}

/**
 * 액세스 토큰을 꺼내되, 없으면 **여기서 한 번 재발급을 시도한다**.
 *
 * ⚠️ **Route Handler 전용이다.** `proxy.ts`(미들웨어)를 안 거치는 경로 — SSE 중계
 *    (`/api/notifications/stream`·`/api/meetings/[id]/captions/stream`)가 이걸 써야 한다.
 *    미들웨어 매처가 `/api/*`를 제외하고 있어(`proxy.ts` §matcher), 이 경로들은 액세스
 *    쿠키가 30분 만에 사라져도 미들웨어의 자동 재발급을 못 받는다 — 페이지 이동 없이
 *    오래 열려 있는 SSE 연결이 30분을 넘기면 재연결마다 401을 맞던 원인이 이것이다.
 * ⚠️ 서버 컴포넌트에서는 쓰지 않는다 — `cookies().set()`은 Server Action·Route Handler·
 *    미들웨어에서만 허용된다(Next 제약, 위 파일 주석 참고).
 */
export async function ensureAccessToken(): Promise<string | null> {
  const existing = await getAccessToken();
  if (existing) return existing;

  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) return null;

  const keepSignedIn = jar.get(KEEP_SIGNED_IN_COOKIE)?.value === "1";
  const reissued = await reissueTokens(refreshToken, keepSignedIn);
  if (!reissued) {
    await clearSession();
    return null;
  }

  await setSession(reissued, keepSignedIn);
  return reissued.accessToken;
}
