import assert from "node:assert/strict";
import { test } from "node:test";
import { clientMessageSchema, parseMessage, serverMessageSchema, WARD_CAPACITY } from "../shared/protocol.ts";
import type { HelloMessage } from "../shared/protocol.ts";
import { BEDS, bedApproach, PLAYER_START, ROOMS, WALK_AREAS } from "../shared/ward-layout.ts";
import {
  actionReady,
  admit,
  claimBed,
  clampToWalkable,
  giftAllowedNow,
  giftSlot,
  koreanDay,
  lampRoom,
  resolveTarget,
  seasonalGiftsAllowed,
  toPublic,
  updateProfile,
} from "../shared/ward-rules.ts";
import type { GuestRecord } from "../shared/ward-rules.ts";

const hello = (over: Partial<HelloMessage> = {}): HelloMessage => ({
  v: 1,
  type: "hello",
  guestId: "guest-aaaa-0001",
  animal: "otter",
  outfit: "patient",
  nickname: "졸린 수달",
  withCat: false,
  ...over,
});

const record = (id: string, over: Partial<GuestRecord> = {}): GuestRecord => ({
  id,
  guestId: `guest-${id}`,
  animal: "bear",
  outfit: "patient",
  nickname: "따뜻한 곰",
  withCat: false,
  x: PLAYER_START.x,
  z: PLAYER_START.z,
  bed: null,
  lastAction: {},
  ...over,
});

test("메시지는 v=1이고 형식이 맞을 때만 읽어요", () => {
  const good = JSON.stringify({ v: 1, type: "walk-to", x: 1, z: 2 });
  assert.deepEqual(parseMessage(clientMessageSchema, good), { v: 1, type: "walk-to", x: 1, z: 2 });
  for (const bad of [
    JSON.stringify({ v: 2, type: "walk-to", x: 1, z: 2 }),
    JSON.stringify({ type: "walk-to", x: 1, z: 2 }),
    JSON.stringify({ v: 1, type: "walk-to", x: "1", z: 2 }),
    JSON.stringify({ v: 1, type: "fly" }),
    JSON.stringify({ v: 1, type: "bow", phrase: 5 }),
    JSON.stringify({ v: 1, type: "gift", item: 0 }),
    JSON.stringify({ v: 1, type: "gift", item: 0, bedId: 1, targetId: "abcd1234" }),
    JSON.stringify({ v: 1, type: "lie-down", bedId: 36 }),
    "{",
    "ping",
    "x".repeat(5000),
  ]) {
    assert.equal(parseMessage(clientMessageSchema, bad), null, bad.slice(0, 60));
  }
  assert.equal(parseMessage(clientMessageSchema, new ArrayBuffer(4)), null);
});

test("bless와 gift는 사람이나 침대 가운데 하나만 받아요", () => {
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v: 1, type: "bless", bedId: 3 })));
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v: 1, type: "bless", targetId: "abcd1234" })));
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ v: 1, type: "bless" })), null);
});

test("서버 메시지도 같은 방법으로 검사해요", () => {
  const event = JSON.stringify({ v: 1, type: "event", event: { kind: "bow", id: "abcd1234", phrase: 2 } });
  assert.ok(parseMessage(serverMessageSchema, event));
  assert.equal(parseMessage(serverMessageSchema, JSON.stringify({ v: 1, type: "event", event: { kind: "bow", id: "x", phrase: 2 } })), null);
});

test("닉네임이 규칙에 어긋나면 들어오지 못해요", () => {
  assert.deepEqual(admit([], hello({ nickname: "곰" }), WARD_CAPACITY, "abcd1234"), { kind: "rejected", problem: "short" });
  assert.deepEqual(admit([], hello({ nickname: "관리자곰" }), WARD_CAPACITY, "abcd1234"), { kind: "rejected", problem: "banned" });
  assert.deepEqual(admit([], hello({ nickname: "곰0101" }), WARD_CAPACITY, "abcd1234"), { kind: "rejected", problem: "digits" });
});

test("정원이 차면 들어오지 못해요", () => {
  const full = Array.from({ length: WARD_CAPACITY }, (_, index) => record(`g${String(index).padStart(7, "0")}`));
  assert.deepEqual(admit(full, hello(), WARD_CAPACITY, "abcd1234"), { kind: "full" });
  const almost = full.slice(1);
  assert.equal(admit(almost, hello(), WARD_CAPACITY, "abcd1234").kind, "admitted");
});

test("같은 guestId로 다시 들어오면 정원이 차 있어도 예전 연결과 바꿔요", () => {
  const full = Array.from({ length: WARD_CAPACITY }, (_, index) => record(`g${String(index).padStart(7, "0")}`));
  const again = admit(full, hello({ guestId: full[3].guestId }), WARD_CAPACITY, "abcd1234");
  assert.equal(again.kind, "admitted");
  if (again.kind === "admitted") assert.equal(again.replaces, full[3].id);
});

test("들어오면 앞마당에서 시작하고, 남에게는 guestId를 보이지 않아요", () => {
  const result = admit([], hello({ nickname: "  졸린   수달 " }), WARD_CAPACITY, "abcd1234");
  assert.equal(result.kind, "admitted");
  if (result.kind !== "admitted") return;
  assert.equal(result.record.nickname, "졸린 수달");
  assert.deepEqual([result.record.x, result.record.z], [PLAYER_START.x, PLAYER_START.z]);
  const shown = toPublic(result.record);
  assert.equal("guestId" in shown, false);
  assert.equal(JSON.stringify(shown).includes(result.record.guestId), false);
});

test("침대는 먼저 처리된 한 사람만 가져가요", () => {
  const a = record("aaaaaaaa");
  const b = record("bbbbbbbb");
  const first = claimBed([a, b], a, 5);
  assert.equal(first.granted, true);
  const guests = [first.record, b];
  const second = claimBed(guests, b, 5);
  assert.equal(second.granted, false);
  assert.equal(second.record.bed, null);
  // 같은 사람이 다시 눌러도 그대로예요.
  assert.equal(claimBed(guests, first.record, 5).granted, true);
});

test("다른 침대를 받으면 예전 침대는 비고, 문병객은 눕지 못해요", () => {
  const a = record("aaaaaaaa", { bed: 1 });
  const moved = claimBed([a], a, 2);
  assert.equal(moved.record.bed, 2);
  const b = record("bbbbbbbb");
  assert.equal(claimBed([moved.record, b], b, 1).granted, true);
  const visitor = record("cccccccc", { outfit: "visitor" });
  assert.equal(claimBed([visitor], visitor, 7).granted, false);
});

test("문병객으로 바꾸면 침대를 비워요", () => {
  const lying = record("aaaaaaaa", { bed: 4 });
  const result = updateProfile(lying, hello({ outfit: "visitor" }));
  assert.equal(result.kind, "updated");
  if (result.kind === "updated") assert.equal(result.record.bed, null);
  assert.equal(updateProfile(lying, hello({ nickname: "a@b.c" })).kind, "rejected");
});

test("걸을 수 없는 곳은 가장 가까운 걸을 수 있는 자리로 고쳐요", () => {
  assert.deepEqual(clampToWalkable(0, 30), { x: 0, z: 30 });
  const far = clampToWalkable(500, 30);
  assert.ok(WALK_AREAS.some((a) => far.x >= a.minX && far.x <= a.maxX && far.z >= a.minZ && far.z <= a.maxZ));
  // 정말 가장 가까운 자리인지 걸을 수 있는 영역의 모든 모서리와 견줘 봐요.
  const distance = Math.hypot(far.x - 500, far.z - 30);
  for (const area of WALK_AREAS) {
    for (const [x, z] of [[area.minX, area.minZ], [area.maxX, area.minZ], [area.minX, area.maxZ], [area.maxX, area.maxZ]]) {
      assert.ok(distance <= Math.hypot(x - 500, z - 30) + 1e-9);
    }
  }
  const roof = clampToWalkable(0, -200);
  assert.ok(WALK_AREAS.some((a) => roof.x >= a.minX && roof.x <= a.maxX && roof.z >= a.minZ && roof.z <= a.maxZ));
  for (const bed of BEDS) {
    const spot = bedApproach(bed);
    assert.deepEqual(clampToWalkable(spot.x, spot.z), spot);
  }
});

test("귤·홍시·호빵은 한국 시간 11월~2월에만 놓을 수 있어요", () => {
  const winter = new Date("2026-11-07T03:00:00Z");
  const spring = new Date("2026-03-15T03:00:00Z");
  // 한국은 3월 1일이지만 UTC로는 아직 2월 말이에요.
  const edge = new Date("2026-02-28T16:00:00Z");
  for (const item of [0, 1]) {
    assert.equal(giftAllowedNow(item, spring), true);
    assert.equal(giftAllowedNow(item, winter), true);
  }
  for (const item of [2, 3, 4]) {
    assert.equal(giftAllowedNow(item, winter), true);
    assert.equal(giftAllowedNow(item, spring), false);
    assert.equal(giftAllowedNow(item, edge), false);
  }
  assert.equal(seasonalGiftsAllowed(new Date("2027-01-10T00:00:00Z")), true);
  assert.equal(seasonalGiftsAllowed(new Date("2026-10-31T14:59:00Z")), false);
  assert.equal(seasonalGiftsAllowed(new Date("2026-10-31T15:00:00Z")), true);
});

test("하루는 한국 시간으로 나눠요", () => {
  assert.equal(koreanDay(new Date("2026-11-06T14:59:59Z")), "2026-11-06");
  assert.equal(koreanDay(new Date("2026-11-06T15:00:00Z")), "2026-11-07");
});

test("같은 동작은 1초 간격을 둬요", () => {
  const guest = record("aaaaaaaa", { lastAction: { bow: 1000 } });
  assert.equal(actionReady(guest, "bow", 1500), false);
  assert.equal(actionReady(guest, "bow", 2000), true);
  assert.equal(actionReady(guest, "gift", 1500), true);
});

test("사람을 고르면 그 사람이 누운 침대로 보내요", () => {
  const lying = record("aaaaaaaa", { bed: 9 });
  const walking = record("bbbbbbbb");
  assert.deepEqual(resolveTarget([lying], { targetId: "aaaaaaaa" }), { bedId: 9, targetId: "aaaaaaaa" });
  assert.deepEqual(resolveTarget([walking], { targetId: "bbbbbbbb" }), { bedId: null, targetId: "bbbbbbbb" });
  assert.equal(resolveTarget([], { targetId: "zzzzzzzz" }), null);
  assert.deepEqual(resolveTarget([], { bedId: 3 }), { bedId: 3, targetId: null });
});

test("선물은 빈 칸부터, 차면 가장 오래된 칸에 놓아요", () => {
  assert.equal(giftSlot([]), 0);
  assert.equal(giftSlot([{ slot: 0, order: 1, item: 0 }]), 1);
  assert.equal(giftSlot([{ slot: 0, order: 9, item: 0 }, { slot: 1, order: 3, item: 1 }]), 1);
});

test("불빛은 병실 안에서만, 창마다 12개까지 놓아요", () => {
  const room = ROOMS[2];
  const inside = record("aaaaaaaa", { x: room.x, z: room.z });
  assert.deepEqual(lampRoom(inside, [0, 0, 0, 0, 0, 0]), { room: 2 });
  assert.deepEqual(lampRoom(inside, [0, 0, 12, 0, 0, 0]), { denied: "lamp-full" });
  assert.deepEqual(lampRoom(record("bbbbbbbb"), [0, 0, 0, 0, 0, 0]), { denied: "not-in-room" });
});
