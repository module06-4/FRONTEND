import type { NextRequest } from "next/server";

import { ensureAccessToken } from "@/features/auth/session";
import { BACKEND_BASE_URL, ep } from "@/lib/endpoints";

/**
 * 자막 SSE 중계(CAP-13) — **BFF**.
 *
 * 브라우저는 우리 주소만 구독하고, BE와의 대화는 여기가 대신한다.
 *
 * ⚠️ **토큰이 브라우저로 안 나간다**(§핵심 4원칙 ②). `EventSource`는 헤더를 못 붙여서,
 *    브라우저가 BE를 직접 구독하려면 토큰을 쿼리스트링에 실어야 한다 — 그러면 주소창·
 *    프록시 로그·리퍼러에 액세스 토큰이 남는다. 중계하면 헤더로 붙일 수 있다.
 * ⚠️ **본문을 모으지 않고 그대로 흘려보낸다.** `await response.text()`로 받으면 스트림이
 *    끝날 때까지 기다리므로 실시간이 아니게 된다 — 회의가 끝나야 자막이 뜬다.
 * ⚠️ **`no-store`·`no-transform`이 필요하다.** 중간 프록시가 버퍼링하면 자막이 뭉텅이로
 *    몰려 온다. `X-Accel-Buffering: no`는 nginx에게 같은 말을 하는 것이다.
 * ⚠️ **Node 런타임이어야 한다.** 배포가 정적일 수 없는 이유 중 하나다(CLAUDE.md §팀확정).
 */
export const runtime = "nodejs";
/** 스트림이라 캐시가 있으면 안 된다 — 한 사람의 자막이 다른 사람에게 간다 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  /*
    ⚠️ **`getAccessToken()`이 아니라 `ensureAccessToken()`이다.** 이 경로는 `proxy.ts`
       매처에서 제외돼 있어 미들웨어의 자동 재발급을 못 받는다 — 회의가 30분 넘게 길어지면
       재연결마다 401을 맞는다(알림 스트림과 같은 원인, `session.ts` 주석 참고).
  */
  const accessToken = await ensureAccessToken();
  if (!accessToken) {
    return new Response("인증이 필요합니다.", { status: 401 });
  }

  const { meetingId } = await params;
  /*
    ⚠️ **숫자인지 본다.** 그냥 `Number()`하면 `NaN`이 경로에 박혀 BE에 뜻 없는 요청이 나가고,
       돌아오는 오류가 "무엇이 잘못됐는지"를 말해 주지 못한다.
  */
  const meetingIdNumber = Number(meetingId);
  if (!Number.isInteger(meetingIdNumber) || meetingIdNumber <= 0) {
    return new Response("잘못된 회의 주소입니다.", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_BASE_URL}${ep.captionsStream(meetingIdNumber)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/event-stream",
      },
      /*
        ⚠️ 화면을 떠나면 **위쪽 구독도 끊는다.** 안 끊으면 BE에 죽은 구독이 쌓이고,
           하트비트를 계속 밀어 넣는다.
      */
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("자막 스트림에 연결하지 못했습니다.", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("자막 스트림에 연결하지 못했습니다.", { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
