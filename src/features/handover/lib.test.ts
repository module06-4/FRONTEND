import { HANDOVER_TYPE } from "@/constants/domain";

import {
  DEFAULT_HANDOVER_TYPE,
  HANDOVER_TYPE_TABS,
  handoverDateMin,
  isDueWithinRange,
  parseHandoverType,
  toHandoverCreateRequestBody,
} from "./lib";

/**
 * 신청 화면의 날짜 경계 규칙 회귀 방지 — 인접한 `team-handover/mapper.test.ts`와 짝을
 * 이룬다. 정책이 정정된 자리(§lib 주석)를 콕 집어 고정한다.
 * ⚠️ 여기서는 순수 함수만 다룬다 — 서버·매퍼 통합은 별도 스펙이 잡는다.
 */

describe("handoverDateMin — 휴직 시작·오프보딩 마지막 근무일 달력의 최소 선택값 (#637)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("오늘의 다음 날짜를 `YYYY-MM-DD`로 돌려준다", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-20T09:00:00"));

    expect(handoverDateMin()).toBe("2026-08-21");
  });

  it("월말은 다음 달 1일로 넘긴다 — 자리수 자릿수(`08` → `09`) 회귀", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-31T09:00:00"));

    expect(handoverDateMin()).toBe("2026-09-01");
  });

  it("연말은 다음 해 1월 1일로 넘긴다 — 연·월 동시 롤오버", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-12-31T09:00:00"));

    expect(handoverDateMin()).toBe("2027-01-01");
  });
});

describe("isDueWithinRange — 휴직 기간 안 마감 판정 (양끝 포함, 2026-08-08 확정)", () => {
  it("기간 안쪽 마감은 포함이다", () => {
    expect(isDueWithinRange("2026-08-15", "2026-08-10", "2026-08-20")).toBe(true);
  });

  /*
    ⚠️ **양끝 포함 규칙 회귀 방지** — "시작일부터"를 미포함으로 오해하면 시작일 당일 마감이
       인계 목록에서 조용히 빠져 사용자가 인계 대상을 놓친다(§정직성). 종료일도 같은 이유.
  */
  it("시작일과 같은 날 마감은 포함이다", () => {
    expect(isDueWithinRange("2026-08-10", "2026-08-10", "2026-08-20")).toBe(true);
  });

  it("종료일과 같은 날 마감은 포함이다", () => {
    expect(isDueWithinRange("2026-08-20", "2026-08-10", "2026-08-20")).toBe(true);
  });

  it("시작일 하루 전 마감은 미포함이다", () => {
    expect(isDueWithinRange("2026-08-09", "2026-08-10", "2026-08-20")).toBe(false);
  });

  it("종료일 하루 뒤 마감은 미포함이다", () => {
    expect(isDueWithinRange("2026-08-21", "2026-08-10", "2026-08-20")).toBe(false);
  });

  it("하루짜리 휴직(시작=종료)은 그 하루가 포함이다", () => {
    expect(isDueWithinRange("2026-08-10", "2026-08-10", "2026-08-10")).toBe(true);
  });

  /*
    ⚠️ 시작·종료 중 한 쪽이 아직 안 정해진 상태(폼 초기값)에서 호출되면 판정할 근거가 없다 —
       `true`를 돌려 배지가 뜨면 사용자에게 잘못된 안내가 된다. 함수는 명시적으로 `false`를 준다.
  */
  it("시작일이 비어 있으면 판정 불가로 `false`를 준다", () => {
    expect(isDueWithinRange("2026-08-15", "", "2026-08-20")).toBe(false);
  });

  it("종료일이 비어 있으면 판정 불가로 `false`를 준다", () => {
    expect(isDueWithinRange("2026-08-15", "2026-08-10", "")).toBe(false);
  });
});

describe("parseHandoverType — 외부 문자열을 신뢰 가능한 HandoverType으로 좁힌다", () => {
  it("유효한 `VACATION`은 그대로 통과한다", () => {
    expect(parseHandoverType(HANDOVER_TYPE.VACATION)).toBe(HANDOVER_TYPE.VACATION);
  });

  it("유효한 `OFFBOARDING`은 그대로 통과한다", () => {
    expect(parseHandoverType(HANDOVER_TYPE.OFFBOARDING)).toBe(HANDOVER_TYPE.OFFBOARDING);
  });

  /*
    ⚠️ **폴백 규칙 회귀 방지** — URL 쿼리·폼 초기값이 비어 있거나 알 수 없는 값일 때
       `undefined`가 그대로 새 나가면 탭 컴포넌트가 미선택 상태로 열려 사용자가 아무것도
       못 누른다. 화면상 원인이 안 보이는 사고라 함수 경계에서 반드시 좁힌다.
  */
  it("`undefined`는 `DEFAULT_HANDOVER_TYPE`(휴직)로 폴백한다", () => {
    expect(parseHandoverType(undefined)).toBe(DEFAULT_HANDOVER_TYPE);
    expect(DEFAULT_HANDOVER_TYPE).toBe(HANDOVER_TYPE.VACATION);
  });

  it("빈 문자열은 DEFAULT로 폴백한다", () => {
    expect(parseHandoverType("")).toBe(DEFAULT_HANDOVER_TYPE);
  });

  it("알 수 없는 값은 DEFAULT로 폴백한다 — 대소문자 · 오타 · 옛 값 전부 동일", () => {
    expect(parseHandoverType("vacation")).toBe(DEFAULT_HANDOVER_TYPE);
    expect(parseHandoverType("LEAVE")).toBe(DEFAULT_HANDOVER_TYPE);
    expect(parseHandoverType("RETIRE")).toBe(DEFAULT_HANDOVER_TYPE);
  });
});

describe("HANDOVER_TYPE_TABS — 탭 순서·라벨 계약", () => {
  /*
    ⚠️ 탭 순서는 사용자 학습에 남는 UI 규약이다 — 뒤집히면 자주 쓰는 [휴직] 탭이 두 번째로
       밀려 사용자가 매번 [오프보딩]에서 시작한다. 순서·라벨 둘 다 고정한다.
  */
  it("휴직이 먼저, 오프보딩이 뒤 — 두 탭만 있다", () => {
    expect(HANDOVER_TYPE_TABS).toEqual([
      { type: HANDOVER_TYPE.VACATION, label: "휴직" },
      { type: HANDOVER_TYPE.OFFBOARDING, label: "오프보딩" },
    ]);
  });
});

describe("toHandoverCreateRequestBody — FE payload → BE 생성 요청 바디", () => {
  /*
    ⚠️ **필드명 변환 회귀 방지 (BE 인수인계 문서 §2·§5)**. 이 경계가 어긋나면 서버가 400만
       튕겨서 사용자 화면엔 "입력값이 올바르지 않습니다"만 뜨고 실제 원인은 안 보인다 —
       유형별로 필드 목록·이름·자정 접미사를 하나하나 잡는다.
  */

  describe("VACATION(휴직)", () => {
    it("필드명을 BE 계약으로 바꾸고 시작·종료에 자정 `T00:00:00`을 붙인다", () => {
      const body = toHandoverCreateRequestBody({
        type: HANDOVER_TYPE.VACATION,
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        actionIds: [11, 22, 33],
        assignments: { 11: 100, 22: 200 },
      });

      expect(body).toEqual({
        handoverType: HANDOVER_TYPE.VACATION,
        leaveStartAt: "2026-09-01T00:00:00",
        leaveEndAt: "2026-09-05T00:00:00",
        selectedActionIds: [11, 22, 33],
      });
    });

    /*
      ⚠️ `assignments`(팀장 본인 휴직의 자가 재배정 맵)는 **생성 바디에 안 실린다** — 별도
         `PATCH .../items/{actionId}/reassign`으로 나간다(lib.ts L35-37). 여기에 새 나가면
         BE가 알 수 없는 필드를 받거나 매퍼 순서가 깨진다.
    */
    it("`assignments`는 생성 바디에 들어가지 않는다", () => {
      const body = toHandoverCreateRequestBody({
        type: HANDOVER_TYPE.VACATION,
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        actionIds: [],
        assignments: { 11: 100 },
      });

      expect(body).not.toHaveProperty("assignments");
    });

    it("오프보딩 전용 필드(`lastWorkingDay`·`note`)는 들어가지 않는다", () => {
      const body = toHandoverCreateRequestBody({
        type: HANDOVER_TYPE.VACATION,
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        actionIds: [1],
        assignments: {},
      });

      expect(body).not.toHaveProperty("lastWorkingDay");
      expect(body).not.toHaveProperty("note");
    });
  });

  describe("OFFBOARDING(오프보딩)", () => {
    it("`description → note` · `lastWorkingDay`는 그대로 · 필드명을 BE 계약으로 바꾼다", () => {
      const body = toHandoverCreateRequestBody({
        type: HANDOVER_TYPE.OFFBOARDING,
        description: "9월 10일부로 퇴사합니다.",
        lastWorkingDay: "2026-09-10",
        actionIds: [7, 8],
      });

      expect(body).toEqual({
        handoverType: HANDOVER_TYPE.OFFBOARDING,
        lastWorkingDay: "2026-09-10",
        note: "9월 10일부로 퇴사합니다.",
        selectedActionIds: [7, 8],
      });
    });

    it("휴직 전용 필드(`leaveStartAt`·`leaveEndAt`)는 들어가지 않는다", () => {
      const body = toHandoverCreateRequestBody({
        type: HANDOVER_TYPE.OFFBOARDING,
        description: "인수인계 완료",
        lastWorkingDay: "2026-09-10",
        actionIds: [],
      });

      expect(body).not.toHaveProperty("leaveStartAt");
      expect(body).not.toHaveProperty("leaveEndAt");
    });
  });

  it("두 유형 모두 `actionIds → selectedActionIds`로 이름이 바뀐다 — 공통 계약", () => {
    const vacation = toHandoverCreateRequestBody({
      type: HANDOVER_TYPE.VACATION,
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      actionIds: [1, 2],
      assignments: {},
    });
    const offboarding = toHandoverCreateRequestBody({
      type: HANDOVER_TYPE.OFFBOARDING,
      description: "인수인계",
      lastWorkingDay: "2026-09-10",
      actionIds: [1, 2],
    });

    expect(vacation).not.toHaveProperty("actionIds");
    expect(offboarding).not.toHaveProperty("actionIds");
    expect(vacation.selectedActionIds).toEqual([1, 2]);
    expect(offboarding.selectedActionIds).toEqual([1, 2]);
  });
});
