import { DurableObject } from "cloudflare:workers";
import {
  addLatest,
  dailyKey,
  encodeAddress,
  fiveLeafAllowed,
  INBOX_PER_GUEST,
  KEEP_MS,
  toCard,
} from "../shared/left-blessings.ts";
import type { BlessingCard, StoredBlessing } from "../shared/left-blessings.ts";
import {
  checkVisit,
  findLink,
  HOUR_MS,
  replaceLink,
  turnOffLink,
  VISIT_SESSION_MS,
} from "../shared/visit-rules.ts";
import type { VisitLinkRow } from "../shared/visit-rules.ts";
import { APPLE_KEEP_MS, checkApple, checkApplePost, HOUR_MS as APPLE_HOUR_MS, ownerTree, slotFor, visitorTree } from "../shared/guestbook-rules.ts";
import type { AppleCard, AppleDraft, AppleProblem, StoredApple } from "../shared/guestbook-rules.ts";
import {
  ADMIN_FAILS_PER_HOUR,
  decideReport,
  deleteExpired,
  earliestExpiry,
  KEEP,
  NEW_GUESTS_PER_HOUR,
  nextRetentionAlarm,
  REPORT_REASONS,
  underHourlyLimit,
} from "../shared/safety-rules.ts";
import type { Moderation, ReportResult, RetentionRule } from "../shared/safety-rules.ts";
import { koreanDay } from "../shared/ward-rules.ts";
import { countVisitDay, VISIT_DAYS_KEEP_MS } from "../shared/return-rules.ts";
import { presenceChange, statsTimestamp, tally } from "../shared/presence-rules.ts";
import type { Headcount } from "../shared/presence-rules.ts";
import { cleanDepartures, METRICS_KEEP_DAYS, sumDepartures, toMetricsView } from "../shared/metrics-rules.ts";
import type { MetricsRow, MetricsView } from "../shared/metrics-rules.ts";

/** 날짜별 지표에 더할 수 있는 칸이에요. 표 이름과 열 이름을 SQL에 넣으므로 이 목록 밖의 값은 받지 않아요. */
type MetricColumn = "entries" | "unique_guests" | "returning_guests" | "stay_ms" | "stays" | "blessings" | "visit_entries";

/** 병실 서버가 신고를 넘길 때 담는 것이에요. 해시와 공개 번호만 있어요. */
export interface ReportInput {
  room: string;
  reason: number;
  reporterId: string;
  reporterHash: string;
  targetId: string;
  targetHash: string;
  targetIp: string | null;
  targetNickname: string;
  targetAnimal: string;
}

/** 들어오려는 사람에 대해 directory가 아는 것이에요. */
export interface GuestStanding {
  blocked: boolean;
  hidden: boolean;
  bannedNickname: string | null;
}

export interface ReportRow {
  id: number;
  at: number;
  room: string;
  reason: string;
  nickname: string;
  reporterId: string;
  reporterHash: string;
  targetId: string;
  targetHash: string;
  targetIp: string | null;
  handled: boolean;
  targetHidden: boolean;
}

export type AdminResult = { ok: true; affected: number } | { ok: false; error: "unknown_guest" };

const ROOM_PATTERN = /^ward-\d{1,2}-\d{1,2}$/;

/** directory에서 보관 기간이 있는 표예요. alarm이 이 목록대로 지워요. */
const RETENTION: readonly RetentionRule[] = [
  { table: "address_book", kind: "at", column: "created", keepMs: KEEP_MS },
  { table: "inbox", kind: "at", column: "at", keepMs: KEEP_MS },
  { table: "inbox_daily", kind: "day", column: "day" },
  { table: "gift_daily", kind: "day", column: "day" },
  { table: "visit_attempt", kind: "at", column: "at", keepMs: KEEP.visitAttempt },
  { table: "visit_session", kind: "at", column: "started", keepMs: VISIT_SESSION_MS },
  // 꺼진 방명록 링크는 만든 지 7일이 지나면 지워요. 켜진 링크는 주인이 끌 때까지 둬요.
  { table: "guestbook_link", kind: "at", column: "created", keepMs: KEEP_MS, where: "off = 1" },
  // 사과는 1년 동안 둬요. 주인이 숨긴 사과는 그 자리에서 바로 지워요.
  { table: "apple", kind: "at", column: "at", keepMs: APPLE_KEEP_MS },
  { table: "apple_seq", kind: "at", column: "at", keepMs: APPLE_KEEP_MS },
  { table: "report", kind: "at", column: "at", keepMs: KEEP.report },
  { table: "hidden_guest", kind: "at", column: "at", keepMs: KEEP.report },
  { table: "nickname_reset", kind: "at", column: "at", keepMs: KEEP.report },
  { table: "block", kind: "at", column: "at", keepMs: KEEP.report },
  { table: "guest_issue", kind: "at", column: "at", keepMs: KEEP.limit },
  { table: "admin_fail", kind: "at", column: "at", keepMs: KEEP.limit },
  { table: "audit_log", kind: "at", column: "at", keepMs: KEEP.audit },
  // 다녀간 날 수와 퇴원 표시는 마지막으로 다녀간 뒤 180일이 지나면 지워요.
  { table: "guest_days", kind: "at", column: "last_at", keepMs: VISIT_DAYS_KEEP_MS },
  // 날짜별 숫자 지표예요. 400일이 지나면 지워요.
  { table: "metrics_daily", kind: "at", column: "created", keepMs: METRICS_KEEP_DAYS * 24 * 60 * 60 * 1000 },
  { table: "discharged", kind: "at", column: "at", keepMs: VISIT_DAYS_KEEP_MS },
];

export type LeaveResult = "saved" | "unknown" | "once-a-day";

/** 병실 서버가 알려 주는 주인의 위치예요. */
export interface OwnerPlace {
  ward: number;
  instance: number;
  bed: number | null;
}

export interface OwnerProfile {
  nickname: string;
  animal: string;
  address: string;
}

/** 주인이 보는 내 방명록이에요. */
export interface GuestbookStatus {
  active: boolean;
  count: number;
  apples: AppleCard[];
}

/** 링크로 온 사람이 보는 방명록이에요. 사과는 개수와 자기가 단 것만이에요. */
export type GuestbookViewResult =
  | { open: true; ownerNickname: string; ownerAnimal: string; ward: number; instance: number; count: number; mine: AppleCard[] }
  | { open: false };

export type AddAppleResult =
  | { result: "saved"; apple: AppleCard; count: number }
  | { result: "closed" }
  | { result: "limit" }
  | ({ result: "invalid" } & AppleProblem);

interface AppleSqlRow {
  id: number;
  owner: string;
  name: string;
  phrase: number;
  note: string | null;
  at: number;
  link_hash: string;
  writer_hash: string;
  slot: number;
  [key: string]: SqlStorageValue;
}

export type VisitResolution =
  | { kind: "ok"; owner: string; ownerNickname: string; bed: number; session: string }
  | { kind: "closed" | "busy" | "self" };

interface LinkSqlRow {
  token_hash: string;
  owner: string;
  address_hash: string;
  nickname: string;
  animal: string;
  created: number;
  off: number;
  visits: number;
  ward: number;
  instance: number;
  bed: number;
  [key: string]: SqlStorageValue;
}

/**
 * 병동 전체가 함께 쓰는 Durable Object예요. 이름은 directory 하나뿐이에요.
 * 표는 기능별로 나눠 두어서, 방명록 링크와 사과 표가 다른 표와 섞이지 않아요.
 *
 * 받는 것은 모두 해시예요. guestId와 평안 주소 원문은 저장하지 않아요.
 * 주기적으로 도는 일은 없어요. 오래된 기록은 요청이 올 때 함께 정리하고,
 * 보관 기간이 지난 것은 지울 데이터가 있을 때만 맞추는 alarm이 지워요(하루에 많아야 한 번).
 */
export class Directory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // 평안 주소의 해시와 주인(guestId 해시)이에요. 입장할 때마다 새 주소를 하나씩 만들어요.
    sql.exec(`CREATE TABLE IF NOT EXISTS address_book (
      address_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL)`);
    // 자리에 없는 사람에게 남긴 평안이에요. 받는 사람마다 최근 10개, 7일까지예요.
    sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, nickname TEXT NOT NULL,
      animal TEXT NOT NULL, kind TEXT NOT NULL, item INTEGER, at INTEGER NOT NULL, sender TEXT NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS inbox_owner ON inbox (owner)");
    // 같은 사람에게 하루 한 번만 남기려고 오늘 남긴 짝을 적어 둬요.
    sql.exec(`CREATE TABLE IF NOT EXISTS inbox_daily (key TEXT PRIMARY KEY, day TEXT NOT NULL)`);
    // 하루 한 번만 놓을 수 있는 선물이에요. 지금은 오잎클로버예요.
    sql.exec(`CREATE TABLE IF NOT EXISTS gift_daily (
      guest TEXT NOT NULL, item INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (guest, item))`);
    // 예전 /visit 문병 링크 표예요. 방명록 링크로 바뀌어서 지워요. 예전 링크는 모두 열리지 않아요.
    sql.exec("DROP TABLE IF EXISTS visit_link");
    // 방명록 링크예요. 토큰 원본은 두지 않고 해시만 둬요. 한 사람당 하나라 owner가 겹치지 않아요.
    // 이 링크를 받은 사람만 사과를 달고 [병실에 문병 가기]로 들어올 수 있어요.
    sql.exec(`CREATE TABLE IF NOT EXISTS guestbook_link (
      token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, address_hash TEXT NOT NULL,
      nickname TEXT NOT NULL, animal TEXT NOT NULL, created INTEGER NOT NULL,
      off INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0,
      ward INTEGER NOT NULL, instance INTEGER NOT NULL, bed INTEGER NOT NULL)`);
    // 사과(방명록 글)예요. 주인만 내용을 봐요. 사람은 해시로만 적어요(주인 guestId 해시, 링크 토큰 해시, 단 브라우저 열쇠 해시).
    sql.exec(`CREATE TABLE IF NOT EXISTS apple (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, name TEXT NOT NULL, phrase INTEGER NOT NULL,
      note TEXT, at INTEGER NOT NULL, link_hash TEXT NOT NULL, writer_hash TEXT NOT NULL, slot INTEGER NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS apple_owner ON apple (owner)");
    sql.exec("CREATE INDEX IF NOT EXISTS apple_link ON apple (link_hash, at)");
    // 주인마다 다음 사과가 열릴 순번이에요. 자리 번호(순번 % 40)를 정해요.
    sql.exec(`CREATE TABLE IF NOT EXISTS apple_seq (owner TEXT PRIMARY KEY, next INTEGER NOT NULL, at INTEGER NOT NULL)`);
    // 링크마다 들어온 시각이에요. 1시간에 30번을 세려고 두고, 1시간이 지나면 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS visit_attempt (owner TEXT NOT NULL, at INTEGER NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS visit_attempt_owner ON visit_attempt (owner)");
    // 지금 들어와 있는 문병객이에요. 링크마다 3명까지예요. 병실 서버가 나갈 때 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS visit_session (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, started INTEGER NOT NULL)`);
    // 신고예요. 사람은 공개 번호와 guestId 해시로만 적어요. 30일이 지나면 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS report (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, day TEXT NOT NULL, room TEXT NOT NULL,
      reason TEXT NOT NULL, nickname TEXT NOT NULL, animal TEXT NOT NULL,
      reporter_id TEXT NOT NULL, reporter_hash TEXT NOT NULL,
      target_id TEXT NOT NULL, target_hash TEXT NOT NULL, target_ip TEXT,
      handled INTEGER NOT NULL DEFAULT 0)`);
    sql.exec("CREATE INDEX IF NOT EXISTS report_target ON report (target_hash)");
    sql.exec("CREATE INDEX IF NOT EXISTS report_reporter ON report (reporter_hash, day)");
    // 서로 다른 세 사람이 신고해서 닉네임을 가린 사람이에요. 운영자가 처리하면 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS hidden_guest (guest_hash TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
    // 운영자가 되돌린 닉네임이에요. 같은 닉네임으로 다시 들어오면 자동 닉네임으로 바꿔요.
    sql.exec(`CREATE TABLE IF NOT EXISTS nickname_reset (
      guest_hash TEXT PRIMARY KEY, nickname TEXT NOT NULL, at INTEGER NOT NULL)`);
    // 입장 차단이에요. kind는 guest(guestId 해시)나 ip(IP 해시)예요.
    sql.exec(`CREATE TABLE IF NOT EXISTS block (
      kind TEXT NOT NULL, value TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, value))`);
    // 요청 제한용이에요. IP 해시마다 새 게스트를 만든 시각과 운영자 키를 틀린 시각이에요.
    sql.exec(`CREATE TABLE IF NOT EXISTS guest_issue (ip_hash TEXT NOT NULL, at INTEGER NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS guest_issue_ip ON guest_issue (ip_hash)");
    sql.exec(`CREATE TABLE IF NOT EXISTS admin_fail (ip_hash TEXT NOT NULL, at INTEGER NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS admin_fail_ip ON admin_fail (ip_hash)");
    // 운영자 작업 기록이에요. 넣기만 하고 고치거나 지우는 API는 없어요. 1년이 지나면 alarm이 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL,
      target TEXT NOT NULL, reason TEXT NOT NULL)`);
    // 다녀간 날 수예요(한국 날짜, 같은 날은 한 번). 본인에게도 숫자로는 보내지 않아요.
    sql.exec(`CREATE TABLE IF NOT EXISTS guest_days (
      guest_hash TEXT PRIMARY KEY, days INTEGER NOT NULL, last_day TEXT NOT NULL, last_at INTEGER NOT NULL)`);
    // 퇴원한 사람이에요. 다시 들어오면 "다시 들러 주셨네요"로 맞고 지워요. 다른 판단에는 쓰지 않아요.
    sql.exec(`CREATE TABLE IF NOT EXISTS discharged (guest_hash TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
    // 병실마다 지금 있는 사람 수예요. 숫자와 병실 이름만 둬요. 아무도 없으면 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS room_presence (
      room TEXT PRIMARY KEY, patients INTEGER NOT NULL, visitors INTEGER NOT NULL, at INTEGER NOT NULL)`);
    // 날짜(한국)별 숫자 지표예요. 사람을 가리키는 값은 하나도 없어요.
    sql.exec(`CREATE TABLE IF NOT EXISTS metrics_daily (
      day TEXT PRIMARY KEY, created INTEGER NOT NULL,
      entries INTEGER NOT NULL DEFAULT 0, unique_guests INTEGER NOT NULL DEFAULT 0,
      returning_guests INTEGER NOT NULL DEFAULT 0, stay_ms INTEGER NOT NULL DEFAULT 0,
      stays INTEGER NOT NULL DEFAULT 0, blessings INTEGER NOT NULL DEFAULT 0,
      visit_entries INTEGER NOT NULL DEFAULT 0)`);
  }

  /* ───────────── 날짜별 지표 ───────────── */

  /** 오늘(한국 날짜) 지표에 더해요. */
  private bump(nowMs: number, add: Partial<Record<MetricColumn, number>>): void {
    const entries = Object.entries(add).filter(([, value]) => typeof value === "number" && value > 0) as [MetricColumn, number][];
    if (entries.length === 0) return;
    const sql = this.ctx.storage.sql;
    const day = koreanDay(new Date(nowMs));
    sql.exec("INSERT OR IGNORE INTO metrics_daily (day, created) VALUES (?, ?)", day, nowMs);
    const set = entries.map(([column]) => `${column} = ${column} + ?`).join(", ");
    sql.exec(`UPDATE metrics_daily SET ${set} WHERE day = ?`, ...entries.map(([, value]) => value), day);
  }

  /** 운영자 API로 보는 최근 날짜별 지표예요. 최근 날짜가 먼저예요. */
  async metrics(days: number): Promise<MetricsView[]> {
    return this.ctx.storage.sql
      .exec<{ [K in keyof MetricsRow]: MetricsRow[K] }>(
        `SELECT day, entries, unique_guests, returning_guests, stay_ms, stays, blessings, visit_entries
         FROM metrics_daily ORDER BY day DESC LIMIT ?`,
        days,
      )
      .toArray()
      .map(toMetricsView);
  }

  /* ───────────── 접속자 수 ───────────── */

  /** 병실이 들고 날 때 지금 인원을 알려 줘요. 차이값이 아니라 현재값이라 덮어써요. */
  async reportPresence(room: string, count: Headcount, nowMs: number, departures: unknown = []): Promise<void> {
    // 정말 나간 사람들의 머문 시간과 평안 빌기 수예요. 인원 보고에 실려 와서 요청이 늘지 않아요.
    const left = sumDepartures(cleanDepartures(departures));
    this.bump(nowMs, { stay_ms: left.stayMs, stays: left.stays, blessings: left.blessings });
    if (left.stays > 0) await this.keepTidy();
    const change = presenceChange(room, count, nowMs);
    const sql = this.ctx.storage.sql;
    if (change.kind === "delete") sql.exec("DELETE FROM room_presence WHERE room = ?", change.room);
    if (change.kind === "upsert") {
      sql.exec(
        "INSERT OR REPLACE INTO room_presence (room, patients, visitors, at) VALUES (?, ?, ?, ?)",
        change.row.room,
        change.row.patients,
        change.row.visitors,
        change.row.at,
      );
    }
  }

  /** 공개 접속자 수예요. 숫자만 돌려줘요. 오래 소식이 없는 병실은 여기서 지워요. */
  async presenceStats(nowMs: number): Promise<{ online: number; wards: number; updatedAt: string }> {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ room: string; patients: number; visitors: number; at: number }>("SELECT room, patients, visitors, at FROM room_presence").toArray();
    const result = tally(rows, nowMs);
    for (const room of result.stale) sql.exec("DELETE FROM room_presence WHERE room = ?", room);
    return { online: result.online, wards: result.wards, updatedAt: statsTimestamp(nowMs) };
  }

  /* ───────────── 보관 기간 ───────────── */

  /** 보관 기간이 지난 데이터를 지워요. 남은 데이터가 있을 때만 다음 alarm을 맞춰요. */
  async alarm(): Promise<void> {
    const now = Date.now();
    deleteExpired(this.ctx.storage.sql, RETENTION, now, koreanDay(new Date(now)));
    const next = nextRetentionAlarm(earliestExpiry(this.ctx.storage.sql, RETENTION, now), now);
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /** 무언가 저장한 뒤 불러요. 맞춰 둔 alarm이 없을 때만 새로 맞춰요. */
  private async keepTidy(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    const now = Date.now();
    const next = nextRetentionAlarm(earliestExpiry(this.ctx.storage.sql, RETENTION, now), now);
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /* ───────────── 입장과 요청 제한 ───────────── */

  /** 들어오려는 사람이 막혔는지, 닉네임이 가려졌는지, 되돌린 닉네임이 있는지예요. */
  async standing(guestHash: string, ipHash: string | null): Promise<GuestStanding> {
    const sql = this.ctx.storage.sql;
    const blocked =
      sql.exec("SELECT 1 FROM block WHERE kind = 'guest' AND value = ?", guestHash).toArray().length > 0 ||
      (ipHash !== null && sql.exec("SELECT 1 FROM block WHERE kind = 'ip' AND value = ?", ipHash).toArray().length > 0);
    const hidden = sql.exec("SELECT 1 FROM hidden_guest WHERE guest_hash = ?", guestHash).toArray().length > 0;
    const reset = sql
      .exec<{ nickname: string }>("SELECT nickname FROM nickname_reset WHERE guest_hash = ?", guestHash)
      .toArray()[0];
    return { blocked, hidden, bannedNickname: reset?.nickname ?? null };
  }

  /** 이 IP 해시에서 새 게스트를 만들어도 되는지 보고, 되면 센 뒤 true예요. */
  async allowNewGuest(ipHash: string, nowMs: number): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    if (sql.exec("SELECT 1 FROM block WHERE kind = 'ip' AND value = ?", ipHash).toArray().length > 0) return false;
    const times = sql
      .exec<{ at: number }>("SELECT at FROM guest_issue WHERE ip_hash = ? AND at > ?", ipHash, nowMs - KEEP.limit)
      .toArray()
      .map((row) => row.at);
    if (!underHourlyLimit(times, nowMs, NEW_GUESTS_PER_HOUR)) return false;
    sql.exec("INSERT INTO guest_issue (ip_hash, at) VALUES (?, ?)", ipHash, nowMs);
    await this.keepTidy();
    return true;
  }

  /** 운영자 키를 너무 많이 틀린 IP 해시인지예요. */
  async adminLocked(ipHash: string, nowMs: number): Promise<boolean> {
    const times = this.ctx.storage.sql
      .exec<{ at: number }>("SELECT at FROM admin_fail WHERE ip_hash = ? AND at > ?", ipHash, nowMs - KEEP.limit)
      .toArray()
      .map((row) => row.at);
    return !underHourlyLimit(times, nowMs, ADMIN_FAILS_PER_HOUR);
  }

  async adminFailed(ipHash: string, nowMs: number): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO admin_fail (ip_hash, at) VALUES (?, ?)", ipHash, nowMs);
    await this.keepTidy();
  }

  /* ───────────── 신고 ───────────── */

  /** 신고를 받아요. 서로 다른 세 사람이 신고하면 hide가 true이고, 병실 서버가 닉네임을 가려요. */
  async report(input: ReportInput, nowMs: number): Promise<{ result: ReportResult; hide: boolean }> {
    const sql = this.ctx.storage.sql;
    const day = koreanDay(new Date(nowMs));
    const reason = REPORT_REASONS[input.reason];
    if (!reason || !ROOM_PATTERN.test(input.room)) return { result: "no-target", hide: false };
    const reporterToday = sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM report WHERE reporter_hash = ? AND day = ?", input.reporterHash, day)
      .one().n;
    const openReporters = sql
      .exec<{ reporter_hash: string }>(
        "SELECT DISTINCT reporter_hash FROM report WHERE target_hash = ? AND handled = 0",
        input.targetHash,
      )
      .toArray()
      .map((row) => row.reporter_hash);
    const alreadyHidden = sql.exec("SELECT 1 FROM hidden_guest WHERE guest_hash = ?", input.targetHash).toArray().length > 0;
    const decision = decideReport({
      reporter: input.reporterHash,
      target: input.targetHash,
      reporterToday,
      openReporters,
      alreadyHidden,
    });
    if (decision.result !== "saved") return decision;
    sql.exec(
      `INSERT INTO report (at, day, room, reason, nickname, animal, reporter_id, reporter_hash, target_id, target_hash, target_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nowMs,
      day,
      input.room,
      reason,
      input.targetNickname,
      input.targetAnimal,
      input.reporterId,
      input.reporterHash,
      input.targetId,
      input.targetHash,
      input.targetIp,
    );
    if (decision.hide) {
      sql.exec("INSERT OR IGNORE INTO hidden_guest (guest_hash, at) VALUES (?, ?)", input.targetHash, nowMs);
    }
    await this.keepTidy();
    return { result: alreadyHidden ? "saved" : decision.result, hide: alreadyHidden || decision.hide };
  }

  /* ───────────── 운영자 ───────────── */

  async listReports(limit: number): Promise<ReportRow[]> {
    return this.ctx.storage.sql
      .exec<{
        id: number;
        at: number;
        room: string;
        reason: string;
        nickname: string;
        reporter_id: string;
        reporter_hash: string;
        target_id: string;
        target_hash: string;
        target_ip: string | null;
        handled: number;
        hidden: number;
      }>(
        `SELECT r.id, r.at, r.room, r.reason, r.nickname, r.reporter_id, r.reporter_hash, r.target_id, r.target_hash,
                r.target_ip, r.handled, (h.guest_hash IS NOT NULL) AS hidden
         FROM report r LEFT JOIN hidden_guest h ON h.guest_hash = r.target_hash
         ORDER BY r.at DESC, r.id DESC LIMIT ?`,
        limit,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        at: row.at,
        room: row.room,
        reason: row.reason,
        nickname: row.nickname,
        reporterId: row.reporter_id,
        reporterHash: row.reporter_hash,
        targetId: row.target_id,
        targetHash: row.target_hash,
        targetIp: row.target_ip,
        handled: row.handled !== 0,
        targetHidden: row.hidden !== 0,
      }));
  }

  /** guestId 해시나 IP 해시로 입장을 막아요. 지금 병실에 있으면 그 병실에서도 내보내요. */
  async adminBlock(target: { guestHash?: string; ipHash?: string }, reason: string, nowMs: number): Promise<AdminResult> {
    const sql = this.ctx.storage.sql;
    const kind = target.guestHash ? "guest" : "ip";
    const value = target.guestHash ?? target.ipHash ?? "";
    sql.exec("INSERT OR REPLACE INTO block (kind, value, at) VALUES (?, ?, ?)", kind, value, nowMs);
    const column = kind === "guest" ? "target_hash" : "target_ip";
    sql.exec(`UPDATE report SET handled = 1 WHERE ${column} = ?`, value);
    if (kind === "guest") sql.exec("DELETE FROM hidden_guest WHERE guest_hash = ?", value);
    this.audit("block", `${kind}:${value}`, reason, nowMs);
    const affected = await this.tellRooms(
      this.roomsOf(column, value),
      kind === "guest" ? { kind: "block", key: value } : { kind: "block", ip: value },
    );
    await this.keepTidy();
    return { ok: true, affected };
  }

  /** 닉네임을 자동 닉네임으로 되돌리고 가림을 풀어요. 신고된 적 있는 사람에게만 할 수 있어요. */
  async adminResetNickname(guestHash: string, reason: string, nowMs: number): Promise<AdminResult> {
    const sql = this.ctx.storage.sql;
    const latest = sql
      .exec<{ nickname: string }>("SELECT nickname FROM report WHERE target_hash = ? ORDER BY at DESC LIMIT 1", guestHash)
      .toArray()[0];
    if (!latest) return { ok: false, error: "unknown_guest" };
    sql.exec(
      "INSERT OR REPLACE INTO nickname_reset (guest_hash, nickname, at) VALUES (?, ?, ?)",
      guestHash,
      latest.nickname,
      nowMs,
    );
    sql.exec("DELETE FROM hidden_guest WHERE guest_hash = ?", guestHash);
    sql.exec("UPDATE report SET handled = 1 WHERE target_hash = ?", guestHash);
    this.audit("reset-nickname", `guest:${guestHash}`, reason, nowMs);
    const affected = await this.tellRooms(this.roomsOf("target_hash", guestHash), {
      kind: "reset",
      key: guestHash,
      banned: latest.nickname,
    });
    await this.keepTidy();
    return { ok: true, affected };
  }

  /** 방명록 링크를 꺼요. */
  async adminRevokeGuestbookLink(guestHash: string, reason: string, nowMs: number): Promise<AdminResult> {
    const before = this.linksOf(guestHash);
    if (before.length === 0) return { ok: false, error: "unknown_guest" };
    await this.disableGuestbookLink(guestHash);
    this.audit("revoke-guestbook-link", `guest:${guestHash}`, reason, nowMs);
    await this.keepTidy();
    return { ok: true, affected: before.filter((row) => !row.off).length };
  }

  /** 사과 하나를 지워요. 사유와 함께 audit_log에 남겨요. 내용은 기록에 옮기지 않아요. */
  async adminHideApple(appleId: number, reason: string, nowMs: number): Promise<AdminResult | { ok: false; error: "unknown_apple" }> {
    const deleted = this.ctx.storage.sql.exec("DELETE FROM apple WHERE id = ?", appleId).rowsWritten;
    if (deleted === 0) return { ok: false, error: "unknown_apple" };
    this.audit("hide-apple", `apple:${appleId}`, reason, nowMs);
    await this.keepTidy();
    return { ok: true, affected: deleted };
  }

  /** 확인해 보니 문제가 없을 때 가림을 풀어요. */
  async adminClearFlag(guestHash: string, reason: string, nowMs: number): Promise<AdminResult> {
    const sql = this.ctx.storage.sql;
    const known = sql.exec("SELECT 1 FROM report WHERE target_hash = ? LIMIT 1", guestHash).toArray().length > 0;
    if (!known) return { ok: false, error: "unknown_guest" };
    sql.exec("DELETE FROM hidden_guest WHERE guest_hash = ?", guestHash);
    sql.exec("UPDATE report SET handled = 1 WHERE target_hash = ?", guestHash);
    this.audit("clear-flag", `guest:${guestHash}`, reason, nowMs);
    const affected = await this.tellRooms(this.roomsOf("target_hash", guestHash), { kind: "unhide", key: guestHash });
    await this.keepTidy();
    return { ok: true, affected };
  }

  private audit(action: string, target: string, reason: string, nowMs: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO audit_log (at, action, target, reason) VALUES (?, ?, ?, ?)",
      nowMs,
      action,
      target,
      reason,
    );
  }

  /** 신고가 들어온 병실들이에요. 그 사람이 지금 있을 만한 곳이에요. column은 이 파일 안의 값만 들어와요. */
  private roomsOf(column: "target_hash" | "target_ip", value: string): string[] {
    return this.ctx.storage.sql
      .exec<{ room: string }>(`SELECT DISTINCT room FROM report WHERE ${column} = ?`, value)
      .toArray()
      .map((row) => row.room)
      .filter((room) => ROOM_PATTERN.test(room));
  }

  /** 병실 서버에 바로 알려요. 그 사람이 지금 없으면 다음 입장 때 standing으로 반영돼요. */
  private async tellRooms(rooms: readonly string[], change: Moderation): Promise<number> {
    let affected = 0;
    for (const room of rooms) {
      try {
        affected += await this.env.WARD_ROOM.getByName(room).moderate(change);
      } catch {
        // 병실에 닿지 않아도 기록은 남았어요. 다음 입장 때 반영돼요.
      }
    }
    return affected;
  }

  /**
   * 들어온 사람에게 새 평안 주소를 주고, 없는 동안 도착한 평안을 꺼내 줘요. 꺼낸 것은 지워요.
   * place가 있으면 켜진 방명록 링크의 주소와 위치도 새로 적어요. linked는 켜진 링크가 있는지예요.
   * tree는 주인 화면에만 그리는 작은 사과나무예요. 링크가 켜져 있거나 사과가 있으면 있어요.
   */
  async enter(
    owner: string,
    nowMs: number,
    place: (OwnerPlace & { nickname: string; animal: string }) | null = null,
  ): Promise<{
    address: string;
    inbox: BlessingCard[];
    linked: boolean;
    visitDays: number;
    welcomeBack: boolean;
    tree: { active: boolean; count: number } | null;
  }> {
    this.tidy(nowMs);
    const address = encodeAddress(crypto.getRandomValues(new Uint8Array(16)));
    const sql = this.ctx.storage.sql;
    const addressHash = await hashAddress(address);
    sql.exec(
      "INSERT INTO address_book (address_hash, owner, created) VALUES (?, ?, ?)",
      addressHash,
      owner,
      nowMs,
    );
    let linked = false;
    if (place) {
      const cursor = sql.exec(
        `UPDATE guestbook_link SET address_hash = ?, nickname = ?, animal = ?, ward = ?, instance = ?, bed = COALESCE(?, bed)
         WHERE owner = ? AND off = 0`,
        addressHash,
        place.nickname,
        place.animal,
        place.ward,
        place.instance,
        place.bed,
        owner,
      );
      linked = cursor.rowsWritten > 0;
    }
    const rows = sql
      .exec<{ nickname: string; animal: string; kind: string; item: number | null; at: number; sender: string }>(
        "SELECT nickname, animal, kind, item, at, sender FROM inbox WHERE owner = ? ORDER BY at ASC",
        owner,
      )
      .toArray();
    // 여기서는 지우지 않아요. 화면이 받았다고 알리면(ackInbox) 그때 지워요. 연결이 끊겨도 잃어버리지 않게요.
    const inbox = rows.map((row) =>
      toCard({ ...row, kind: row.kind === "gift" ? "gift" : "bless" } satisfies StoredBlessing),
    );
    const day = this.countDay(owner, nowMs);
    const visitDays = day.days;
    // 오늘 처음 온 사람이면 서로 다른 사람 수에 더하고, 예전 날에도 왔으면 다시 온 사람에도 더해요.
    this.bump(nowMs, { entries: 1, unique_guests: day.counted ? 1 : 0, returning_guests: day.counted && day.before ? 1 : 0 });
    const welcomeBack = sql.exec("DELETE FROM discharged WHERE guest_hash = ?", owner).rowsWritten > 0;
    const active = this.linksOf(owner).some((row) => !row.off);
    const count = this.appleCount(owner);
    await this.keepTidy();
    return { address, inbox, linked, visitDays, welcomeBack, tree: active || count > 0 ? { active, count } : null };
  }

  /** 화면이 받았다고 알린 평안을 지워요. upTo 시각까지 남겨진 것만이에요. 그사이 새로 온 것은 남아요. */
  async ackInbox(owner: string, upTo: number): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM inbox WHERE owner = ? AND at <= ?", owner, upTo);
  }

  /** 오늘 다녀간 것을 세요. 같은 한국 날짜에는 한 번만이에요. 지금까지의 날 수와 오늘 처음인지, 예전에 온 적 있는지예요. */
  private countDay(owner: string, nowMs: number): { days: number; counted: boolean; before: boolean } {
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<{ days: number; last_day: string }>("SELECT days, last_day FROM guest_days WHERE guest_hash = ?", owner)
      .toArray()[0];
    const next = countVisitDay(row ? { days: row.days, lastDay: row.last_day } : null, koreanDay(new Date(nowMs)));
    sql.exec(
      "INSERT OR REPLACE INTO guest_days (guest_hash, days, last_day, last_at) VALUES (?, ?, ?, ?)",
      owner,
      next.days,
      next.lastDay,
      nowMs,
    );
    return { days: next.days, counted: next.counted, before: row !== undefined };
  }

  /** 퇴원했어요. 다음 입장 때 한 번 반겨 주려고만 적어 둬요. */
  async markDischarged(owner: string, nowMs: number): Promise<void> {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO discharged (guest_hash, at) VALUES (?, ?)", owner, nowMs);
    await this.keepTidy();
  }

  /** 평안 주소의 주인에게 남겨요. 같은 사람에게는 하루 한 번이에요. */
  async leaveFor(sender: string, address: string, card: BlessingCard, nowMs: number, day: string): Promise<LeaveResult> {
    this.tidy(nowMs, day);
    const sql = this.ctx.storage.sql;
    const owner = sql
      .exec<{ owner: string }>("SELECT owner FROM address_book WHERE address_hash = ?", await hashAddress(address))
      .toArray()[0]?.owner;
    if (!owner) return "unknown";
    const result = this.deposit(sender, owner, card, nowMs, day);
    await this.keepTidy();
    return result;
  }

  /** 문병객이 자리에 없는 주인에게 남겨요. 주소 대신 주인의 해시로 바로 남기고, 규칙은 같아요. */
  async leaveForOwner(sender: string, owner: string, card: BlessingCard, nowMs: number, day: string): Promise<LeaveResult> {
    this.tidy(nowMs, day);
    const result = this.deposit(sender, owner, card, nowMs, day);
    await this.keepTidy();
    return result;
  }

  private deposit(sender: string, owner: string, card: BlessingCard, nowMs: number, day: string): LeaveResult {
    const sql = this.ctx.storage.sql;
    if (owner === sender) return "unknown";
    const key = dailyKey(sender, owner, day);
    if (sql.exec("SELECT 1 FROM inbox_daily WHERE key = ?", key).toArray().length > 0) return "once-a-day";

    const existing = sql
      .exec<{ id: number; at: number }>("SELECT id, at FROM inbox WHERE owner = ?", owner)
      .toArray();
    const kept = addLatest(existing, { id: -1, at: card.at }, INBOX_PER_GUEST, nowMs);
    // 10개를 넘거나 7일이 지난 것은 지워요.
    for (const row of existing) {
      if (!kept.some((entry) => entry.id === row.id)) sql.exec("DELETE FROM inbox WHERE id = ?", row.id);
    }
    sql.exec(
      "INSERT INTO inbox (owner, nickname, animal, kind, item, at, sender) VALUES (?, ?, ?, ?, ?, ?, ?)",
      owner,
      card.nickname,
      card.animal,
      card.kind,
      card.item,
      card.at,
      sender,
    );
    sql.exec("INSERT INTO inbox_daily (key, day) VALUES (?, ?)", key, day);
    return "saved";
  }

  /** 하루 한 번만 놓을 수 있는 선물을 오늘 처음 놓는지 보고, 처음이면 적어 둬요. */
  async useDailyGift(guest: string, item: number, day: string): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const last = sql
      .exec<{ day: string }>("SELECT day FROM gift_daily WHERE guest = ? AND item = ?", guest, item)
      .toArray()[0]?.day ?? null;
    if (!fiveLeafAllowed(last, day)) return false;
    sql.exec("INSERT OR REPLACE INTO gift_daily (guest, item, day) VALUES (?, ?, ?)", guest, item, day);
    await this.keepTidy();
    return true;
  }

  /** 내 방명록 링크를 새로 만들어요. 예전 링크는 바로 열리지 않아요. 토큰 원본은 돌려주기만 하고 해시만 둬요. */
  async createGuestbookLink(owner: string, profile: OwnerProfile, place: OwnerPlace & { bed: number }, nowMs: number): Promise<string> {
    const token = encodeAddress(crypto.getRandomValues(new Uint8Array(16)));
    const sql = this.ctx.storage.sql;
    const rows = this.linksOf(owner);
    const next = replaceLink(rows, {
      tokenHash: await hashToken(token),
      owner,
      addressHash: await hashAddress(profile.address),
      nickname: profile.nickname,
      animal: profile.animal,
      created: nowMs,
      ward: place.ward,
      instance: place.instance,
      bed: place.bed,
    });
    sql.exec("DELETE FROM guestbook_link WHERE owner = ?", owner);
    sql.exec("DELETE FROM visit_attempt WHERE owner = ?", owner);
    sql.exec("DELETE FROM visit_session WHERE owner = ?", owner);
    for (const row of next.filter((entry) => entry.owner === owner)) this.writeLink(row);
    await this.keepTidy();
    return token;
  }

  /** 링크를 꺼요. 꺼진 링크로는 사과를 달 수도, 문병 올 수도 없어요. */
  async disableGuestbookLink(owner: string): Promise<GuestbookStatus> {
    const next = turnOffLink(this.linksOf(owner), owner);
    for (const row of next) {
      this.ctx.storage.sql.exec("UPDATE guestbook_link SET off = ? WHERE token_hash = ?", row.off ? 1 : 0, row.tokenHash);
    }
    return this.guestbookStatus(owner);
  }

  /** 주인이 보는 내 방명록이에요. 주인의 연결에서만 불러요. */
  async guestbookStatus(owner: string): Promise<GuestbookStatus> {
    const link = this.linksOf(owner)[0];
    const tree = ownerTree(this.applesOf(owner));
    return { active: link ? !link.off : false, count: tree.count, apples: tree.apples };
  }

  /** 내 침대 옆 작은 사과나무를 그릴지예요. 30초 안에 다시 이은 주인에게 써요. 내용은 담지 않아요. */
  async treeOf(owner: string): Promise<{ active: boolean; count: number } | null> {
    const active = this.linksOf(owner).some((row) => !row.off);
    const count = this.appleCount(owner);
    return active || count > 0 ? { active, count } : null;
  }

  /** 주인이 사과를 숨겨요. 자기 나무의 사과만 지울 수 있고, 바로 지워요. */
  async hideApple(owner: string, appleId: number): Promise<GuestbookStatus> {
    this.ctx.storage.sql.exec("DELETE FROM apple WHERE id = ? AND owner = ?", appleId, owner);
    return this.guestbookStatus(owner);
  }

  /** 링크가 있는 주인이 침대를 받거나 병동을 나갈 때 병실 서버가 알려 줘요. 주기적으로 묻지 않아요. */
  async reportLocation(owner: string, place: OwnerPlace): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE guestbook_link SET ward = ?, instance = ?, bed = COALESCE(?, bed) WHERE owner = ? AND off = 0",
      place.ward,
      place.instance,
      place.bed,
      owner,
    );
  }

  /**
   * 링크로 온 사람이 보는 방명록이에요. 세지 않고 보기만 해요.
   * writer는 그 브라우저의 열쇠예요. 그 열쇠로 단 사과만 내용을 돌려줘요.
   */
  async viewGuestbook(token: string, writer: string | null): Promise<GuestbookViewResult> {
    const link = await this.linkForToken(token);
    if (!link || link.off) return { open: false };
    const tree = visitorTree(this.applesOf(link.owner), writer ? await hashWriter(writer) : null);
    return {
      open: true,
      ownerNickname: link.nickname,
      ownerAnimal: link.animal,
      ward: link.ward,
      instance: link.instance,
      count: tree.count,
      mine: tree.mine,
    };
  }

  /** 링크로 온 사람이 사과를 달아요. 토큰, 꺼짐, 시간당 10개, 이름과 짧은 글을 모두 여기서 살펴요. */
  async addApple(token: string, writer: string, draft: AppleDraft, nowMs: number): Promise<AddAppleResult> {
    const sql = this.ctx.storage.sql;
    const tokenHash = await hashToken(token);
    const link = await this.linkForToken(token);
    const recent = sql
      .exec<{ at: number }>("SELECT at FROM apple WHERE link_hash = ? AND at > ?", tokenHash, nowMs - APPLE_HOUR_MS)
      .toArray()
      .map((row) => row.at);
    const post = checkApplePost(link, recent, nowMs);
    if (post.kind !== "ok") return { result: post.kind };
    const checked = checkApple(draft);
    if (!checked.ok) {
      const { ok: _ok, ...problem } = checked;
      return { result: "invalid", ...problem };
    }
    const owner = post.link.owner;
    const seq = sql.exec<{ next: number }>("SELECT next FROM apple_seq WHERE owner = ?", owner).toArray()[0]?.next ?? 0;
    sql.exec("INSERT OR REPLACE INTO apple_seq (owner, next, at) VALUES (?, ?, ?)", owner, seq + 1, nowMs);
    const slot = slotFor(seq);
    const id = sql
      .exec<{ id: number }>(
        `INSERT INTO apple (owner, name, phrase, note, at, link_hash, writer_hash, slot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        owner,
        checked.value.name,
        checked.value.phrase,
        checked.value.note,
        nowMs,
        tokenHash,
        await hashWriter(writer),
        slot,
      )
      .one().id;
    await this.keepTidy();
    return {
      result: "saved",
      apple: { id, slot, name: checked.value.name, phrase: checked.value.phrase, note: checked.value.note, at: nowMs },
      count: this.appleCount(owner),
    };
  }

  private applesOf(owner: string): StoredApple[] {
    return this.ctx.storage.sql
      .exec<AppleSqlRow>("SELECT * FROM apple WHERE owner = ? ORDER BY id ASC", owner)
      .toArray()
      .map((row) => ({
        id: row.id,
        owner: row.owner,
        name: row.name,
        phrase: row.phrase,
        note: row.note,
        at: row.at,
        linkHash: row.link_hash,
        writerHash: row.writer_hash,
        slot: row.slot,
      }));
  }

  private appleCount(owner: string): number {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM apple WHERE owner = ?", owner).one().n;
  }

  /** 링크로 들어오는 사람을 받을지 정해요. 받으면 문병 온 횟수를 하나 더하고 자리 번호를 줘요. */
  async resolveVisit(token: string, visitor: string, nowMs: number): Promise<VisitResolution> {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM visit_attempt WHERE at < ?", nowMs - HOUR_MS);
    sql.exec("DELETE FROM visit_session WHERE started < ?", nowMs - VISIT_SESSION_MS);
    const link = await this.linkForToken(token);
    const owner = link?.owner ?? "";
    const active = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM visit_session WHERE owner = ?", owner).one().n;
    const attempts = sql
      .exec<{ at: number }>("SELECT at FROM visit_attempt WHERE owner = ?", owner)
      .toArray()
      .map((row) => row.at);
    const check = checkVisit(link, visitor, active, attempts, nowMs);
    if (check.kind !== "ok") return { kind: check.kind };
    const session = crypto.randomUUID();
    sql.exec("INSERT INTO visit_attempt (owner, at) VALUES (?, ?)", owner, nowMs);
    sql.exec("INSERT INTO visit_session (id, owner, started) VALUES (?, ?, ?)", session, owner, nowMs);
    sql.exec("UPDATE guestbook_link SET visits = visits + 1 WHERE owner = ?", owner);
    this.bump(nowMs, { visit_entries: 1 });
    await this.keepTidy();
    return { kind: "ok", owner, ownerNickname: check.link.nickname, bed: check.link.bed, session };
  }

  /** 문병객이 나가면 자리를 돌려줘요. */
  async releaseVisit(session: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM visit_session WHERE id = ?", session);
  }

  private linksOf(owner: string): VisitLinkRow[] {
    return this.ctx.storage.sql
      .exec<LinkSqlRow>("SELECT * FROM guestbook_link WHERE owner = ?", owner)
      .toArray()
      .map(toLinkRow);
  }

  private async linkForToken(token: string): Promise<VisitLinkRow | null> {
    const tokenHash = await hashToken(token);
    const rows = this.ctx.storage.sql
      .exec<LinkSqlRow>("SELECT * FROM guestbook_link WHERE token_hash = ?", tokenHash)
      .toArray()
      .map(toLinkRow);
    return findLink(rows, tokenHash);
  }

  private writeLink(row: VisitLinkRow): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO guestbook_link (token_hash, owner, address_hash, nickname, animal, created, off, visits, ward, instance, bed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.tokenHash,
      row.owner,
      row.addressHash,
      row.nickname,
      row.animal,
      row.created,
      row.off ? 1 : 0,
      row.visits,
      row.ward,
      row.instance,
      row.bed,
    );
  }

  private tidy(nowMs: number, day?: string): void {
    const sql = this.ctx.storage.sql;
    const cutoff = nowMs - KEEP_MS;
    sql.exec("DELETE FROM address_book WHERE created < ?", cutoff);
    sql.exec("DELETE FROM inbox WHERE at < ?", cutoff);
    if (day) {
      sql.exec("DELETE FROM inbox_daily WHERE day != ?", day);
      sql.exec("DELETE FROM gift_daily WHERE day != ?", day);
    }
  }
}

async function hashAddress(address: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`onward-address:${address}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`onward-guestbook:${token}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashWriter(writer: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`onward-apple-writer:${writer}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toLinkRow(row: LinkSqlRow): VisitLinkRow {
  return {
    tokenHash: row.token_hash,
    owner: row.owner,
    addressHash: row.address_hash,
    nickname: row.nickname,
    animal: row.animal,
    created: row.created,
    off: row.off !== 0,
    visits: row.visits,
    ward: row.ward,
    instance: row.instance,
    bed: row.bed,
  };
}
