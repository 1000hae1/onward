export type TimeSlot = "day" | "evening" | "night";

const TIME_SLOTS: readonly TimeSlot[] = ["day", "evening", "night"];

const KST_HOUR_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  hour: "numeric",
  hourCycle: "h23",
});

/** 기기 시간대와 상관없이 한국 시각의 '시'를 돌려줘요. (0~23) */
export function kstHour(now: Date): number {
  const hour = KST_HOUR_FORMAT.formatToParts(now).find((part) => part.type === "hour");
  return Number(hour?.value);
}

/** 06~18시 낮, 18~22시 저녁, 그 밖에는 소등이에요. */
export function slotForHour(hour: number): TimeSlot {
  if (hour >= 6 && hour < 18) return "day";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

/** 테스트용으로 고를 수 있는 시간대예요. morning은 낮 조명에 아침 창문이 열린 모습이에요. */
export type TimeOverride = TimeSlot | "morning";
const TIME_OVERRIDES: readonly TimeOverride[] = ["morning", ...TIME_SLOTS];

/**
 * 테스트용 ?time=morning|day|evening|night 값을 읽어요. 그 밖의 값은 없는 것으로 봐요.
 * 화면 연출만 바꿔요. 서버가 판단하는 아침 한마디·선물 계절에는 영향을 주지 않아요.
 */
export function parseTimeOverride(search: string): TimeOverride | null {
  const value = new URLSearchParams(search).get("time");
  return TIME_OVERRIDES.find((slot) => slot === value) ?? null;
}

export type Season = "winter" | "spring" | "summer" | "autumn";
const SEASONS: readonly Season[] = ["winter", "spring", "summer", "autumn"];

/**
 * 테스트용 ?season=winter|spring|summer|autumn 값을 읽어요. 그 밖의 값은 없는 것으로 봐요.
 * 눈과 김 같은 화면 연출만 바꿔요. 겨울 선물은 언제나 서버의 한국 날짜로 정해요.
 */
export function parseSeasonOverride(search: string): Season | null {
  const value = new URLSearchParams(search).get("season");
  return SEASONS.find((season) => season === value) ?? null;
}

/** 지금 보여줄 시간대를 정해요. now는 서버 시계예요. ?time=morning은 낮 조명이에요. */
export function currentSlot(now: Date, search: string): TimeSlot {
  const override = parseTimeOverride(search);
  if (override === "morning") return "day";
  return override ?? slotForHour(kstHour(now));
}
