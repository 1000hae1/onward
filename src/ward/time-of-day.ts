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

/** 테스트용 ?time=day|evening|night 값을 읽어요. 그 밖의 값은 없는 것으로 봐요. */
export function parseTimeOverride(search: string): TimeSlot | null {
  const value = new URLSearchParams(search).get("time");
  return TIME_SLOTS.find((slot) => slot === value) ?? null;
}

/**
 * 지금 보여줄 시간대를 정해요.
 * 지금은 브라우저 시계를 쓰고, 서버 시간을 붙일 때는 now만 서버 값으로 넘기면 돼요.
 */
export function currentSlot(now: Date, search: string): TimeSlot {
  return parseTimeOverride(search) ?? slotForHour(kstHour(now));
}
