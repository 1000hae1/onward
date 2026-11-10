import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  canSleep,
  EMPTY_KEPT,
  keepForSleeper,
  KEPT_SENDER_MAX,
  nextSleepDeadline,
  readKept,
  settleSleep,
  SLEEP_LIMIT_MS,
  sleepChange,
  sleeperFor,
  sleptSummaryText,
  sleptTooLong,
  wakeSummary,
  withheldFromSleeper,
} from "../shared/sleep-rules.ts";
import type { SleepKept } from "../shared/sleep-rules.ts";
import { clientMessageSchema, parseMessage, PROTOCOL_VERSION, serverMessageSchema, WARD_CAPACITY } from "../shared/protocol.ts";
import type { WardEvent } from "../shared/protocol.ts";
import { admit, resolveTarget, toPublic } from "../shared/ward-rules.ts";
import type { GuestRecord, VerifiedHello } from "../shared/ward-rules.ts";
import { standUp } from "../shared/bed-rules.ts";
import { startDischarge } from "../shared/discharge-rules.ts";

const NOW = 1_700_000_000_000;
const v = PROTOCOL_VERSION;

const person = (id: string, over: Partial<GuestRecord> = {}): GuestRecord => ({
  id,
  guestId: `guest-${id}`,
  key: `key-${id}`,
  animal: "bear",
  outfit: "patient",
  nickname: "따뜻한 곰",
  withCat: false,
  x: 0,
  z: 0,
  bed: null,
  address: "A".repeat(22),
  lyingSince: null,
  lastAction: {},
  ...over,
});

const lying = (id: string, bed: number, over: Partial<GuestRecord> = {}): GuestRecord =>
  person(id, { bed, lyingSince: NOW - 1000, ...over });

/** 서버가 하는 일을 순서대로 흉내 내요. 잠든 사람 몫은 저장소처럼 JSON 글자로 오가요. */
function keepThroughStore(stored: string | null, sender: string, kind: "bless" | "gift"): string {
  return JSON.stringify(keepForSleeper(readKept(stored), sender, kind));
}

/* ───────── 잠들기와 깨어나기 ───────── */

test("침대에 누워 있을 때만 잠들 수 있어요", () => {
  assert.equal(sleepChange(person("aaaaaaaa"), true, NOW), null);
  assert.equal(sleepChange(person("aaaaaaaa", { bed: 3 }), true, NOW), null, "침대만 있고 서 있으면 안 돼요");
  const slept = sleepChange(lying("aaaaaaaa", 3), true, NOW);
  assert.ok(slept);
  assert.equal(slept.sleeping, true);
  assert.equal(slept.sleptAt, NOW);
  assert.equal(canSleep(lying("aaaaaaaa", 3, { discharge: { at: NOW, from: [] } })), false);
});

test("같은 값이 다시 오면 바뀌는 것이 없어서 아무에게도 알리지 않아요", () => {
  const slept = sleepChange(lying("aaaaaaaa", 3), true, NOW)!;
  assert.equal(sleepChange(slept, true, NOW + 5000), null);
  assert.equal(sleepChange(lying("aaaaaaaa", 3), false, NOW), null);
  const woke = sleepChange(slept, false, NOW + 60_000)!;
  assert.equal(woke.sleeping, false);
  assert.equal(woke.sleptAt, undefined);
});

test("일어나거나 퇴원하면 서버가 저장하면서 깨워요", () => {
  const slept = sleepChange(lying("aaaaaaaa", 3), true, NOW)!;
  assert.equal(settleSleep(slept), slept, "계속 누워 있으면 그대로예요");
  assert.equal(settleSleep(standUp(slept)!).sleeping, false);
  assert.equal(settleSleep({ ...slept, x: 2, lyingSince: null }).sleeping, false);
  assert.equal(settleSleep(startDischarge(slept, NOW)).sleeping, false);
});

/* ───────── 다른 사람 화면 ───────── */

test("새로 들어온 사람의 snapshot에 잠든 상태가 들어가요", () => {
  const sleeper = sleepChange(lying("aaaaaaaa", 3), true, NOW)!;
  const awakeGuest = lying("bbbbbbbb", 4);
  const guests = [sleeper, awakeGuest].map(toPublic);
  assert.equal(guests[0].sleeping, true);
  assert.equal(guests[0].hugOk, false);
  assert.equal(guests[1].sleeping, false);
  // 서버가 보내는 snapshot을 화면이 zod로 그대로 읽어요.
  const snapshot = {
    v,
    type: "snapshot",
    you: "cccccccc",
    capacity: WARD_CAPACITY,
    guests,
    gifts: [],
    lamps: [0, 0, 0, 0, 0, 0],
    seasonalGifts: true,
    serverNow: NOW,
    catVisits: [],
    restored: false,
    inbox: [],
    stats: { visitors: 2, blessings: 0, lamps: 0 },
    visit: null,
    greet: false,
    welcomeBack: false,
    fiveLeafUsed: null,
    morningRooms: [],
    planters: [0, 0, 0, 0, 0, 0],
  };
  const parsed = parseMessage(serverMessageSchema, JSON.stringify(snapshot));
  assert.ok(parsed && parsed.type === "snapshot");
  assert.equal(parsed.guests.find((guest) => guest.id === "aaaaaaaa")?.sleeping, true);
});

test("30초 안에 다시 이어지면 잠든 채로 돌아와서 다른 사람 화면도 그대로예요", () => {
  const sleeper = sleepChange(lying("aaaaaaaa", 3), true, NOW)!;
  const hello: VerifiedHello = {
    v,
    type: "hello",
    animal: "bear",
    outfit: "patient",
    nickname: "따뜻한 곰",
    withCat: false,
    guestId: sleeper.guestId,
  };
  const back = admit([], 0, hello, WARD_CAPACITY, "newid000", sleeper);
  assert.equal(back.kind, "admitted");
  if (back.kind !== "admitted") return;
  assert.equal(toPublic(back.record).sleeping, true);
});

test("sleep 메시지와 sleep event는 zod로 검사하고 v가 있어요", () => {
  const read = (value: unknown) => parseMessage(clientMessageSchema, JSON.stringify(value));
  assert.ok(read({ v, type: "sleep", sleeping: true }));
  assert.ok(read({ v, type: "sleep", sleeping: false }));
  assert.equal(read({ v, type: "sleep" }), null);
  assert.equal(read({ v, type: "sleep", sleeping: "yes" }), null);
  assert.equal(read({ v: v - 1, type: "sleep", sleeping: true }), null);
  const event = { v, type: "event", event: { kind: "sleep", id: "aaaaaaaa", sleeping: true, hugOk: false } };
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify(event)));
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify({ v, type: "kept-quiet" })));
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify({ v, type: "slept-summary", people: 3, gifts: 1 })));
  assert.equal(parseMessage(serverMessageSchema, JSON.stringify({ v, type: "slept-summary", people: 0, gifts: 0 })), null);
});

/* ───────── 잠든 사람에게 보내는 평안·선물·목례 ───────── */

test("잠든 사람에게 평안 → 쌓였다가 깨어날 때 한 번에 전해져요", () => {
  const sleeper = sleepChange(lying("aaaaaaaa", 3), true, NOW)!;
  const b = person("bbbbbbbb", { x: 1 });
  const c = person("cccccccc", { x: 2 });
  const everyone = [sleeper, b, c];

  // b는 사람을, c는 침대를 골라 평안을 빌어요. 둘 다 잠든 사람 몫이에요.
  const byPerson = resolveTarget(everyone, { targetId: sleeper.id })!;
  const byBed = resolveTarget(everyone, { bedId: 3 })!;
  assert.equal(sleeperFor(everyone, byPerson, b.id)?.id, sleeper.id);
  assert.equal(sleeperFor(everyone, byBed, c.id)?.id, sleeper.id);

  // 잠든 사람의 화면에는 bless event를 보내지 않아요. 보는 다른 사람에게는 보내요.
  const event: WardEvent = { kind: "bless", id: b.id, ...byPerson };
  assert.equal(withheldFromSleeper(event, sleeper), true);
  assert.equal(withheldFromSleeper(event, c), false);
  assert.equal(withheldFromSleeper({ kind: "bless", id: c.id, ...byBed }, sleeper), true);

  // 서버 저장소에 쌓아요. b가 두 번 보내도 한 분으로 세요. c는 선물도 놓았어요.
  let stored: string | null = null;
  stored = keepThroughStore(stored, "key-b", "bless");
  stored = keepThroughStore(stored, "key-c", "bless");
  stored = keepThroughStore(stored, "key-b", "bless");
  stored = keepThroughStore(stored, "key-c", "gift");

  // 자는 동안에는 아무것도 전하지 않다가, 깨어나면 숫자만 한 번에 전해요.
  const woke = sleepChange(sleeper, false, NOW + 3_600_000)!;
  assert.equal(woke.sleeping, false);
  const summary = wakeSummary(readKept(stored));
  assert.deepEqual(summary, { people: 2, gifts: 1 });
  assert.equal(sleptSummaryText(2, 0), "자는 동안 2분이 평안을 빌어 주셨어요");
  assert.equal(sleptSummaryText(2, 1), "자는 동안 2분이 평안을 빌어 주셨어요. 머리맡에 선물이 1개 놓여 있어요");
  // 보낸 사람의 해시는 요약에 들어가지 않아요.
  assert.equal(JSON.stringify(summary).includes("key-"), false);
  // 깨어나서 받은 뒤에는 다시 보내지 않아요.
  assert.equal(wakeSummary(EMPTY_KEPT), null);
});

test("깨어 있는 사람이나 나 자신에게는 쌓지 않아요", () => {
  const awakeGuest = lying("aaaaaaaa", 3);
  const sleeper = sleepChange(lying("bbbbbbbb", 4), true, NOW)!;
  const everyone = [awakeGuest, sleeper];
  assert.equal(sleeperFor(everyone, { bedId: 3, targetId: null }, "cccccccc"), null);
  assert.equal(sleeperFor(everyone, { bedId: 4, targetId: null }, sleeper.id), null);
  assert.equal(sleeperFor(everyone, { bedId: 9, targetId: null }, "cccccccc"), null);
  assert.equal(withheldFromSleeper({ kind: "bless", id: "cccccccc", bedId: 3, targetId: null }, awakeGuest), false);
});

test("목례와 한마디는 잠든 사람에게 보내지 않아요", () => {
  const sleeper = sleepChange(lying("aaaaaaaa", 3), true, NOW)!;
  const bow: WardEvent = { kind: "bow", id: "bbbbbbbb", phrase: 0 };
  assert.equal(withheldFromSleeper(bow, sleeper), true);
  assert.equal(withheldFromSleeper(bow, lying("cccccccc", 4)), false);
  // 걷기, 선물(머리맡 상태), 잠든 알림 같은 나머지는 그대로 받아요.
  assert.equal(withheldFromSleeper({ kind: "walk", id: "bbbbbbbb", x: 0, z: 0 }, sleeper), false);
  assert.equal(withheldFromSleeper({ kind: "gift", id: "bbbbbbbb", gift: { stand: 3, slot: 0, item: 0 } }, sleeper), false);
});

test("쌓아 둔 사람 수는 끝이 있고, 저장소 값이 망가져도 빈 것으로 봐요", () => {
  let kept: SleepKept = EMPTY_KEPT;
  for (let index = 0; index < KEPT_SENDER_MAX + 5; index++) kept = keepForSleeper(kept, `key-${index}`, "bless");
  assert.equal(kept.senders.length, KEPT_SENDER_MAX);
  assert.equal(wakeSummary(kept)?.people, KEPT_SENDER_MAX + 5);
  assert.deepEqual(readKept("not json"), EMPTY_KEPT);
  assert.deepEqual(readKept(JSON.stringify({ senders: [1, "a"], overflow: -1, gifts: 2.5 })), { senders: ["a"], overflow: 0, gifts: 0 });
});

/* ───────── 8시간 ───────── */

test("잠든 지 8시간이 지나면 연결을 닫을 때예요", () => {
  const sleeper = sleepChange(lying("aaaaaaaa", 3), true, NOW)!;
  assert.equal(sleptTooLong(sleeper, NOW + SLEEP_LIMIT_MS - 1), false);
  assert.equal(sleptTooLong(sleeper, NOW + SLEEP_LIMIT_MS), true);
  assert.equal(sleptTooLong(lying("bbbbbbbb", 4), NOW + SLEEP_LIMIT_MS * 2), false);
  const later = sleepChange(lying("cccccccc", 5), true, NOW + 1000)!;
  assert.equal(nextSleepDeadline([later, sleeper, lying("dddddddd", 6)]), NOW + SLEEP_LIMIT_MS);
  assert.equal(nextSleepDeadline([lying("dddddddd", 6)]), null);
});

/* ───────── 서버가 지키는 것 ───────── */

test("자는 동안의 요약은 그 사람 연결에만 보내고, 다른 사람에게 가는 event에는 넣지 않아요", () => {
  const source = readFileSync(new URL("../worker/ward-room.ts", import.meta.url), "utf8");
  const sends = source.split("\n").filter((line) => /type: "(slept-summary|kept-quiet)"/.test(line));
  assert.ok(sends.length >= 3);
  for (const line of sends) assert.match(line, /this\.send\(ws, /);
  assert.doesNotMatch(source, /broadcast\([^)]*(slept-summary|kept-quiet|sleep_kept)/);
  // 주기적으로 도는 타이머 없이 alarm 하나로만 8시간을 재요.
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});
