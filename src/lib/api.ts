import "server-only";

import { BACKEND_BASE_URL } from "./endpoints";
import { isErrorTag } from "./error-tag";
import { pushLokiLog } from "./loki";

/**
 * BE 호출 창구 — **Next 서버에서만** 돈다(§핵심 4원칙 ②).
 *
 * 브라우저는 Next 서버(Server Action·Route Handler)에만 말을 걸고, BE와의 대화는 여기가 대신한다.
 * 토큰은 httpOnly 쿠키에서 읽어 헤더로 붙이므로 **브라우저 JS는 토큰을 못 본다.**
 *
 * ⚠️ **봉투를 벗기는 일은 여기 한 곳에서만 한다.** 성공·실패 봉투 모양이 **서로 다르다**
 *    (인수인계 API 연동 가이드, 2026-08-10로 실코드 대조 확인):
 *    성공 = `{ httpStatus, message, data }`, 실패 = `{ errorCode, message, timestamp, path,
 *    traceId, details }` — 실패 쪽엔 `data`가 없고 코드는 **top-level `errorCode`**다.
 *    컴포넌트가 봉투를 알면 모양이 바뀔 때 전 화면을 고쳐야 한다(§연동 검증).
 * ⚠️ `message`는 **화면에 그대로 띄울 한국어 문장**이다. 코드로 문구를 조립하지 않는다.
 * ⚠️ 실패의 `errorCode`(`HO-016` 등)는 **분기용**이다 — 사람에게 보여 주는 건 `message`다.
 */

interface ApiEnvelope<T> {
  httpStatus: number;
  message: string;
  data: T;
}

/**
 * BE가 돌려준 실패.
 * ⚠️ `message`를 그대로 화면에 쓴다. `code`는 흐름을 가를 때만 본다(예: `ALREADY_ONBOARDED`).
 */
/**
 * BE 실패 봉투의 `details` 한 원소 — 필드 검증 에러 표준 포맷.
 *
 * ⚠️ **회의 검토 확정(MEETING_409_5)이 이 배열을 재사용해 사유별 건수를 실어 보낸다**
 *    (BE 담당자 협의, 2026-08-18) — `{field: "STILL_PENDING", reason: "3"}`처럼 사유 코드에
 *    건수를 담아 준다. 원래 필드 검증(입력 스키마 위반) 자리에 쓰던 포맷이지만, "필드 이름
 *    자리에 사유 코드를 담는다"는 재사용이라 화면이 확정 실패 문구 조립에도 그대로 활용한다.
 */
export interface ApiErrorDetail {
  field: string;
  reason: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /**
     * BE가 실패 봉투에 실어 준 추적 번호 — **BE 로그를 찾는 열쇠**다.
     *
     * ⚠️ 사람에게 보여 주는 값이 아니라 **원인을 찾는 값**이다. 500처럼 문구가
     *    "서버 내부 오류"뿐인 실패는 이 번호가 없으면 어느 요청이었는지 특정할 수 없다 —
     *    Server Action은 브라우저 네트워크 탭에도 안 잡혀서 더욱 그렇다(2026-08-12).
     */
    readonly traceId?: string,
    /**
     * BE가 실어 준 세부 정보 — 필드 검증 에러 포맷(`[{field, reason}]`). 원래는 입력 스키마
     * 위반 자리에 쓰지만, 회의 검토 확정(MEETING_409_5)이 사유별 건수 요약에도 재사용한다
     * (BE 담당자 협의, 2026-08-18). 있을 때만 담긴다.
     */
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiInit extends Omit<RequestInit, "body"> {
  /** JSON으로 직렬화해 보낼 본문 */
  json?: unknown;
  /** 붙일 액세스 토큰. 로그인 전 화면(코드 조회·등록 신청·로그인)은 넘기지 않는다. */
  accessToken?: string;
  /** 이 호출만 더/덜 기다린다. 안 넘기면 {@link DEFAULT_TIMEOUT_MS} */
  timeoutMs?: number;
  /**
   * 성공 응답이 **공용 봉투**(`{ httpStatus, message, data }`)에 담겨 오는가. 기본 `true`.
   *
   * ⚠️ **BE가 전부 봉투를 씌우지는 않는다**(2026-08-13 실코드 대조). 컨트롤러가 `ApiResponse<T>`를
   *    리턴하면 봉투가 씌워지고, DTO를 그대로 리턴하면 **맨몸으로 나간다** — 전역으로 감싸 주는
   *    `ResponseBodyAdvice`가 BE에 없어서 메서드마다 다르다. 실제로 `BillingController`는
   *    `GET /billing-config`·`GET /billing`·`POST /subscription/cancel`은 씌우고,
   *    **`POST /subscription/pay`·`POST /payment-methods`는 안 씌운다.**
   * ⚠️ 맨몸 응답에 기본값(`true`)을 쓰면 `raw.data`가 없어 **조용히 `undefined`가 흘러간다** —
   *    호출부는 성공한 줄 알고 빈 값을 그린다(§정직성: 되는 척 금지). 그래서 `false`를
   *    넘기는 자리는 **반드시 컨트롤러 실코드를 보고** 정한다(§연동 검증).
   * ⚠️ 벗기는 규칙 자체는 여전히 **이 파일 한 곳**에 있다. 호출부는 "봉투가 있냐 없냐"만
   *    선언하고, 봉투 모양은 모른다 — 모양이 바뀌면 고칠 곳은 여기다.
   */
  isEnveloped?: boolean;
}

/**
 * 기다리는 상한.
 *
 * ⚠️ **`fetch`는 기본 타임아웃이 없다.** BE가 답을 안 주면 서버 액션이 영영 안 끝나고,
 *    화면은 [등록 중]에서 굳은 채 취소도 못 한다 — 새로고침 말고는 길이 없다
 *    (2026-08-12 배포 서버에서 실제로 겪었다).
 * ⚠️ 값이 짧으면 멀쩡한 요청을 끊고, 길면 사람이 굳은 화면을 오래 본다. 15초는
 *    "느린 것"과 "안 오는 것"을 가르는 자리다 — 더 걸리는 호출은 `timeoutMs`로 따로 늘린다.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * BE 호출 + 봉투 벗기기.
 *
 * ⚠️ 조회 기본값은 `no-store`다. 사내 도구라 사람마다 보이는 값이 다른데, 기본 캐시에 걸리면
 *    남의 화면이 다른 사람에게 보인다. 캐시가 필요한 자리에서 호출부가 `cache`를 넘긴다.
 */
export async function serverApi<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, accessToken, headers, timeoutMs, signal, isEnveloped = true, ...rest } = init;

  /*
    ⚠️ 부르는 쪽이 준 `signal`이 있으면 **둘 다** 산다(`AbortSignal.any`) — 타임아웃으로
       덮어쓰면 호출부가 직접 끊을 방법이 사라진다.
  */
  const timeout = AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...rest,
    headers: {
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

  /*
    ⚠️ 본문이 없는 응답(204·게이트웨이 오류)도 있다. `response.json()`을 그냥 부르면
       파싱 예외가 나서 **BE가 준 상태 코드가 사라진다** — 무슨 일이 났는지 알 수 없게 된다.
  */
  const raw: unknown = await response.text().then((text) => {
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  });

  if (!response.ok) {
    const apiError = toApiError(response.status, raw);
    /*
      ⚠️ **5xx만 쏜다.** `toErrorTag`와 같은 경계다 — 4xx는 사람이 고칠 수 있는 실패라
         문장이 이미 원인을 말한다. 5xx는 화면 문구만으론 BE 로그를 못 찾으니 Loki에 남긴다.
    */
    if (response.status >= 500) {
      /*
        ⚠️ **로그 전송이 원래 실패를 가리면 안 된다.** `pushLokiLog`가 (설정 오류 등으로)
           동기적으로 던지더라도 화면은 원래의 `apiError`를 받아야 한다.
      */
      try {
        pushLokiLog("error", `BE 호출 실패: ${path}`, {
          status: response.status,
          code: apiError.code,
          traceId: apiError.traceId,
        });
      } catch {
        // 로그는 부가 기능이다 — 전송 실패가 본 요청의 실패 사유를 바꾸지 않는다.
      }
    }
    throw apiError;
  }

  /*
    ⚠️ **실패 봉투는 위에서 이미 갈렸다.** 여기 오는 건 성공뿐이라 `isEnveloped`는
       성공 응답 모양만 가른다 — 실패는 `isEnveloped`와 무관하게 늘 같은 모양이다
       (BE `GlobalExceptionHandler`가 전역으로 찍는다).
  */
  if (!isEnveloped) return raw as T;

  return (raw as ApiEnvelope<T> | null)?.data as T;
}

/** 실패 봉투에서 사람에게 보여 줄 문장과 분기용 코드를 꺼낸다. */
function toApiError(status: number, raw: unknown): ApiError {
  if (typeof raw !== "object" || raw === null) {
    return new ApiError(status, "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  const envelope = raw as {
    message?: unknown;
    errorCode?: unknown;
    traceId?: unknown;
    details?: unknown;
  };
  const message =
    typeof envelope.message === "string" && envelope.message.trim().length > 0
      ? envelope.message
      : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

  const code = typeof envelope.errorCode === "string" ? envelope.errorCode : undefined;
  const traceId = typeof envelope.traceId === "string" ? envelope.traceId : undefined;
  const details = toApiErrorDetails(envelope.details);

  return new ApiError(status, message, code, traceId, details);
}

/**
 * `details` 배열 정규화 — BE가 안 보내는 경우가 정상이라 없으면 `undefined`로 둔다(빈 배열
 * 아님). "필드 이름 자리"라도 검토 확정에서는 사유 코드가 들어와서, 값 검증은 필드명 규칙이
 * 아니라 **모양(문자열 두 개)**만 본다.
 */
function toApiErrorDetails(value: unknown): ApiErrorDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((entry): ApiErrorDetail[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { field, reason } = entry as { field?: unknown; reason?: unknown };
    if (typeof field !== "string" || typeof reason !== "string") return [];
    return [{ field, reason }];
  });
  return items.length > 0 ? items : undefined;
}

/**
 * 화면에 띄울 한 줄 — `ApiError`면 BE 문장을 그대로, 아니면 통신 실패로 본다.
 *
 * ⚠️ **기다리다 끊긴 것과 못 붙은 것을 가른다.** 둘 다 `ApiError`가 아니지만 사람이 할 일이
 *    다르다 — 못 붙었으면 다시 눌러 볼 만하고, 시간이 넘었으면 서버가 답을 안 하는 중이라
 *    잠시 뒤가 맞다(§정직성: 되는 척도 안 되는 척도 안 한다).
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const tag = toErrorTag(error);
    return tag ? `${error.message} (${tag})` : error.message;
  }
  if (isTimeout(error)) return "서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.";
  return "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/** `AbortSignal.timeout`이 끊은 것인가 — `DOMException("TimeoutError")`로 온다 */
function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/**
 * 원인을 찾을 때 쓰는 꼬리표 — `Z-003 · 8f21c0…`.
 *
 * ⚠️ **문구가 아니라 단서다.** 500처럼 "서버 내부 오류"만 오는 실패는 이것 없이는 BE 로그에서
 *    그 요청을 못 찾는다. Server Action은 브라우저 네트워크 탭에도 안 잡혀서 더욱 그렇다.
 * ⚠️ **5xx일 때만 붙인다**(2026-08-12). 4xx는 사람이 고칠 수 있는 실패라 문장이 이미 무엇을
 *    해야 하는지 말한다 — `이미 있는 부서 이름입니다`에 `AU-016`을 붙여 봐야 도움이 안 되고
 *    화면만 기술적으로 보인다. **나중에 걷어낼 것을 만들지 않으려고** 여기서 가른다.
 * ⚠️ 없으면 `null`을 준다 — 화면이 빈 괄호를 그리지 않게.
 */
export function toErrorTag(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status < 500) return null;

  /*
    ⚠️ **추적 번호는 앞 8자만 쓴다**(2026-08-12). BE가 주는 값은 UUID 36자라, 문장 뒤에 그대로
       붙이면 오류 한 줄이 두 줄로 넘어가 화면이 지저분해진다 — 정작 읽어야 할 문장이 뒤로 밀린다.
    ⚠️ 8자면 로그에서 찾기에 충분하다(git 짧은 해시와 같은 이유) — 한 회의 분량의 로그에서
       32비트가 겹칠 일은 없다.
    ⚠️ **소문자로 맞춘다.** 대문자 UUID를 주는 서버가 있고, 그러면 화면이 가를 때 못 알아본다.
  */
  const shortTrace = error.traceId?.toLowerCase().slice(0, 8);
  const tag = [error.code, shortTrace].filter(Boolean).join(" · ");

  /*
    ⚠️ **화면이 가를 수 있는 모양만 내보낸다**(적대적 리뷰 2026-08-12). 붙이는 규칙과 가르는
       규칙이 갈리면, 붙인 꼬리표가 빨간 문장 안에 그대로 박힌 채 아무도 눈치채지 못한다 —
       모양 판정은 `lib/error-tag.ts` 한 곳이고 여기는 그걸 따른다.
    ⚠️ 모양이 안 맞으면 **코드만이라도** 싣고, 그것도 아니면 아무것도 안 붙여 문장을 깨끗이 둔다.
  */
  if (isErrorTag(tag)) return tag;
  if (error.code && isErrorTag(error.code)) return error.code;
  return null;
}
