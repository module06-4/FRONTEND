jest.mock("./actions", () => ({
  presignCaptureUploadAction: jest.fn(),
  completeCaptureUploadAction: jest.fn(),
}));

import { completeCaptureUploadAction, presignCaptureUploadAction } from "./actions";
import { createSliceUploader, describeUploadedParts } from "./upload";

/**
 * 오디오 조각 업로더 — presign 배치 소진·S3 키 파싱·연속 실패 알림만 확인한다.
 * ⚠️ 실제 S3 PUT은 `fetch`를 목으로 대체한다 — 네트워크 계층은 여기서 안 본다.
 */

const presignMock = presignCaptureUploadAction as unknown as jest.Mock;
const completeMock = completeCaptureUploadAction as unknown as jest.Mock;

function batch(segmentSeq: number, seqs: number[]) {
  return {
    ok: true,
    data: {
      segmentSeq,
      parts: seqs.map((seq) => ({
        seq,
        presignedUrl: `https://bucket.s3.amazonaws.com/companies/1/meetings/9/segments/${segmentSeq}/parts/${seq}.webm?X-Amz-Signature=abc`,
        expiresIn: 300,
      })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  completeMock.mockResolvedValue({ ok: true });
});

it("배치가 바닥나면 다음 배치를 받아 이어서 올린다", async () => {
  /*
    ⚠️ threshold(3)보다 작은 배치라 매번 pop할 때마다 배경 refill이 걸린다 — 정확히 몇 번
       불렸는지는 타이밍에 좌우되는 구현 세부라 안 세고, `mockResolvedValue`로 그 이후
       호출도 항상 답을 받게만 해 둔다.
  */
  presignMock.mockResolvedValueOnce(batch(0, [1, 2])).mockResolvedValue(batch(0, [3, 4, 5]));

  const uploader = createSliceUploader(9, { onFailure: jest.fn() });
  uploader.enqueue(new Blob(["a"]));
  uploader.enqueue(new Blob(["b"]));
  uploader.enqueue(new Blob(["c"]));
  await uploader.flush();

  expect(presignMock).toHaveBeenCalled();
  expect(completeMock).toHaveBeenCalledTimes(3);
  expect(completeMock).toHaveBeenNthCalledWith(1, 9, 1, {
    segmentSeq: 0,
    s3Key: "companies/1/meetings/9/segments/0/parts/1.webm",
    sizeBytes: expect.any(Number),
  });
  expect(completeMock).toHaveBeenNthCalledWith(2, 9, 2, {
    segmentSeq: 0,
    s3Key: "companies/1/meetings/9/segments/0/parts/2.webm",
    sizeBytes: expect.any(Number),
  });
});

it("presigned URL 경로에서 S3 키를 정확히 뽑아 complete에 실어 보낸다", async () => {
  presignMock.mockResolvedValue(batch(2, [1, 2, 3]));

  const uploader = createSliceUploader(9, { onFailure: jest.fn() });
  uploader.enqueue(new Blob(["a"]));
  await uploader.flush();

  expect(completeMock).toHaveBeenCalledWith(9, 1, {
    segmentSeq: 2,
    s3Key: "companies/1/meetings/9/segments/2/parts/1.webm",
    sizeBytes: expect.any(Number),
  });
});

/**
 * 재시도 사이 `sleep(RETRY_DELAY_MS = 500ms)`가 **실 `setTimeout`**이라, 병렬 jest 워커
 * CPU 경합이 걸리면 3초 안팎이면 끝날 일이 15초를 넘겨 타임아웃이 났다. 재시도 로직만
 *검증하는 아래 두 테스트는 **fake timers**로 시간을 앞으로 감아 실 대기 없이 돌린다 —
 * 로직은 그대로 두고 테스트만 실 시간 의존성을 뗀다. 아래 다른 테스트("순서대로 하나씩")는
 * fetch 목이 자체 `setTimeout(5)`으로 동시성을 재기 때문에 fake timers를 전역으로 걸면 안
 * 된다 — 그래서 두 테스트 안에서만 켜고 finally에서 원복한다.
 */
async function drainRetries(flushPromise: Promise<void>): Promise<void> {
  // 각 조각당 최대 (MAX_UPLOAD_ATTEMPTS - 1)회 = 2회 sleep, 최대 4조각을 넉넉히 덮는다.
  for (let i = 0; i < 12; i += 1) {
    await jest.advanceTimersByTimeAsync(500);
  }
  await flushPromise;
}

it("PUT이 실패해도 같은 조각을 재시도해서 결국 올린다", async () => {
  jest.useFakeTimers();
  try {
    presignMock.mockResolvedValue(batch(0, [1]));
    const onFailure = jest.fn();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });

    const uploader = createSliceUploader(9, { onFailure });
    uploader.enqueue(new Blob(["a"]));
    await drainRetries(uploader.flush());

    expect(global.fetch).toHaveBeenCalledTimes(3); // 같은 presignedUrl로 세 번째 만에 성공
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it("재시도까지 다 실패한 조각이 연속 3개면 알리고, 그다음 성공하면 실패 횟수가 되돌아간다", async () => {
  jest.useFakeTimers();
  try {
    presignMock.mockResolvedValue(batch(0, [1, 2, 3, 4]));
    const onFailure = jest.fn();
    /*
      조각 1·2·3은 매 시도 실패(각 3번씩 재시도 후 포기 = 9번), 조각 4는 그 뒤 첫 시도부터
      성공한다(10번째 호출) — 호출 순번으로 세는 게 개별 mockResolvedValueOnce를 9개
      늘어놓는 것보다 개수를 세기 쉽다.
    */
    let callCount = 0;
    (global.fetch as jest.Mock).mockImplementation(async () => {
      callCount += 1;
      return { ok: callCount > 9, status: 500 };
    });

    const uploader = createSliceUploader(9, { onFailure });
    uploader.enqueue(new Blob(["a"]));
    uploader.enqueue(new Blob(["b"]));
    uploader.enqueue(new Blob(["c"]));
    uploader.enqueue(new Blob(["d"]));
    await drainRetries(uploader.flush());

    expect(global.fetch).toHaveBeenCalledTimes(10); // (3+3+3)번 재시도 + 마지막 1번
    expect(onFailure).toHaveBeenCalledTimes(1); // 조각 3개 연속 포기한 시점에 딱 한 번
    expect(completeMock).toHaveBeenCalledTimes(1); // 조각 4만 성공해 complete까지 감
  } finally {
    jest.useRealTimers();
  }
});

it("순서대로, 하나씩 올린다 — 동시에 여러 조각을 PUT하지 않는다", async () => {
  presignMock.mockResolvedValue(batch(0, [1, 2, 3]));
  let inFlight = 0;
  let maxInFlight = 0;
  (global.fetch as jest.Mock).mockImplementation(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return { ok: true };
  });

  const uploader = createSliceUploader(9, { onFailure: jest.fn() });
  uploader.enqueue(new Blob(["a"]));
  uploader.enqueue(new Blob(["b"]));
  await uploader.flush();

  expect(maxInFlight).toBe(1);
});

describe("describeUploadedParts — CAP-08 복구 안내 문장", () => {
  it("올라간 것이 없으면 0개(약 00:00)가 아니라 '없다'고 말한다", () => {
    expect(describeUploadedParts({ lastSeq: 0, missingCount: 0 })).toBe(
      "아직 서버에 올라간 녹음 조각은 없습니다.",
    );
  });

  it("조각 수 × 15초를 근사 분량으로 병기한다 — 4개면 약 1분", () => {
    expect(describeUploadedParts({ lastSeq: 4, missingCount: 0 })).toBe(
      "지금까지 녹음 조각 4개(약 1분)가 서버에 올라가 있습니다.",
    );
  });

  it("1분 미만은 초로, 분·초가 섞이면 둘 다 적는다", () => {
    expect(describeUploadedParts({ lastSeq: 2, missingCount: 0 })).toContain("약 30초");
    expect(describeUploadedParts({ lastSeq: 5, missingCount: 0 })).toContain("약 1분 15초");
  });

  it("유실 구간은 숨기지 않는다 — 복구되지 않는다는 사실까지 말한다(§정직성)", () => {
    expect(describeUploadedParts({ lastSeq: 8, missingCount: 2 })).toBe(
      "지금까지 녹음 조각 8개(약 2분)가 서버에 올라가 있습니다. 이 중 2개 구간은 전송되지 못해 복구되지 않습니다.",
    );
  });
});
