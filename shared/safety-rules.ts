/**
 * 안전장치의 판단이에요. 요청 제한, 신고, 보관 기간을 순수 함수로 두고
 * Durable Object는 결과대로 저장하고 보내기만 해요.
 */

import { autoNickname, checkNickname } from "./nickname.ts";

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/* ───────────── 요청 제한 ───────────── */

/** 연결 하나가 1초에 보낼 수 있는 메시지 수예요. 넘는 것은 읽지 않아요. */
export const MESSAGES_PER_SECOND = 10;
/** 넘친 초가 이만큼 이어지면 연결을 닫아요. */
export const OVER_SECONDS_TO_CLOSE = 3;

export interface RateState {
  /** 지금 세고 있는 1초 창이 시작된 시각이에요. */
  windowStart: number;
  count: number;
  /** 넘친 초가 몇 번 이어졌는지예요. */
  strikes: number;
  /** 이번 창에서 이미 넘쳤는지예요. 한 창에서는 한 번만 세요. */
  over: boolean;
}

export type RateVerdict = "ok" | "drop" | "close";

export function newRateState(): RateState {
  return { windowStart: -Infinity, count: 0, strikes: 0, over: false };
}

/** 메시지 하나가 왔어요. 받을지(ok), 버릴지(drop), 연결을 닫을지(close) 정해요. */
export function rateStep(state: RateState, nowMs: number): { state: RateState; verdict: RateVerdict } {
  let next = state;
  if (nowMs - state.windowStart >= SECOND_MS) {
    // 바로 앞 창에서 넘쳤을 때만 이어서 세요. 한 초라도 조용했으면 처음부터예요.
    const adjacent = nowMs - state.windowStart < 2 * SECOND_MS;
    next = { windowStart: nowMs, count: 0, strikes: state.over && adjacent ? state.strikes : 0, over: false };
  }
  const count = next.count + 1;
  if (count <= MESSAGES_PER_SECOND) return { state: { ...next, count }, verdict: "ok" };
  if (next.over) return { state: { ...next, count }, verdict: "drop" };
  const strikes = next.strikes + 1;
  const updated = { ...next, count, strikes, over: true };
  return { state: updated, verdict: strikes >= OVER_SECONDS_TO_CLOSE ? "close" : "drop" };
}

/** 같은 IP 해시에서 새 게스트를 만들 수 있는 수예요. 신고용 계정을 찍어 내지 못하게 해요. */
export const NEW_GUESTS_PER_HOUR = 20;
/** 운영자 키를 이만큼 틀리면 한 시간 동안 받지 않아요. */
export const ADMIN_FAILS_PER_HOUR = 10;
export const LIMIT_WINDOW_MS = HOUR_MS;

/** 지난 한 시간 동안 센 수가 한도 안이면 true예요. */
export function underHourlyLimit(times: readonly number[], nowMs: number, limit: number): boolean {
  return times.filter((at) => nowMs - at < LIMIT_WINDOW_MS).length < limit;
}

/* ───────────── 신고 ───────────── */

/** 신고 사유는 고르기만 해요. 번호로 주고받아요. */
export const REPORT_REASONS = ["nickname", "repeat", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_TEXT: readonly string[] = ["닉네임이 불편해요", "같은 행동을 반복해요", "기타"];
/** 한 사람이 하루(한국 날짜)에 할 수 있는 신고 수예요. */
export const REPORTS_PER_DAY = 5;
/** 서로 다른 사람이 이만큼 신고하면 닉네임을 가리고 운영자 확인을 기다려요. */
export const HIDE_AFTER_REPORTERS = 3;

export type ReportResult = "saved" | "limit" | "already" | "no-target";

export interface ReportFacts {
  reporter: string;
  target: string;
  /** 오늘 이 사람이 한 신고 수예요. */
  reporterToday: number;
  /** 아직 처리되지 않은 신고 가운데 이 대상을 신고한 사람들(해시)이에요. */
  openReporters: readonly string[];
  /** 이미 가려져 있는지예요. */
  alreadyHidden: boolean;
}

/** 신고를 받을지, 받으면 이제 닉네임을 가릴지 정해요. */
export function decideReport(facts: ReportFacts): { result: ReportResult; hide: boolean } {
  if (facts.reporter === facts.target) return { result: "no-target", hide: false };
  // 같은 사람이 같은 대상을 여러 번 신고해도 한 번으로 세요. 오늘 횟수도 쓰지 않아요.
  if (facts.openReporters.includes(facts.reporter)) return { result: "already", hide: false };
  if (facts.reporterToday >= REPORTS_PER_DAY) return { result: "limit", hide: false };
  const reporters = new Set([...facts.openReporters, facts.reporter]).size;
  return { result: "saved", hide: !facts.alreadyHidden && reporters >= HIDE_AFTER_REPORTERS };
}

const ANIMAL_LABELS: Record<string, string> = {
  rabbit: "토끼",
  bear: "곰",
  penguin: "펭귄",
  otter: "수달",
  deer: "사슴",
};

export function animalLabel(animal: string): string {
  return ANIMAL_LABELS[animal] ?? "동물";
}

/** 다른 사람 화면에 보일 닉네임이에요. 가려졌으면 '조용한 토끼'처럼 보여요. */
export function publicNickname(guest: { nickname: string; animal: string; hidden?: boolean }): string {
  return guest.hidden ? `조용한 ${animalLabel(guest.animal)}` : guest.nickname;
}

/**
 * 운영자가 되돌린 닉네임으로 다시 들어오거나 바꾸려 하면 자동 닉네임으로 바꿔요.
 * pick은 0 이상 1 미만의 수예요.
 */
export function enforceBannedNickname(
  nickname: string,
  banned: string | null | undefined,
  animal: string,
  pick: number,
): { nickname: string; reset: boolean } {
  if (!banned) return { nickname, reset: false };
  const checked = checkNickname(nickname);
  if (!checked.ok || checked.value !== banned) return { nickname, reset: false };
  return { nickname: autoNickname(animalLabel(animal), pick), reset: true };
}

/* ───────────── 보관 기간 ───────────── */

export const KEEP = {
  /** 남겨진 평안·선물, 평안 주소 */
  blessing: 7 * DAY_MS,
  /** 신고, 차단, 닉네임 가림·되돌림 */
  report: 30 * DAY_MS,
  /** 요청 제한에만 쓰는 IP 해시 기록이에요. 한 시간만 세지만 넉넉히 하루 둬요. */
  limit: DAY_MS,
  /** 운영자 작업 기록 */
  audit: 365 * DAY_MS,
  /** 방명록 링크로 들어온 시각이에요. 한 시간만 세요. */
  visitAttempt: HOUR_MS,
} as const;

/**
 * 보관 기간이 있는 표예요.
 * - at: column이 밀리초 시각이고, 그보다 keepMs가 지나면 지워요.
 * - day: column이 한국 날짜이고, 오늘이 아니면 지워요.
 * where가 있으면 그 줄만 따져요(예: 꺼진 방명록 링크).
 */
export type RetentionRule =
  | { table: string; kind: "at"; column: string; keepMs: number; where?: string }
  | { table: string; kind: "day"; column: string };

/** 지울 때가 된 데이터가 있을 때 맞출 alarm이에요. 하루에 한 번보다 자주 깨지 않아요. 지울 게 없으면 null이에요. */
export function nextRetentionAlarm(earliestExpiry: number | null, nowMs: number): number | null {
  if (earliestExpiry === null) return null;
  return Math.max(nowMs + DAY_MS, earliestExpiry);
}

/** 두 alarm 가운데 이른 것이에요. 둘 다 없으면 null이에요. */
export function earlierAlarm(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** SQLite 저장소에서 필요한 만큼만 적은 모양이에요. Durable Object의 sql과 테스트의 node:sqlite가 같이 맞춰요. */
export interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] };
}

/** 보관 기간이 지난 줄을 지워요. */
export function deleteExpired(sql: SqlLike, rules: readonly RetentionRule[], nowMs: number, today: string): void {
  for (const rule of rules) {
    if (rule.kind === "day") {
      sql.exec(`DELETE FROM ${rule.table} WHERE ${rule.column} != ?`, today);
    } else {
      const extra = rule.where ? ` AND (${rule.where})` : "";
      sql.exec(`DELETE FROM ${rule.table} WHERE ${rule.column} <= ?${extra}`, nowMs - rule.keepMs);
    }
  }
}

/** 남은 데이터 가운데 가장 먼저 지울 때가 되는 시각이에요. 남은 게 없으면 null이에요. */
export function earliestExpiry(sql: SqlLike, rules: readonly RetentionRule[], nowMs: number): number | null {
  let earliest: number | null = null;
  for (const rule of rules) {
    let expiry: number | null = null;
    if (rule.kind === "day") {
      // 날짜로 두는 표는 내일이면 지울 수 있어요.
      const row = sql.exec(`SELECT 1 AS one FROM ${rule.table} LIMIT 1`).toArray()[0];
      if (row) expiry = nowMs + DAY_MS;
    } else {
      const where = rule.where ? ` WHERE ${rule.where}` : "";
      const row = sql.exec(`SELECT MIN(${rule.column}) AS oldest FROM ${rule.table}${where}`).toArray()[0];
      const oldest = row?.oldest;
      if (typeof oldest === "number") expiry = oldest + rule.keepMs;
    }
    earliest = earlierAlarm(earliest, expiry);
  }
  return earliest;
}

/* ───────────── 운영자 작업을 병실에 알리기 ───────────── */

/** directory가 병실 서버에 바로 알리는 운영자 작업이에요. key는 guestId 해시, ip는 IP 해시예요. */
export type Moderation =
  | { kind: "block"; key?: string; ip?: string }
  | { kind: "reset"; key: string; banned: string }
  | { kind: "unhide"; key: string };
