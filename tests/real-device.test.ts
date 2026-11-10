/**
 * 실기기 테스트에서 안 되던 기능의 원인이 된 로직이에요.
 * 서버는 맞게 보냈는데 화면이 받지 못했거나, 받은 것을 그리지 못했거나, 반응을 보여 주지 않았던 곳들이에요.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  clientMessageSchema,
  MAX_SERVER_MESSAGE_CHARS,
  parseMessage,
  PROTOCOL_VERSION,
  serverMessageSchema,
  WARD_CAPACITY,
} from "../shared/protocol.ts";
import type { Guest, WardEvent } from "../shared/protocol.ts";
import { lampRoom, readVersion } from "../shared/ward-rules.ts";
import type { GuestRecord } from "../shared/ward-rules.ts";
import { bedApproach, BEDS, PLAYER_START } from "../shared/ward-layout.ts";
import { LAMPS_PER_WINDOW, lampPlacedText } from "../shared/offering-rules.ts";
import { inboxAckUpTo, inboxAfterAck } from "../shared/left-blessings.ts";
import {
  HUG_DENIED_TEXT,
  HUG_DISTANCE,
  HUG_LEAVING_TEXT,
  HUG_OFFLINE_TEXT,
  HUG_REPEAT_MS,
  hugMenuState,
} from "../shared/hug-rules.ts";
import { visitorMay } from "../shared/visit-rules.ts";
import { answersHello } from "../src/net/ward-client.ts";
import { rosterAction } from "../src/net/roster.ts";
import { storageWorks } from "../src/net/ward-params.ts";
import { entryHeading } from "../src/ui/entry-text.ts";

const v = PROTOCOL_VERSION;
const NOW = Date.UTC(2026, 10, 9, 3, 0, 0);

const guest = (index: number): Guest => ({
  id: `abcd${String(index).padStart(4, "0")}`,
  animal: "rabbit",
  outfit: "patient",
  nickname: "따뜻한 토끼",
  withCat: true,
  x: -12.345678901234,
  z: 3.98765432101,
  bed: index,
  lying: true,
  bench: null,
  address: "A".repeat(22),
  hugOk: true,
  sleeping: true,
});

/** 정원 30명에 잠시 끊긴 사람 6명까지 든, 가장 큰 snapshot이에요. */
function fullSnapshot(): string {
  return JSON.stringify({
    v,
    type: "snapshot",
    you: "abcd0000",
    capacity: WARD_CAPACITY,
    guests: Array.from({ length: 36 }, (_, index) => guest(index)),
    gifts: Array.from({ length: 36 }, (_, stand) => ({ stand, slot: 0, item: 3 })),
    lamps: [12, 12, 12, 12, 12, 12],
    seasonalGifts: true,
    serverNow: NOW,
    catVisits: [],
    restored: false,
    inbox: Array.from({ length: 10 }, () => ({ nickname: "따뜻한 곰", animal: "bear", kind: "gift", item: 3, at: NOW })),
    stats: { visitors: 30, blessings: 100, lamps: 72 },
    visit: null,
    greet: false,
    welcomeBack: false,
    fiveLeafUsed: null,
    morningRooms: [],
    planters: [0, 0, 0, 0, 0, 0],
  });
}

/* ───────── 1. 서로 보이기: 화면이 snapshot을 버리지 않아요 ───────── */

test("손님이 가득한 snapshot도 화면이 읽어요", () => {
  const raw = fullSnapshot();
  // 예전에는 화면이 보내는 메시지 한도(4096자)로 서버 메시지도 잘라서, 손님이 18명쯤 넘으면 통째로 버렸어요.
  assert.ok(raw.length > 4096);
  assert.equal(parseMessage(serverMessageSchema, raw), null);
  const parsed = parseMessage(serverMessageSchema, raw, MAX_SERVER_MESSAGE_CHARS);
  assert.equal(parsed?.type, "snapshot");
  assert.equal(readVersion(raw, MAX_SERVER_MESSAGE_CHARS), v);
});

test("화면이 보내는 메시지는 여전히 짧은 것만 받아요", () => {
  const long = JSON.stringify({ v, type: "walk-to", x: 1, z: 2, pad: "x".repeat(5000) });
  assert.equal(parseMessage(clientMessageSchema, long), null);
});

test("hello에 답이 오면 기다리기를 그만두고, 토큰만 오면 계속 기다려요", () => {
  for (const type of ["snapshot", "nickname-rejected", "visit-denied", "room-full", "entry-denied", "entry-failed", "version-mismatch"] as const) {
    assert.equal(answersHello(type), true, type);
  }
  assert.equal(answersHello("guest-token"), false);
  assert.equal(answersHello("event"), false);
});

test("서버가 들어오는 일을 처리하지 못하면 entry-failed로 알려요", () => {
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify({ v, type: "entry-failed" })));
});

test("join을 놓쳤어도 update가 오면 그 사람을 새로 그려요", () => {
  const known = new Set(["aaaa0001"]);
  const has = (id: string): boolean => known.has(id);
  const update = (id: string): WardEvent => ({ kind: "update", guest: { ...guest(1), id } });
  assert.equal(rosterAction(update("aaaa0001"), has, "me000000"), "update");
  assert.equal(rosterAction(update("bbbb0002"), has, "me000000"), "add");
  // 나 자신은 그리지 않아요.
  assert.equal(rosterAction(update("me000000"), has, "me000000"), "ignore");
  assert.equal(rosterAction({ kind: "join", guest: { ...guest(1), id: "cccc0003" } }, has, "me000000"), "add");
  assert.equal(rosterAction({ kind: "leave", id: "aaaa0001" }, has, null), "remove");
  assert.equal(rosterAction({ kind: "leave", id: "zzzz0009" }, has, null), "ignore");
});

test("입장·이동·눕기·일어나기·평안·목례는 아는 사람에게만 그려요", () => {
  const has = (id: string): boolean => id === "aaaa0001";
  const events: WardEvent[] = [
    { kind: "walk", id: "aaaa0001", x: 0, z: 0 },
    { kind: "lie", id: "aaaa0001", bedId: 3 },
    { kind: "get-up", id: "aaaa0001" },
    { kind: "bless", id: "aaaa0001", bedId: 3, targetId: null },
    { kind: "bow", id: "aaaa0001", phrase: 0 },
  ];
  for (const event of events) assert.equal(rosterAction(event, has, null), "apply", event.kind);
  // 선물·불빛·퇴원 안내는 화면이 따로 그려요.
  assert.equal(rosterAction({ kind: "gift", id: "aaaa0001", gift: { stand: 1, slot: 0, item: 4 } }, has, null), "ignore");
  assert.equal(rosterAction({ kind: "lamp", id: "aaaa0001", room: 0, count: 1 }, has, null), "ignore");
});

/* ───────── 2. 같은 사람으로 알아보기 ───────── */

test("저장된 모습과 토큰이 있으면 돌아왔다고 맞아요", () => {
  const back = entryHeading({ returning: true, nickname: "따뜻한 곰" });
  assert.equal(back.title, "돌아왔네요, 따뜻한 곰님");
  assert.equal(back.enter, "이대로 들어갈게요");
  const first = entryHeading({ returning: false, nickname: "따뜻한 곰" });
  assert.equal(first.title, "어떤 모습으로 머물까요?");
  assert.equal(first.enter, "병동에 들어갈게요");
  // 문병 링크로 왔으면 문병 제목이 먼저예요.
  assert.equal(entryHeading({ returning: true, nickname: "곰", visitTitle: "토끼님에게 문병 왔어요" }).enter, "문병 갈게요");
});

test("저장소를 쓸 수 없는 브라우저를 알아봐요", () => {
  const map = new Map<string, string>();
  const working = {
    setItem: (key: string, value: string) => void map.set(key, value),
    getItem: (key: string) => map.get(key) ?? null,
    removeItem: (key: string) => void map.delete(key),
  };
  assert.equal(storageWorks(working), true);
  assert.equal(map.size, 0);
  const blocked = {
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    getItem: () => null,
    removeItem: () => undefined,
  };
  assert.equal(storageWorks(blocked), false);
  assert.equal(storageWorks(null), false);
});

test("없는 동안 도착한 평안은 화면이 받았다고 알린 데까지만 지워요", () => {
  const cards = [{ at: 100 }, { at: 300 }, { at: 200 }];
  assert.equal(inboxAckUpTo(cards), 300);
  assert.equal(inboxAckUpTo([]), null);
  // 받았다고 알리기 전에 새로 도착한 것은 남아서 다음에 전해져요.
  assert.deepEqual(inboxAfterAck([...cards, { at: 400 }], 300), [{ at: 400 }]);
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v, type: "inbox-ack", upTo: 300 })));
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ v, type: "inbox-ack" })), null);
  // 문병객도 받은 평안을 확인할 수 있어요.
  assert.equal(visitorMay("inbox-ack"), true);
});

/* ───────── 4. 창가에 불빛 ───────── */

const record = (x: number, z: number): GuestRecord => ({
  id: "abcd1234",
  guestId: "g",
  animal: "rabbit",
  outfit: "patient",
  nickname: "따뜻한 토끼",
  withCat: false,
  x,
  z,
  bed: null,
  address: "A".repeat(22),
  lyingSince: null,
  lastAction: {},
});

test("침대에 누운 채로 불빛을 놓으면 그 병실 창가에 놓여요", () => {
  BEDS.forEach((bed, bedId) => {
    // 서버는 누운 사람을 침대 곁 자리에 있는 것으로 봐요.
    const spot = bedApproach(bed);
    const result = lampRoom({ ...record(spot.x, spot.z), bed: bedId }, [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(result, { room: bed.roomIndex });
  });
});

test("복도에서는 불빛을 놓지 않고 이유를 알려요", () => {
  assert.deepEqual(lampRoom(record(PLAYER_START.x, PLAYER_START.z), [0, 0, 0, 0, 0, 0]), { denied: "not-in-room" });
  const spot = bedApproach(BEDS[0]);
  const full = [0, 0, 0, 0, 0, 0];
  full[BEDS[0].roomIndex] = LAMPS_PER_WINDOW;
  assert.deepEqual(lampRoom(record(spot.x, spot.z), full), { denied: "lamp-full" });
});

test("내가 놓은 불빛은 몇 번째인지 알려 줘요", () => {
  assert.equal(lampPlacedText(3), "창가에 불빛을 놓았어요. 오늘 이 병실에 3개예요.");
});

/* ───────── 5. 안아 주기 ───────── */

const near = { x: 0, z: 0 };
const base = {
  online: true,
  leaving: false,
  me: near,
  target: { x: 1, z: 1, hugOk: true },
  lastSentAt: null,
  nowMs: NOW,
};

test("2m 안의 받을 수 있는 분이면 안아 주기를 누를 수 있어요", () => {
  assert.deepEqual(hugMenuState(base), { enabled: true });
  assert.deepEqual(hugMenuState({ ...base, target: { x: HUG_DISTANCE, z: 0, hugOk: true } }), { enabled: true });
});

test("멀거나, 쉬는 중이거나, 10분이 안 지났으면 버튼을 끄고 이유를 보여 줘요", () => {
  assert.deepEqual(hugMenuState({ ...base, target: { x: 2.5, z: 0, hugOk: true } }), {
    enabled: false,
    reason: HUG_DENIED_TEXT["too-far"],
  });
  // 수면 모드이거나 '요청 받지 않기'면 서버가 hugOk를 false로 보내요.
  assert.deepEqual(hugMenuState({ ...base, target: { x: 1, z: 0, hugOk: false } }), {
    enabled: false,
    reason: HUG_DENIED_TEXT.unavailable,
  });
  assert.deepEqual(hugMenuState({ ...base, lastSentAt: NOW - HUG_REPEAT_MS + 1000 }), {
    enabled: false,
    reason: HUG_DENIED_TEXT["too-soon"],
  });
  assert.deepEqual(hugMenuState({ ...base, lastSentAt: NOW - HUG_REPEAT_MS }), { enabled: true });
  assert.deepEqual(hugMenuState({ ...base, online: false }), { enabled: false, reason: HUG_OFFLINE_TEXT });
  assert.deepEqual(hugMenuState({ ...base, leaving: true }), { enabled: false, reason: HUG_LEAVING_TEXT });
});
