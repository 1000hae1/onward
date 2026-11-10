import assert from "node:assert/strict";
import { test } from "vitest";
import { clientMessageSchema, parseMessage, serverMessageSchema, WARD_CAPACITY } from "../shared/protocol.ts";
import type { VerifiedHello } from "../shared/ward-rules.ts";
import { BEDS, bedApproach, PLAYER_START, ROOMS, WALK_AREAS } from "../shared/ward-layout.ts";
import {
  actionReady,
  admit,
  alarmToSet,
  catVisits,
  CAT_VISIT_AFTER_MS,
  changedVisits,
  expireAway,
  GRACE_MS,
  nextInstance,
  readVersion,
  toAway,
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

const hello = (over: Partial<VerifiedHello> = {}): VerifiedHello => ({
  v: 10,
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
  address: "A".repeat(22),
  lyingSince: null,
  lastAction: {},
  ...over,
});

test("메시지는 v=8이고 형식이 맞을 때만 읽어요", () => {
  const good = JSON.stringify({ v: 10, type: "walk-to", x: 1, z: 2 });
  assert.deepEqual(parseMessage(clientMessageSchema, good), { v: 10, type: "walk-to", x: 1, z: 2 });
  for (const bad of [
    // 예전 버전(v1) 메시지는 읽지 않아요.
    JSON.stringify({ v: 1, type: "walk-to", x: 1, z: 2 }),
    JSON.stringify({ type: "walk-to", x: 1, z: 2 }),
    JSON.stringify({ v: 10, type: "walk-to", x: "1", z: 2 }),
    JSON.stringify({ v: 10, type: "fly" }),
    JSON.stringify({ v: 10, type: "bow", phrase: 6 }),
    // 예전 버전(v3) 메시지도 읽지 않아요.
    JSON.stringify({ v: 4, type: "walk-to", x: 1, z: 2 }),
    JSON.stringify({ v: 10, type: "gift", item: 0 }),
    JSON.stringify({ v: 10, type: "gift", item: 0, bedId: 1, targetId: "abcd1234" }),
    JSON.stringify({ v: 10, type: "lie-down", bedId: 36 }),
    "{",
    "ping",
    "x".repeat(5000),
  ]) {
    assert.equal(parseMessage(clientMessageSchema, bad), null, bad.slice(0, 60));
  }
  assert.equal(parseMessage(clientMessageSchema, new ArrayBuffer(4)), null);
});

test("bless와 gift는 사람이나 침대 가운데 하나만 받아요", () => {
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v: 10, type: "bless", bedId: 3 })));
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v: 10, type: "bless", targetId: "abcd1234" })));
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ v: 10, type: "bless" })), null);
});

test("서버 메시지도 같은 방법으로 검사해요", () => {
  const event = JSON.stringify({ v: 10, type: "event", event: { kind: "bow", id: "abcd1234", phrase: 2 } });
  assert.ok(parseMessage(serverMessageSchema, event));
  assert.equal(parseMessage(serverMessageSchema, JSON.stringify({ v: 10, type: "event", event: { kind: "bow", id: "x", phrase: 2 } })), null);
});

test("닉네임이 규칙에 어긋나면 들어오지 못해요", () => {
  assert.deepEqual(admit([], 0, hello({ nickname: "곰" }), WARD_CAPACITY, "abcd1234"), { kind: "rejected", problem: "short" });
  assert.deepEqual(admit([], 0, hello({ nickname: "관리자곰" }), WARD_CAPACITY, "abcd1234"), { kind: "rejected", problem: "banned" });
  assert.deepEqual(admit([], 0, hello({ nickname: "곰0101" }), WARD_CAPACITY, "abcd1234"), { kind: "rejected", problem: "digits" });
});

test("정원이 차면 들어오지 못해요", () => {
  const full = Array.from({ length: WARD_CAPACITY }, (_, index) => record(`g${String(index).padStart(7, "0")}`));
  assert.deepEqual(admit(full, 0, hello(), WARD_CAPACITY, "abcd1234"), { kind: "full" });
  const almost = full.slice(1);
  assert.equal(admit(almost, 0, hello(), WARD_CAPACITY, "abcd1234").kind, "admitted");
});

test("같은 guestId로 다시 들어오면 정원이 차 있어도 예전 연결과 바꿔요", () => {
  const full = Array.from({ length: WARD_CAPACITY }, (_, index) => record(`g${String(index).padStart(7, "0")}`));
  const again = admit(full, 0, hello({ guestId: full[3].guestId }), WARD_CAPACITY, "abcd1234");
  assert.equal(again.kind, "admitted");
  if (again.kind === "admitted") assert.equal(again.replaces, full[3].id);
});

test("들어오면 앞마당에서 시작하고, 남에게는 guestId를 보이지 않아요", () => {
  const result = admit([], 0, hello({ nickname: "  졸린   수달 " }), WARD_CAPACITY, "abcd1234");
  assert.equal(result.kind, "admitted");
  if (result.kind !== "admitted") return;
  assert.equal(result.record.nickname, "졸린 수달");
  assert.deepEqual([result.record.x, result.record.z], [PLAYER_START.x, PLAYER_START.z]);
  const shown = toPublic(result.record);
  assert.equal("guestId" in shown, false);
  assert.equal(JSON.stringify(shown).includes(result.record.guestId), false);
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

test("끊긴 지 30초 안에 돌아오면 침대와 자리를 그대로 돌려받아요", () => {
  const lying = record("aaaaaaaa", { bed: 7, lyingSince: 500, x: 1, z: 2 });
  const away = toAway(lying, "hash-a", 10_000);
  assert.equal(away.until, 10_000 + GRACE_MS);
  // 해시만 남기고 guestId는 지워요.
  assert.equal(away.record.guestId, "");
  const back = admit([], 0, hello({ guestId: "guest-aaaa-0001" }), WARD_CAPACITY, "new00000", away.record);
  assert.equal(back.kind, "admitted");
  if (back.kind !== "admitted") return;
  assert.equal(back.restored, true);
  assert.equal(back.record.id, "aaaaaaaa");
  assert.equal(back.record.bed, 7);
  assert.equal(back.record.lyingSince, 500);
  assert.deepEqual([back.record.x, back.record.z], [1, 2]);
  assert.equal(back.record.guestId, "guest-aaaa-0001");
});

test("돌아온 사람은 정원이 차 있어도 맡아 둔 자리로 들어와요", () => {
  const full = Array.from({ length: WARD_CAPACITY - 1 }, (_, index) => record(`g${String(index).padStart(7, "0")}`));
  const away = toAway(record("aaaaaaaa"), "hash-a", 0);
  // 맡아 둔 자리도 정원에 들어가요. 새 사람은 못 들어와요.
  assert.equal(admit(full, 1, hello({ guestId: "guest-new-0001" }), WARD_CAPACITY, "x0000000").kind, "full");
  assert.equal(admit(full, 0, hello(), WARD_CAPACITY, "x0000000", away.record).kind, "admitted");
});

test("유예가 끝난 사람만 내보내고, 다음 alarm은 남은 사람 가운데 가장 이른 때예요", () => {
  const a = toAway(record("aaaaaaaa"), "a", 0);
  const b = toAway(record("bbbbbbbb"), "b", 10_000);
  const first = expireAway([a, b], GRACE_MS);
  assert.deepEqual(first.expired.map((guest) => guest.key), ["a"]);
  assert.equal(first.nextAlarm, 10_000 + GRACE_MS);
  const second = expireAway(first.kept, 10_000 + GRACE_MS);
  assert.equal(second.kept.length, 0);
  // 맡아 둔 사람이 없으면 alarm을 다시 맞추지 않아요.
  assert.equal(second.nextAlarm, null);
});

test("alarm은 더 이른 것이 필요할 때만 맞춰요", () => {
  assert.equal(alarmToSet(null, 5000), 5000);
  assert.equal(alarmToSet(3000, 5000), null);
  assert.equal(alarmToSet(8000, 5000), 5000);
  assert.equal(alarmToSet(3000, null), null);
});

test("정원이 차면 다음 병실을 알려 줘요", () => {
  assert.equal(nextInstance(1, 20), 2);
  assert.equal(nextInstance(20, 20), 1);
});

test("메시지의 버전만 따로 읽어요", () => {
  assert.equal(readVersion(JSON.stringify({ v: 2, type: "anything" })), 2);
  assert.equal(readVersion(JSON.stringify({ v: 1 })), 1);
  assert.equal(readVersion("ping"), null);
  assert.equal(readVersion("{"), null);
  assert.equal(readVersion(JSON.stringify({ type: "x" })), null);
  assert.equal(readVersion(new ArrayBuffer(2)), null);
});

test("병실에 혼자 누워 있으면 고양이가 2분 뒤에 찾아와요", () => {
  const bed = BEDS.findIndex((candidate) => candidate.roomIndex === 2);
  const spot = bedApproach(BEDS[bed]);
  const alone = record("aaaaaaaa", { bed, lyingSince: 1000, x: spot.x, z: spot.z });
  assert.deepEqual(catVisits([alone]), [{ room: 2, bed, at: 1000 + CAT_VISIT_AFTER_MS }]);
  // 같은 병실에 다른 사람이 있으면 찾아오지 않아요.
  const friend = record("bbbbbbbb", { x: ROOMS[2].x, z: ROOMS[2].z });
  assert.deepEqual(catVisits([alone, friend]), []);
  // 다른 병실에 있는 사람은 상관없어요.
  const elsewhere = record("cccccccc", { x: ROOMS[4].x, z: ROOMS[4].z });
  assert.equal(catVisits([alone, elsewhere]).length, 1);
  // 누워 있지 않으면 찾아오지 않아요.
  assert.deepEqual(catVisits([record("dddddddd", { x: spot.x, z: spot.z })]), []);
});

test("고양이 방문은 바뀐 병실만 알려요", () => {
  const one = { room: 2, bed: 13, at: 5000 };
  assert.deepEqual(changedVisits([one], [one]), []);
  assert.deepEqual(changedVisits([], [one]), [{ room: 2, visit: one }]);
  assert.deepEqual(changedVisits([one], []), [{ room: 2, visit: null }]);
  assert.deepEqual(changedVisits([one], [{ ...one, at: 9000 }]), [{ room: 2, visit: { ...one, at: 9000 } }]);
});

test("다른 사람에게 보내는 정보에는 평안 주소가 있고 guestId는 없어요", () => {
  const guest = record("aaaaaaaa", { guestId: "guest-secret-0001", address: "Q".repeat(22) });
  const shown = toPublic(guest);
  assert.equal(shown.address, "Q".repeat(22));
  assert.equal(JSON.stringify(shown).includes("guest-secret-0001"), false);
  assert.deepEqual(Object.keys(shown).sort(), ["address", "animal", "bed", "bench", "hugOk", "id", "lying", "nickname", "outfit", "sleeping", "withCat", "x", "z"]);
});
