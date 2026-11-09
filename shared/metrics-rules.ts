/**
 * 면접과 운영용 지표예요. 사람을 알 수 없는 숫자만 날짜(한국 날짜)별로 모아요.
 * guestId, IP, 닉네임은 여기 들어오지 않아요. "다시 들어온 사람"은 directory의 guest_days(해시)로만 판단해요.
 */

/** 한 사람이 머문 시간은 이보다 길게 세지 않아요. 창을 켜 둔 채 잠든 분 때문에 평균이 튀지 않게요. */
export const MAX_STAY_MS = 12 * 60 * 60 * 1000;
/** 날짜별 지표를 이만큼 둬요. */
export const METRICS_KEEP_DAYS = 400;
export const DEFAULT_METRICS_DAYS = 30;
/** 인원 보고 한 번에 실을 수 있는 퇴장 수예요. 넘치면 남은 것은 다음 보고 때 보내요. */
export const MAX_DEPARTURES_PER_REPORT = 60;

/** 정말 나간 한 사람의 숫자예요. 누구인지는 없어요. */
export interface Departure {
  stayMs: number;
  blessings: number;
}

/** directory의 metrics_daily 한 줄이에요. */
export interface MetricsRow {
  day: string;
  entries: number;
  unique_guests: number;
  returning_guests: number;
  stay_ms: number;
  stays: number;
  blessings: number;
  visit_entries: number;
}

/** 운영자 API로 보여 주는 모양이에요. */
export interface MetricsView {
  day: string;
  /** 새로 들어온 횟수예요. 30초 안에 다시 이어진 것은 세지 않아요. */
  entries: number;
  /** 그날 들어온 서로 다른 사람 수예요(guestId 해시 기준). */
  uniqueGuests: number;
  /** 그날 온 사람 가운데 예전 날(최근 180일)에도 온 적 있는 사람의 비율이에요. 0~1이에요. */
  returningRate: number | null;
  /** 그날 나간 사람들의 평균 머문 시간(분)이에요. */
  avgStayMinutes: number | null;
  blessings: number;
  /** 문병 링크로 들어온 횟수예요. */
  visitEntries: number;
}

const wholeNumber = (value: unknown, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;

export function clampStay(ms: number): number {
  return wholeNumber(ms, MAX_STAY_MS);
}

/** 병실이 들고 있던 입장 시각과 평안 빌기 수로 퇴장 한 건을 만들어요. 입장 시각을 모르면 머문 시간은 세지 않아요. */
export function departureOf(record: { joinedAt?: number; blessings?: number }, nowMs: number): Departure | null {
  if (record.joinedAt === undefined) return null;
  return { stayMs: clampStay(nowMs - record.joinedAt), blessings: wholeNumber(record.blessings ?? 0, 10_000) };
}

/** 병실이 보낸 퇴장 목록을 믿을 수 있는 숫자로만 남겨요. */
export function cleanDepartures(list: unknown): Departure[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_DEPARTURES_PER_REPORT).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { stayMs, blessings } = item as Record<string, unknown>;
    return [{ stayMs: clampStay(stayMs as number), blessings: wholeNumber(blessings, 10_000) }];
  });
}

/** 퇴장 목록을 한 날짜의 더할 값으로 모아요. */
export function sumDepartures(list: readonly Departure[]): { stayMs: number; stays: number; blessings: number } {
  return list.reduce<{ stayMs: number; stays: number; blessings: number }>(
    (sum, item) => ({ stayMs: sum.stayMs + item.stayMs, stays: sum.stays + 1, blessings: sum.blessings + item.blessings }),
    { stayMs: 0, stays: 0, blessings: 0 },
  );
}

/** ?days= 값을 읽어요. 1~400만 받고, 아니면 30일이에요. */
export function readMetricsDays(raw: string | null): number {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return DEFAULT_METRICS_DAYS;
  const days = Number(raw);
  return days >= 1 && days <= METRICS_KEEP_DAYS ? days : DEFAULT_METRICS_DAYS;
}

export function toMetricsView(row: MetricsRow): MetricsView {
  return {
    day: row.day,
    entries: row.entries,
    uniqueGuests: row.unique_guests,
    returningRate: row.unique_guests > 0 ? Math.round((row.returning_guests / row.unique_guests) * 1000) / 1000 : null,
    avgStayMinutes: row.stays > 0 ? Math.round((row.stay_ms / row.stays / 60_000) * 10) / 10 : null,
    blessings: row.blessings,
    visitEntries: row.visit_entries,
  };
}
