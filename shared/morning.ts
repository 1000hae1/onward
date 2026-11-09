/**
 * 아침 창문이에요. 한국 시간(UTC+9, 서머타임 없음) 06:30부터 09:00 전까지예요.
 * 화면과 서버가 함께 쓰고, 한마디 5번을 받을지는 서버가 이 함수로 정해요.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
export const MORNING_START_MINUTE = 6 * 60 + 30;
export const MORNING_END_MINUTE = 9 * 60;
/** "좋은 아침이에요"의 번호예요. */
export const MORNING_PHRASE = 5;

function kstMinute(nowMs: number): number {
  const kst = nowMs + KST_OFFSET_MS;
  const inDay = ((kst % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.floor(inDay / MINUTE_MS);
}

/** 지금이 아침 창문 시간인지예요. */
export function isMorningWindow(nowMs: number): boolean {
  const minute = kstMinute(nowMs);
  return minute >= MORNING_START_MINUTE && minute < MORNING_END_MINUTE;
}

/** 아침이면 끝나는 시각(09:00)이에요. 아침이 아니면 null이에요. */
export function morningEndsAt(nowMs: number): number | null {
  if (!isMorningWindow(nowMs)) return null;
  const kst = nowMs + KST_OFFSET_MS;
  const dayStart = Math.floor(kst / DAY_MS) * DAY_MS;
  return dayStart + MORNING_END_MINUTE * MINUTE_MS - KST_OFFSET_MS;
}

/** 이 한마디를 지금 보낼 수 있는지예요. 5번은 아침에만이에요. */
export function phraseAllowed(phrase: number, nowMs: number): boolean {
  return phrase !== MORNING_PHRASE || isMorningWindow(nowMs);
}

/** 병실에 누가 들어왔을 때 창문을 열지예요. 아침이고 오늘 아직 열지 않았을 때만이에요. */
export function shouldOpenWindow(nowMs: number, openedToday: boolean): boolean {
  return isMorningWindow(nowMs) && !openedToday;
}
