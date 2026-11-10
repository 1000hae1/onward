import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BENCH_FULL_TEXT,
  benchTap,
  isSeat,
  leaveSeat,
  SEAT_TAKEN_TEXT,
  seatOf,
  seatOwner,
  takeSeat,
} from "../shared/bench-rules.ts";
import { claimBed, lieDown } from "../shared/bed-rules.ts";
import { startDischarge } from "../shared/discharge-rules.ts";
import { clientMessageSchema, parseMessage, PROTOCOL_VERSION, serverMessageSchema } from "../shared/protocol.ts";
import { visitorMay } from "../shared/visit-rules.ts";
import {
  BENCH_BOXES,
  BENCH_SEAT_COUNT,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_START,
  seatApproach,
  seatBench,
  seatRest,
  seatYaw,
  WALK_AREAS,
  YARD,
  YARD_BENCHES,
} from "../shared/ward-layout.ts";
import { admit, clampToWalkable, expireAway, GRACE_MS, toAway, toPublic, updateProfile } from "../shared/ward-rules.ts";
import type { GuestRecord, VerifiedHello } from "../shared/ward-rules.ts";
import { createNavGrid } from "../src/ward/movement.ts";
import { composePose, createPose } from "../src/avatar/pose.ts";
import {
  arrivedAtSeat,
  headToSeat,
  isSeated,
  NO_SEAT,
  rise,
  seatAllowsGesture,
  seatInUse,
  seatProgress,
  tickSeat,
} from "../src/ward/seat-flow.ts";
import { BANNED_WORDS } from "../shared/bannedWords.ts";

const record = (id: string, over: Partial<GuestRecord> = {}): GuestRecord => ({
  id,
  guestId: `guest-${id}`,
  animal: "rabbit",
  outfit: "patient",
  nickname: "포근한 토끼",
  withCat: false,
  x: PLAYER_START.x,
  z: PLAYER_START.z,
  bed: null,
  address: "A".repeat(22),
  lyingSince: null,
  lastAction: {},
  ...over,
});

const hello = (over: Partial<VerifiedHello> = {}): VerifiedHello => ({
  v: PROTOCOL_VERSION,
  type: "hello",
  guestId: "guest-aaaaaaaa",
  animal: "rabbit",
  outfit: "patient",
  nickname: "포근한 토끼",
  withCat: false,
  ...over,
});

const granted = (result: ReturnType<typeof takeSeat<GuestRecord>>): GuestRecord => {
  assert.equal(result.granted, true);
  return result.record;
};

/* ───────── 자리 배치 ───────── */

test("앞마당 벤치 넷에 두 자리씩, 모두 여덟 자리예요", () => {
  assert.equal(YARD_BENCHES.length, 4);
  assert.equal(BENCH_SEAT_COUNT, 8);
  for (let seat = 0; seat < BENCH_SEAT_COUNT; seat++) {
    const rest = seatRest(seat);
    assert.ok(rest.x > YARD.minX && rest.x < YARD.maxX && rest.z > YARD.minZ && rest.z < YARD.maxZ);
  }
  // 같은 벤치의 두 자리는 서로 떨어져 있어요.
  assert.ok(Math.hypot(seatRest(0).x - seatRest(1).x, seatRest(0).z - seatRest(1).z) > 0.6);
});

test("앉으면 산책로 가운데 쪽을 바라봐요", () => {
  for (let seat = 0; seat < BENCH_SEAT_COUNT; seat++) {
    const bench = YARD_BENCHES[seatBench(seat)];
    const yaw = seatYaw(seat);
    // 바라보는 방향의 x 성분이 벤치에서 가운데(x=0)를 향해요.
    assert.ok(Math.sin(yaw) * -Math.sign(bench.x) > 0.9);
    // 앞자리는 벤치보다 가운데 쪽이에요.
    assert.ok(Math.abs(seatApproach(seat).x) < Math.abs(bench.x));
  }
});

test("벤치는 지나갈 수 없고, 벤치 앞자리는 걸을 수 있어요", () => {
  const inside = (point: { x: number; z: number }, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean =>
    point.x >= rect.minX && point.x <= rect.maxX && point.z >= rect.minZ && point.z <= rect.maxZ;
  for (const box of BENCH_BOXES) {
    assert.ok(OBSTACLES.some((rect) => rect.minX === box.minX && rect.maxZ === box.maxZ));
  }
  for (let seat = 0; seat < BENCH_SEAT_COUNT; seat++) {
    const approach = seatApproach(seat);
    assert.ok(inside(seatRest(seat), BENCH_BOXES[seatBench(seat)]));
    assert.deepEqual(clampToWalkable(approach.x, approach.z), approach);
    assert.ok(!OBSTACLES.some((rect) => inside(approach, rect)));
  }
});

test("마당 시작 자리에서 모든 벤치 앞자리까지 걸어갈 수 있어요", () => {
  const nav = createNavGrid({ areas: WALK_AREAS, obstacles: OBSTACLES, radius: PLAYER_RADIUS, cellSize: 0.2 });
  for (let seat = 0; seat < BENCH_SEAT_COUNT; seat++) {
    const approach = seatApproach(seat);
    const goal = nav.nearestFree(approach);
    assert.ok(goal);
    assert.ok(Math.hypot(goal.x - approach.x, goal.z - approach.z) < 0.25);
    assert.ok(nav.findPath(PLAYER_START, goal).length > 0);
  }
});

/* ───────── 동시에 앉기 ───────── */

test("두 사람이 같은 자리에 앉으려 하면 먼저 처리된 사람만 앉아요", () => {
  const a = record("aaaaaaaa");
  const b = record("bbbbbbbb");
  const seatedA = granted(takeSeat([a, b], a, 3));
  const refused = takeSeat([seatedA, b], b, 3);
  assert.equal(refused.granted, false);
  assert.equal(refused.granted ? null : refused.reason, "taken");
  assert.equal(seatOf(refused.record), null);
  assert.equal(seatOwner([seatedA, b], 3)?.id, "aaaaaaaa");
  // 옆자리는 비어 있어요.
  assert.equal(seatOf(granted(takeSeat([seatedA, b], b, 2))), 2);
});

test("앉으면 걸어 다니는 자리가 벤치 앞자리가 되고, 침대 배정은 그대로예요", () => {
  const owned = lieDown(claimBed([], record("aaaaaaaa"), 5).record, 5, 1000).record;
  const result = takeSeat([owned], owned, 6);
  assert.ok(result.granted);
  if (!result.granted) return;
  assert.equal(result.wasLying, true);
  assert.equal(result.moved, null);
  assert.equal(result.record.bed, 5);
  assert.equal(result.record.lyingSince, null);
  assert.deepEqual({ x: result.record.x, z: result.record.z }, seatApproach(6));
});

test("다른 자리로 옮기면 원래 자리는 바로 비어요", () => {
  const a = granted(takeSeat([], record("aaaaaaaa"), 0));
  const result = takeSeat([a], a, 5);
  assert.ok(result.granted);
  if (!result.granted) return;
  assert.equal(result.moved, 0);
  assert.equal(seatOwner([result.record], 0), null);
  assert.equal(seatOwner([result.record], 5)?.id, "aaaaaaaa");
});

test("이미 앉은 자리를 다시 달라고 하면 그대로 허락하고 기록을 바꾸지 않아요", () => {
  const a = granted(takeSeat([], record("aaaaaaaa"), 4));
  const again = takeSeat([a], a, 4);
  assert.ok(again.granted);
  assert.equal(again.record, a);
});

test("없는 자리와 퇴원하는 사람은 앉지 못해요", () => {
  assert.equal(isSeat(BENCH_SEAT_COUNT), false);
  assert.equal(isSeat(-1), false);
  assert.equal(isSeat(1.5), false);
  const noSeat = takeSeat([], record("aaaaaaaa"), BENCH_SEAT_COUNT);
  assert.equal(noSeat.granted ? null : noSeat.reason, "no-seat");
  const leaving = startDischarge(claimBed([], record("aaaaaaaa"), 2).record, 1000);
  const refused = takeSeat([], leaving, 0);
  assert.equal(refused.granted ? null : refused.reason, "not-allowed");
});

test("퇴원을 시작하면 앉아 있던 벤치도 비워요", () => {
  const seated = granted(takeSeat([], claimBed([], record("aaaaaaaa"), 2).record, 1));
  assert.equal(seatOf(startDischarge(seated, 1000)), null);
});

test("문병객도 벤치에 앉을 수 있어요", () => {
  assert.equal(visitorMay("sit"), true);
  assert.equal(visitorMay("stand"), true);
  const visitor = record("vvvvvvvv", { outfit: "visitor" });
  assert.equal(seatOf(granted(takeSeat([], visitor, 7))), 7);
  // 문병객으로 옷을 바꿔도 앉은 자리는 그대로예요.
  const seated = granted(takeSeat([], record("aaaaaaaa"), 2));
  const changed = updateProfile(seated, hello({ outfit: "visitor" }));
  assert.ok(changed.kind === "updated");
  if (changed.kind === "updated") assert.equal(seatOf(changed.record), 2);
});

test("일어나면 자리가 비고, 서 있으면 아무것도 바꾸지 않아요", () => {
  const seated = granted(takeSeat([], record("aaaaaaaa"), 1));
  const up = leaveSeat(seated);
  assert.ok(up);
  assert.equal(seatOf(up), null);
  assert.equal(leaveSeat(up), null);
  assert.equal(leaveSeat(record("bbbbbbbb")), null);
});

/* ───────── 재접속 ───────── */

test("30초 안에 다시 이어지면 앉아 있던 자리를 그대로 돌려받아요", () => {
  const seated = granted(takeSeat([], record("aaaaaaaa"), 3));
  const away = toAway(seated, "key-a", 1000);
  // 끊긴 동안에도 다른 사람은 그 자리에 앉지 못해요.
  const other = record("bbbbbbbb", { guestId: "guest-bbbbbbbb" });
  assert.equal(takeSeat([away.record, other], other, 3).granted, false);
  const back = admit([], 1, hello(), 30, "cccccccc", away.record);
  assert.equal(back.kind, "admitted");
  if (back.kind === "admitted") {
    assert.equal(back.restored, true);
    assert.equal(seatOf(back.record), 3);
  }
});

test("30초가 지나면 자리가 비어 다른 사람이 앉을 수 있어요", () => {
  const seated = granted(takeSeat([], record("aaaaaaaa"), 3));
  const away = toAway(seated, "key-a", 1000);
  const { kept } = expireAway([away], 1000 + GRACE_MS + 1);
  assert.equal(kept.length, 0);
  const other = record("bbbbbbbb");
  assert.equal(takeSeat(kept.map((guest) => guest.record), other, 3).granted, true);
});

test("새로 들어오면 서 있는 채로 시작해요", () => {
  const fresh = admit([], 0, hello(), 30, "aaaaaaaa");
  assert.ok(fresh.kind === "admitted");
  if (fresh.kind === "admitted") assert.equal(toPublic(fresh.record).bench, null);
});

/* ───────── 벤치 누르기 ───────── */

test("벤치를 누르면 가까운 빈자리로 가고, 둘 다 차 있으면 알려 줘요", () => {
  const near1 = seatApproach(1);
  assert.deepEqual(benchTap(0, { seat: null, x: near1.x, z: near1.z }, () => false), { kind: "sit", seat: 1 });
  assert.deepEqual(benchTap(0, { seat: null, x: near1.x, z: near1.z }, (seat) => seat === 1), { kind: "sit", seat: 0 });
  assert.deepEqual(benchTap(0, { seat: null, x: 0, z: 30 }, () => true), { kind: "full" });
});

test("앉아 있는 벤치를 다시 누르면 일어나고, 다른 벤치를 누르면 옮겨 앉아요", () => {
  assert.deepEqual(benchTap(1, { seat: 3, x: 0, z: 30 }, () => false), { kind: "stand" });
  assert.deepEqual(benchTap(1, { seat: 2, x: 0, z: 30 }, () => false), { kind: "stand" });
  assert.equal(benchTap(2, { seat: 3, x: 0, z: 30 }, () => false).kind, "sit");
});

test("벤치 안내 문구는 부드러운 해요체이고 금칙어가 없어요", () => {
  for (const text of [BENCH_FULL_TEXT, SEAT_TAKEN_TEXT]) {
    assert.match(text, /요\.$/);
    assert.ok(!BANNED_WORDS.some((word) => text.includes(word)));
    assert.ok(!text.includes("괜찮아요?") && !text.includes("힘내요"));
  }
});

/* ───────── 메시지 ───────── */

test("sit과 stand는 v와 자리 번호를 zod로 검사해요", () => {
  const read = (value: unknown) => parseMessage(clientMessageSchema, JSON.stringify(value));
  assert.ok(read({ v: PROTOCOL_VERSION, type: "sit", seat: 0 }));
  assert.ok(read({ v: PROTOCOL_VERSION, type: "sit", seat: BENCH_SEAT_COUNT - 1 }));
  assert.ok(read({ v: PROTOCOL_VERSION, type: "stand" }));
  assert.equal(read({ v: PROTOCOL_VERSION, type: "sit", seat: BENCH_SEAT_COUNT }), null);
  assert.equal(read({ v: PROTOCOL_VERSION, type: "sit", seat: 1.5 }), null);
  assert.equal(read({ v: PROTOCOL_VERSION, type: "sit" }), null);
  assert.equal(read({ v: PROTOCOL_VERSION - 1, type: "sit", seat: 0 }), null);
});

test("서버의 앉기 답과 event도 zod로 검사해요", () => {
  const server = (value: unknown) => parseMessage(serverMessageSchema, JSON.stringify(value), 65_536);
  const v = PROTOCOL_VERSION;
  assert.ok(server({ v, type: "seat-granted", seat: 2 }));
  assert.ok(server({ v, type: "seat-unavailable", seat: 2 }));
  assert.ok(server({ v, type: "event", event: { kind: "sit", id: "abcd1234", seat: 5 } }));
  assert.ok(server({ v, type: "event", event: { kind: "stand", id: "abcd1234" } }));
  assert.equal(server({ v, type: "event", event: { kind: "sit", id: "abcd1234", seat: 99 } }), null);
});

test("다른 사람에게 보이는 정보에는 앉은 자리 번호만 있어요", () => {
  const seated = granted(takeSeat([], record("aaaaaaaa"), 6));
  assert.equal(toPublic(seated).bench, 6);
  assert.equal(toPublic(record("bbbbbbbb")).bench, null);
});

/* ───────── 화면의 앉기 흐름 ───────── */

test("벤치 앞에 닿으면 앉기 시작하고, 시간이 지나면 다 앉아요", () => {
  let flow = headToSeat(2);
  assert.equal(seatInUse(flow), 2);
  assert.equal(isSeated(flow), false);
  flow = arrivedAtSeat(flow);
  assert.equal(flow.kind, "sitting-down");
  assert.equal(isSeated(flow), true);
  assert.equal(seatAllowsGesture(flow), false);
  flow = tickSeat(flow, 0.5, 1).flow;
  assert.equal(seatProgress(flow, 1), 0.5);
  flow = tickSeat(flow, 0.6, 1).flow;
  assert.deepEqual(flow, { kind: "sitting", seat: 2 });
  assert.equal(seatProgress(flow, 1), 1);
  assert.equal(seatAllowsGesture(flow), true);
});

test("앉다가 일어나면 앉은 만큼만 되돌고, 다 일어나면 알려 줘요", () => {
  const half = tickSeat(arrivedAtSeat(headToSeat(1)), 0.3, 1).flow;
  const rising = rise(half, 1);
  assert.deepEqual(rising, { kind: "rising", seat: 1, remaining: 0.3 });
  assert.equal(seatInUse(rising), null);
  const step = tickSeat(rising, 0.4, 1);
  assert.equal(step.stood, true);
  assert.deepEqual(step.flow, NO_SEAT);
  // 앉으러 가던 중에 일어나면 그냥 그만둬요.
  assert.deepEqual(rise(headToSeat(4), 1), NO_SEAT);
  assert.deepEqual(rise(NO_SEAT, 1), NO_SEAT);
});

test("다 앉으면 벤치 높이로 올라앉고, 서 있으면 그대로예요", () => {
  const input = {
    walkPhase: 0,
    walkWeight: 0,
    breathPhase: 0,
    gesture: null,
    gestureElapsed: 0,
    bedProgress: 0,
    carrying: false,
  };
  const sitting = composePose(createPose(), { ...input, seatProgress: 1 });
  assert.equal(sitting.seatLift, 1);
  assert.equal(sitting.seatTravel, 1);
  assert.ok(sitting.lean < 0);
  assert.ok(sitting.footLeftStep > 0 && sitting.footRightStep > 0);
  const standing = composePose(createPose(), input);
  assert.equal(standing.seatLift, 0);
  assert.equal(standing.lean, 0);
});
