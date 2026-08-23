import type { NextRequest } from "next/server";

import { ensureAccessToken } from "@/features/auth/session";
import { BACKEND_BASE_URL, ep } from "@/lib/endpoints";

/**
 * 개인 알림 SSE 중계 — **BFF**(CLAUDE.md §렌더링·데이터: "BFF가 스트림을 중계하고 토큰을 주입한다").
 *
 * 브라우저는 우리 주소(`/api/notifications/stream`)만 구독하고, BE와의 대화는 여기가 대신한다.
 * 자막 중계(`api/meetings/[meetingId]/captions/stream`)와 **같은 뼈대**다 — 다른 점은 회의가
 * 아니라 **사람 단위**라 경로에 식별자가 없다는 것뿐이다. 수신자는 BE가 토큰에서 꺼낸다
 * (`NotificationController` — `@AuthenticationPrincipal(expression = "memberId")`).
 *
 * ⚠️ **토큰이 브라우저로 안 나간다**(§핵심 4원칙 ②). `EventSource`는 헤더를 못 붙여서,
 *    브라우저가 BE를 직접 구독하려면 토큰을 쿼리스트링에 실어야 한다 — 그러면 주소창·프록시
 *    로그·리퍼러에 액세스 토큰이 남는다. 중계하면 헤더로 붙일 수 있다.
 * ⚠️ **누구의 스트림인지를 URL이 정하지 않는다.** `?memberId=` 같은 걸 받는 순간 남의 알림을
 *    훔쳐보는 길이 열린다 — BE 주석이 같은 이유로 principal에서만 꺼낸다(§권한: 검증은 서버에서).
 * ⚠️ **본문을 모으지 않고 그대로 흘려보낸다.** `await response.text()`로 받으면 스트림이 끝날
 *    때까지 기다린다 — 알림은 그 순간에 떠야 뜻이 있으므로 영영 안 뜨는 것과 같다.
 * ⚠️ **`no-store`·`no-transform`이 필요하다.** 중간 프록시가 버퍼링하면 알림이 뭉텅이로 몰려
 *    온다. `X-Accel-Buffering: no`는 nginx에게 같은 말을 하는 것이다.
 * ⚠️ **Node 런타임이어야 한다.** 배포가 정적일 수 없는 이유 중 하나다(CLAUDE.md §팀확정).
 */
export const runtime = "nodejs";
/** 스트림이라 캐시가 있으면 안 된다 — 한 사람의 알림이 다른 사람에게 간다 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  /*
    ⚠️ **`getAccessToken()`이 아니라 `ensureAccessToken()`이다.** 이 경로는 `proxy.ts`
       매처에서 제외돼 있어(§matcher) 미들웨어의 자동 재발급을 못 받는다 — SSE는 페이지
       이동 없이 30분 넘게 열려 있을 수 있어, 그냥 읽기만 하면 액세스 토큰 만료 후
       재연결마다 401을 맞는다(2026-08-16 실제 장애).
  */
  const accessToken = await ensureAccessToken();
  if (!accessToken) {
    /*
      ⚠️ **401을 그대로 돌려준다.** 응답이 온 실패라 `EventSource`가 연결을 닫고, 훅은 그
         신호를 보고 **간격을 2초→최대 60초로 늘려 가며** 다시 연다
         (`use-notification-stream.ts`) — 로그인이 풀린 채로 초당 몇 번씩 두드리지 않게
         하려는 것이다. 아주 멈추지는 않는다: 다시 로그인하면 그 자리에서 알림이 돌아와야
         한다(멈춰 두면 사람은 조용한 화면을 정상으로 읽는다, §정직성).
    */
    return new Response("인증이 필요합니다.", { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_BASE_URL}${ep.notificationStream()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/event-stream",
      },
      /*
        ⚠️ 화면을 떠나면 **위쪽 구독도 끊는다.** 안 끊으면 BE의 `NotificationStreamRegistry`에
           죽은 emitter가 쌓이고, 20초마다 하트비트를 계속 밀어 넣는다(BE 실코드 확인).
      */
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("알림 스트림에 연결하지 못했습니다.", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    /*
      ⚠️ **위쪽 상태를 그대로 되쓰지 않는다.** 204·205·304는 본문을 못 싣는 상태라
         `new Response(문구, { status: 204 })`가 그 자리에서 터지고, 라우트는 500으로
         끝난다 — 못 붙었다는 말조차 못 전한다. 성공 계열로 온 실패는 **중계 실패(502)**로
         모은다(우리가 보기엔 스트림을 못 얻은 것이다).
    */
    const status = upstream.status >= 400 ? upstream.status : 502;
    return new Response("알림 스트림에 연결하지 못했습니다.", { status });
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
