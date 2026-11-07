import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { clientMessageSchema, parseMessage, PROTOCOL_VERSION, adminBlockSchema } from "../shared/protocol.ts";
import {
  DAY_MS,
  decideReport,
  deleteExpired,
  earlierAlarm,
  earliestExpiry,
  enforceBannedNickname,
  HIDE_AFTER_REPORTERS,
  KEEP,
  MESSAGES_PER_SECOND,
  newRateState,
  nextRetentionAlarm,
  publicNickname,
  rateStep,
  REPORTS_PER_DAY,
  underHourlyLimit,
} from "../shared/safety-rules.ts";
import type { RateState, RateVerdict, RetentionRule, SqlLike } from "../shared/safety-rules.ts";
import { toPublic } from "../shared/ward-rules.ts";
import type { GuestRecord } from "../shared/ward-rules.ts";

/* ───────────── 요청 제한 ───────────── */

function send(state: RateState, at: number, times: number): { state: RateState; verdicts: RateVerdict[] } {
  const verdicts: RateVerdict[] = [];
  for (let i = 0; i < times; i++) {
    const step = rateStep(state, at);
    state = step.state;
    verdicts.push(step.verdict);
  }
  return { state, verdicts };
}

test("1초에 10개까지는 받고, 넘는 것은 읽지 않아요", () => {
  const { verdicts } = send(newRateState(), 1000, MESSAGES_PER_SECOND + 3);
  assert.deepEqual(verdicts.slice(0, MESSAGES_PER_SECOND), Array(MESSAGES_PER_SECOND).fill("ok"));
  assert.deepEqual(verdicts.slice(MESSAGES_PER_SECOND), ["drop", "drop", "drop"]);
});

test("1초가 지나면 다시 10개를 받아요", () => {
  let { state } = send(newRateState(), 0, MESSAGES_PER_SECOND);
  const next = rateStep(state, 1000);
  assert.equal(next.verdict, "ok");
  state = next.state;
  assert.equal(state.count, 1);
});

test("넘친 초가 3번 이어지면 연결을 닫아요", () => {
  let state = newRateState();
  let last: RateVerdict[] = [];
  for (const second of [0, 1000, 2000]) {
    ({ state, verdicts: last } = send(state, second, MESSAGES_PER_SECOND + 1));
  }
  assert.equal(last.at(-1), "close");
});

test("넘친 초 사이에 조용한 초가 있으면 처음부터 다시 세요", () => {
  let state = newRateState();
  let last: RateVerdict[] = [];
  ({ state } = send(state, 0, MESSAGES_PER_SECOND + 1));
  ({ state } = send(state, 1000, MESSAGES_PER_SECOND + 1));
  // 2초 동안 아무것도 보내지 않았어요.
  ({ state, verdicts: last } = send(state, 4000, MESSAGES_PER_SECOND + 1));
  assert.equal(last.at(-1), "drop");
  assert.equal(state.strikes, 1);
});

test("한 시간 한도는 지난 한 시간만 세요", () => {
  const now = 10 * 3_600_000;
  const recent = Array.from({ length: 19 }, (_, i) => now - i * 1000);
  assert.equal(underHourlyLimit(recent, now, 20), true);
  assert.equal(underHourlyLimit([...recent, now], now, 20), false);
  assert.equal(underHourlyLimit([...recent, now - 3_600_000], now, 20), true);
});

/* ───────────── 신고 ───────────── */

const facts = (over: Partial<Parameters<typeof decideReport>[0]> = {}) => ({
  reporter: "r1",
  target: "t1",
  reporterToday: 0,
  openReporters: [] as string[],
  alreadyHidden: false,
  ...over,
});

test("서로 다른 세 사람이 신고하면 그때 닉네임을 가려요", () => {
  assert.equal(HIDE_AFTER_REPORTERS, 3);
  assert.deepEqual(decideReport(facts()), { result: "saved", hide: false });
  assert.deepEqual(decideReport(facts({ reporter: "r2", openReporters: ["r1"] })), { result: "saved", hide: false });
  assert.deepEqual(decideReport(facts({ reporter: "r3", openReporters: ["r1", "r2"] })), { result: "saved", hide: true });
  // 이미 가려졌으면 다시 가리지 않아요.
  assert.deepEqual(decideReport(facts({ reporter: "r4", openReporters: ["r1", "r2", "r3"], alreadyHidden: true })), {
    result: "saved",
    hide: false,
  });
});

test("같은 사람이 여러 번 신고해도 한 사람으로 세요", () => {
  assert.deepEqual(decideReport(facts({ reporter: "r1", openReporters: ["r1", "r2"] })), { result: "already", hide: false });
});

test("신고는 한 사람당 하루 5번까지예요", () => {
  assert.equal(REPORTS_PER_DAY, 5);
  assert.equal(decideReport(facts({ reporterToday: 4 })).result, "saved");
  assert.equal(decideReport(facts({ reporterToday: 5 })).result, "limit");
  // 한도를 넘은 신고는 가림에도 세지 않아요.
  assert.deepEqual(decideReport(facts({ reporterToday: 5, openReporters: ["a", "b"] })), { result: "limit", hide: false });
});

test("나 자신은 신고할 수 없어요", () => {
  assert.equal(decideReport(facts({ reporter: "t1" })).result, "no-target");
});

const record = (over: Partial<GuestRecord> = {}): GuestRecord => ({
  id: "abcd1234",
  guestId: "secret-guest",
  animal: "rabbit",
  outfit: "patient",
  nickname: "불편한이름",
  withCat: false,
  x: 0,
  z: 0,
  bed: null,
  address: "Q".repeat(22),
  lyingSince: null,
  lastAction: {},
  ...over,
});

test("가려진 사람은 다른 사람에게 '조용한 동물'로 보이고 원래 닉네임은 가지 않아요", () => {
  assert.equal(publicNickname({ nickname: "불편한이름", animal: "rabbit", hidden: true }), "조용한 토끼");
  assert.equal(publicNickname({ nickname: "불편한이름", animal: "bear", hidden: false }), "불편한이름");
  const shown = toPublic(record({ hidden: true, ip: "f".repeat(64), key: "e".repeat(64) }));
  assert.equal(shown.nickname, "조용한 토끼");
  const text = JSON.stringify(shown);
  // 원래 닉네임, IP 해시, guestId와 그 해시는 남에게 보내지 않아요.
  for (const secret of ["불편한이름", "f".repeat(64), "e".repeat(64), "secret-guest"]) {
    assert.equal(text.includes(secret), false);
  }
});

test("운영자가 되돌린 닉네임으로 다시 바꾸면 자동 닉네임이 돼요", () => {
  const same = enforceBannedNickname(" 불편한이름 ", "불편한이름", "bear", 0);
  assert.equal(same.reset, true);
  assert.equal(same.nickname, "졸린 곰");
  assert.deepEqual(enforceBannedNickname("다른이름", "불편한이름", "bear", 0), { nickname: "다른이름", reset: false });
  assert.deepEqual(enforceBannedNickname("불편한이름", null, "bear", 0), { nickname: "불편한이름", reset: false });
});

test("신고 메시지는 번호만 받아요", () => {
  const ok = JSON.stringify({ v: PROTOCOL_VERSION, type: "report", targetId: "abcd1234", reason: 2 });
  assert.ok(parseMessage(clientMessageSchema, ok));
  for (const bad of [
    { v: PROTOCOL_VERSION, type: "report", targetId: "abcd1234", reason: 3 },
    { v: PROTOCOL_VERSION, type: "report", targetId: "abcd1234", reason: "닉네임" },
    { v: PROTOCOL_VERSION, type: "report", targetId: "x", reason: 0 },
  ]) {
    assert.equal(parseMessage(clientMessageSchema, JSON.stringify(bad)), null);
  }
});

test("hello에 guestId를 보내도 서버는 읽지 않아요", () => {
  const raw = JSON.stringify({
    v: PROTOCOL_VERSION,
    type: "hello",
    guestId: "someone-else-0001",
    animal: "bear",
    outfit: "patient",
    nickname: "따뜻한 곰",
    withCat: false,
  });
  const parsed = parseMessage(clientMessageSchema, raw);
  assert.ok(parsed);
  assert.equal("guestId" in parsed, false);
});

test("차단은 guestId 해시나 IP 해시 가운데 하나만 받아요", () => {
  const hash = "a".repeat(64);
  assert.equal(adminBlockSchema.safeParse({ v: PROTOCOL_VERSION, guestHash: hash, reason: "반복 신고" }).success, true);
  assert.equal(adminBlockSchema.safeParse({ v: PROTOCOL_VERSION, ipHash: hash, reason: "반복 신고" }).success, true);
  assert.equal(adminBlockSchema.safeParse({ v: PROTOCOL_VERSION, guestHash: hash, ipHash: hash, reason: "x" }).success, false);
  assert.equal(adminBlockSchema.safeParse({ v: PROTOCOL_VERSION, reason: "x" }).success, false);
  assert.equal(adminBlockSchema.safeParse({ v: PROTOCOL_VERSION, guestHash: hash, reason: "  " }).success, false);
  assert.equal(adminBlockSchema.safeParse({ v: PROTOCOL_VERSION, guestHash: "zz", reason: "x" }).success, false);
});

/* ───────────── 보관 기간 ───────────── */

test("지울 데이터가 있을 때만 alarm을 맞추고, 하루에 한 번보다 자주 깨지 않아요", () => {
  const now = 1_000_000_000;
  assert.equal(nextRetentionAlarm(null, now), null);
  // 곧 지울 때가 돼도 하루 뒤에 깨요.
  assert.equal(nextRetentionAlarm(now + 1000, now), now + DAY_MS);
  assert.equal(nextRetentionAlarm(now - 5000, now), now + DAY_MS);
  // 한참 뒤에 지울 것만 있으면 그때까지 깨지 않아요.
  assert.equal(nextRetentionAlarm(now + 10 * DAY_MS, now), now + 10 * DAY_MS);
});

test("재접속 유예와 보관 기간 alarm 가운데 이른 것을 맞춰요", () => {
  assert.equal(earlierAlarm(null, null), null);
  assert.equal(earlierAlarm(5, null), 5);
  assert.equal(earlierAlarm(null, 7), 7);
  assert.equal(earlierAlarm(9, 7), 7);
});

/** node:sqlite를 Durable Object의 sql과 같은 모양으로 감싸요. */
function memorySql(): { sql: SqlLike; count(table: string): number } {
  const db = new DatabaseSync(":memory:");
  const sql: SqlLike = {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      if (/^\s*SELECT/i.test(query)) {
        const rows = statement.all(...bindings) as Record<string, unknown>[];
        return { toArray: () => rows };
      }
      statement.run(...bindings);
      return { toArray: () => [] };
    },
  };
  return {
    sql,
    count: (table) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
  };
}

const RULES: RetentionRule[] = [
  { table: "left_blessing", kind: "at", column: "at", keepMs: KEEP.blessing },
  { table: "report", kind: "at", column: "at", keepMs: KEEP.report },
  { table: "audit_log", kind: "at", column: "at", keepMs: KEEP.audit },
  { table: "visit_link", kind: "at", column: "created", keepMs: KEEP.blessing, where: "off = 1" },
  { table: "gifts", kind: "day", column: "day" },
];

function seeded(now: number) {
  const memory = memorySql();
  const { sql } = memory;
  sql.exec("CREATE TABLE left_blessing (at INTEGER NOT NULL)");
  sql.exec("CREATE TABLE report (at INTEGER NOT NULL)");
  sql.exec("CREATE TABLE audit_log (at INTEGER NOT NULL)");
  sql.exec("CREATE TABLE visit_link (created INTEGER NOT NULL, off INTEGER NOT NULL)");
  sql.exec("CREATE TABLE gifts (day TEXT NOT NULL)");
  // 7일, 30일, 1년을 하루씩 넘긴 것과 하루 덜 된 것을 넣어요.
  for (const [table, keep] of [
    ["left_blessing", KEEP.blessing],
    ["report", KEEP.report],
    ["audit_log", KEEP.audit],
  ] as const) {
    sql.exec(`INSERT INTO ${table} (at) VALUES (?)`, now - keep - DAY_MS);
    sql.exec(`INSERT INTO ${table} (at) VALUES (?)`, now - keep + DAY_MS);
  }
  // 오래된 링크라도 켜져 있으면 지우지 않아요.
  sql.exec("INSERT INTO visit_link (created, off) VALUES (?, 1)", now - KEEP.blessing - DAY_MS);
  sql.exec("INSERT INTO visit_link (created, off) VALUES (?, 0)", now - KEEP.blessing - DAY_MS);
  sql.exec("INSERT INTO gifts (day) VALUES ('2026-11-07')");
  sql.exec("INSERT INTO gifts (day) VALUES ('2026-11-08')");
  return memory;
}

test("보관 기간이 지난 데이터만 지워요: 평안 7일, 신고 30일, 운영자 기록 1년", () => {
  const now = Date.UTC(2026, 10, 8, 3);
  const { sql, count } = seeded(now);
  deleteExpired(sql, RULES, now, "2026-11-08");
  assert.equal(count("left_blessing"), 1);
  assert.equal(count("report"), 1);
  assert.equal(count("audit_log"), 1);
  assert.equal(count("visit_link"), 1);
  assert.equal(count("gifts"), 1);
});

test("남은 데이터의 가장 이른 만료로 다음 alarm을 정하고, 다 지우면 맞추지 않아요", () => {
  const now = Date.UTC(2026, 10, 8, 3);
  const { sql } = seeded(now);
  deleteExpired(sql, RULES, now, "2026-11-08");
  // 날짜로 두는 선물이 남아 있어서 하루 뒤에 깨요.
  assert.equal(nextRetentionAlarm(earliestExpiry(sql, RULES, now), now), now + DAY_MS);

  const empty = memorySql();
  empty.sql.exec("CREATE TABLE left_blessing (at INTEGER NOT NULL)");
  const only: RetentionRule[] = [RULES[0]];
  assert.equal(nextRetentionAlarm(earliestExpiry(empty.sql, only, now), now), null);
  // 사흘 전 평안 하나만 있으면 4일 뒤에 깨요.
  empty.sql.exec("INSERT INTO left_blessing (at) VALUES (?)", now - 3 * DAY_MS);
  assert.equal(nextRetentionAlarm(earliestExpiry(empty.sql, only, now), now), now + 4 * DAY_MS);
  deleteExpired(empty.sql, only, now + 4 * DAY_MS, "2026-11-12");
  assert.equal(nextRetentionAlarm(earliestExpiry(empty.sql, only, now + 4 * DAY_MS), now + 4 * DAY_MS), null);
});
