/**
 * 하루의 흐름이에요. 한국 시간(UTC+9, 서머타임 없음)으로 소등과 밤을 나눠요.
 * 화면 루프에서 매번 불러도 가볍도록 Intl 없이 계산해요.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
/** 소등은 22시, 아침은 6시예요. */
export const LIGHTS_OUT_HOUR = 22;
export const MORNING_HOUR = 6;
const SLOT_HOURS = [6, 18, 22] as const;
/** 밤에 이만큼 머물면 그 밤을 함께한 밤으로 세요. */
export const NIGHT_STAY_MS = 60_000;
/** 이만큼 아무것도 누르지 않으면 연결을 잠시 닫아요. 수면 모드는 예외예요. */
export const IDLE_LIMIT_MS = 20 * 60_000;

function kstParts(nowMs: number): { dayStart: number; hour: number } {
  const kst = nowMs + KST_OFFSET_MS;
  const dayStart = Math.floor(kst / DAY_MS) * DAY_MS;
  return { dayStart, hour: Math.floor((kst - dayStart) / HOUR_MS) };
}

function dateKey(kstDayStart: number): string {
  return new Date(kstDayStart).toISOString().slice(0, 10);
}

/** 다음에 시간대가 바뀌는 순간이에요(6시, 18시, 22시). */
export function nextSlotChange(nowMs: number): number {
  const kst = nowMs + KST_OFFSET_MS;
  const { dayStart } = kstParts(nowMs);
  for (const hour of SLOT_HOURS) {
    const boundary = dayStart + hour * HOUR_MS;
    if (boundary > kst) return boundary - KST_OFFSET_MS;
  }
  return dayStart + DAY_MS + SLOT_HOURS[0] * HOUR_MS - KST_OFFSET_MS;
}

/** 다음 소등(22시)까지 남은 시간이에요. */
export function msUntilLightsOut(nowMs: number): number {
  const { dayStart } = kstParts(nowMs);
  const today = dayStart + LIGHTS_OUT_HOUR * HOUR_MS - KST_OFFSET_MS;
  return today > nowMs ? today - nowMs : today + DAY_MS - nowMs;
}

/**
 * 지금이 어느 밤인지예요. D일 22시부터 D+1일 6시까지는 "D일 밤"이에요. 낮이면 null이에요.
 */
export function nightKey(nowMs: number): string | null {
  const { dayStart, hour } = kstParts(nowMs);
  if (hour >= LIGHTS_OUT_HOUR) return dateKey(dayStart);
  if (hour < MORNING_HOUR) return dateKey(dayStart - DAY_MS);
  return null;
}

/** 함께한 밤이에요. 연속이 아니라 누적이라 줄지 않아요. */
export interface NightRecord {
  count: number;
  /** 마지막으로 센 밤이에요. 같은 밤은 다시 세지 않아요. */
  lastNight: string | null;
}

export const NO_NIGHTS: NightRecord = { count: 0, lastNight: null };

export function countNight(record: NightRecord, night: string): NightRecord {
  if (record.lastNight === night) return record;
  return { count: record.count + 1, lastNight: night };
}

/** 오늘 밤을 포함해 몇 번째 밤인지예요. 아직 세지 않았으면 하나를 더해요. */
export function nightOrdinal(record: NightRecord, night: string): number {
  return record.lastNight === night ? record.count : record.count + 1;
}

export function parseNightRecord(raw: string | null): NightRecord {
  if (!raw) return NO_NIGHTS;
  try {
    const value = JSON.parse(raw) as Partial<NightRecord>;
    const count = typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 0 ? value.count : 0;
    const lastNight = typeof value.lastNight === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.lastNight) ? value.lastNight : null;
    return { count, lastNight };
  } catch {
    return NO_NIGHTS;
  }
}

/** 오래 아무것도 누르지 않았는지예요. 수면 모드에서는 연결을 닫지 않아요. */
export function shouldPause(lastInputMs: number, nowMs: number, sleeping: boolean): boolean {
  return !sleeping && nowMs - lastInputMs >= IDLE_LIMIT_MS;
}

export function statsLine(visitors: number, blessings: number): string {
  return `오늘 다녀간 동물 ${visitors}마리 · 모인 평안 ${blessings}`;
}

export function lightsOutText(sleepers: number): string {
  return sleepers > 0 ? `소등 시간이에요. 오늘 밤 함께 잠드는 분 ${sleepers}명` : "소등 시간이에요. 편히 쉬시길";
}

export function nightsText(record: NightRecord, night: string | null): string | null {
  if (night) return `함께한 밤 ${nightOrdinal(record, night)}번째예요`;
  return record.count > 0 ? `지금까지 함께한 밤 ${record.count}번이에요` : null;
}
