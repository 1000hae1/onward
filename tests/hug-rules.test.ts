import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkHugAnswer,
  checkHugRequest,
  HUG_ANSWER_MS,
  HUG_REPEAT_MS,
  hugOfferText,
  hugStillPossible,
} from "../shared/hug-rules.ts";
import { hugAvailable, toPublic } from "../shared/ward-rules.ts";
import type { GuestRecord } from "../shared/ward-rules.ts";

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

const NOW = 1_000_000_000;

test("2m 안에 있으면 안아 주기를 요청할 수 있어요", () => {
  const a = person("aaaaaaaa");
  assert.deepEqual(checkHugRequest(a, person("bbbbbbbb", { x: 1.2, z: 1.2 }), null, NOW), { ok: true });
  assert.deepEqual(checkHugRequest(a, person("bbbbbbbb", { x: 2, z: 0 }), null, NOW), { ok: true });
});

test("2m보다 멀면 받지 않아요", () => {
  const a = person("aaaaaaaa");
  assert.deepEqual(checkHugRequest(a, person("bbbbbbbb", { x: 1.5, z: 1.5 }), null, NOW), { ok: false, reason: "too-far" });
});

test("같은 상대에게는 10분에 한 번이에요", () => {
  const a = person("aaaaaaaa");
  const b = person("bbbbbbbb", { x: 1 });
  assert.deepEqual(checkHugRequest(a, b, NOW - 60_000, NOW), { ok: false, reason: "too-soon" });
  assert.deepEqual(checkHugRequest(a, b, NOW - HUG_REPEAT_MS + 1, NOW), { ok: false, reason: "too-soon" });
  assert.deepEqual(checkHugRequest(a, b, NOW - HUG_REPEAT_MS, NOW), { ok: true });
});

test("수면 모드이거나 요청 받지 않기를 켠 사람에게는 보낼 수 없어요", () => {
  const a = person("aaaaaaaa");
  assert.deepEqual(checkHugRequest(a, person("bbbbbbbb", { sleeping: true }), null, NOW), { ok: false, reason: "unavailable" });
  assert.deepEqual(checkHugRequest(a, person("bbbbbbbb", { hugsOff: true }), null, NOW), { ok: false, reason: "unavailable" });
  assert.deepEqual(
    checkHugRequest(a, person("bbbbbbbb", { discharge: { at: NOW, from: [] } }), null, NOW),
    { ok: false, reason: "unavailable" },
  );
});

test("메뉴에 보일지는 hugOk 하나로만 알려서 잠들었는지 껐는지는 남이 몰라요", () => {
  assert.equal(toPublic(person("aaaaaaaa")).hugOk, true);
  assert.equal(toPublic(person("aaaaaaaa", { sleeping: true })).hugOk, false);
  assert.equal(toPublic(person("aaaaaaaa", { hugsOff: true })).hugOk, false);
  assert.equal(JSON.stringify(toPublic(person("aaaaaaaa", { sleeping: true }))).includes("sleeping"), false);
  assert.equal(hugAvailable(person("aaaaaaaa", { hugsOff: false, sleeping: false })), true);
});

test("나 자신이나 없는 사람은 안을 수 없어요", () => {
  const a = person("aaaaaaaa");
  assert.deepEqual(checkHugRequest(a, null, null, NOW), { ok: false, reason: "no-target" });
  assert.deepEqual(checkHugRequest(a, a, null, NOW), { ok: false, reason: "no-target" });
});

test("문병객은 주인만 안아 줄 수 있어요", () => {
  const owner = person("bbbbbbbb", { x: 1 });
  const stranger = person("cccccccc", { x: 1 });
  const visitor = person("aaaaaaaa", {
    outfit: "visitor",
    visit: { owner: "key-bbbbbbbb", bed: 3, session: "s", ownerNickname: "따뜻한 곰" },
  });
  assert.deepEqual(checkHugRequest(visitor, owner, null, NOW), { ok: true });
  assert.deepEqual(checkHugRequest(visitor, stranger, null, NOW), { ok: false, reason: "no-target" });
});

test("답은 받는 사람 본인이 10초 안에 해야 받아요", () => {
  const pending = { id: "abcdefabcdef", fromId: "aaaaaaaa", fromKey: "key-a", toId: "bbbbbbbb", at: NOW };
  assert.equal(checkHugAnswer(pending, "bbbbbbbb", NOW + 3000), "ok");
  assert.equal(checkHugAnswer(pending, "cccccccc", NOW + 3000), "unknown");
  assert.equal(checkHugAnswer(null, "bbbbbbbb", NOW), "unknown");
  // 10초가 지나면 조용히 버려요. 보낸 사람에게는 아무것도 보내지 않아요.
  assert.equal(checkHugAnswer(pending, "bbbbbbbb", NOW + HUG_ANSWER_MS + 5000), "expired");
});

test("수락한 사이 멀어지면 안지 않아요", () => {
  const a = person("aaaaaaaa");
  assert.equal(hugStillPossible(a, person("bbbbbbbb", { x: 1 })), true);
  assert.equal(hugStillPossible(a, person("bbbbbbbb", { x: 5 })), false);
  assert.equal(hugStillPossible(a, null), false);
});

test("받는 사람에게 보이는 문장은 해요체예요", () => {
  assert.equal(hugOfferText("따뜻한 곰"), "따뜻한 곰님이 안아 주려고 해요");
});

test("안아 주는 자리는 서 있으면 상대 앞 0.6m, 누워 있으면 침대 곁이에요", async () => {
  const { hugSpot, HUG_GAP } = await import("../shared/hug-rules.ts");
  const { bedApproach, BEDS, ROOMS } = await import("../shared/ward-layout.ts");
  const room = ROOMS[0];
  const spot = hugSpot({ x: room.x + 1.5, z: room.z }, { x: room.x, z: room.z, bed: null });
  assert.ok(Math.abs(Math.hypot(spot.x - room.x, spot.z - room.z) - HUG_GAP) < 1e-6);
  const approach = bedApproach(BEDS[2]);
  const bedSpot = hugSpot({ x: 0, z: 0 }, { x: approach.x, z: approach.z, bed: 2 });
  assert.ok(Math.hypot(bedSpot.x - approach.x, bedSpot.z - approach.z) < 0.3);
});
