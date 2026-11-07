import assert from "node:assert/strict";
import { test } from "vitest";
import { CAT_GREET_GAP_SECONDS, catFrameAt, CAT_SLOT_MS, shouldGreet, slotGoal, slotOf } from "../src/cat/cat-path.ts";
import type { CatRoom } from "../src/cat/cat-path.ts";
import { addCrumb, followTrail, trailLength } from "../src/ward/companion-trail.ts";
import {
  canAddLamp,
  chooseGiftSlot,
  GIFT_SLOTS_PER_STAND,
  lampSlotPosition,
  LAMPS_PER_WINDOW,
} from "../shared/offering-rules.ts";
import { createNavGrid } from "../src/ward/movement.ts";
import {
  BEDS,
  bedCatSeat,
  bedCurlSpot,
  bedHeadSpot,
  catSpots,
  giftSpot,
  NIGHTSTANDS,
  OBSTACLES,
  ROOM,
  roomAt,
  roomRect,
  ROOMS,
  windowLampSpot,
} from "../shared/ward-layout.ts";
import { CAT_COATS, getCatKit, catTriangles, getCatMaterial } from "../src/cat/cat-kit.ts";
import { blinkAmount, composeCatPose, createCatPose } from "../src/cat/cat-pose.ts";

const roomOf = (index: number): CatRoom => {
  const room = ROOMS[index];
  const rect = roomRect(room);
  const nav = createNavGrid({
    areas: [{ minX: rect.minX + 0.17, maxX: rect.maxX - 0.17, minZ: rect.minZ + 0.17, maxZ: rect.maxZ - 0.17 }],
    obstacles: OBSTACLES,
    radius: 0.14,
    cellSize: 0.2,
  });
  return {
    roomIndex: index,
    spots: catSpots(room),
    beds: BEDS.flatMap((bed, id) => (bed.roomIndex === index ? [id] : [])),
    path: (from, to) => {
      const found = nav.findPath(from, to);
      return found.length > 0 ? [...found.slice(0, -1), to] : [to];
    },
  };
};
const free = () => false;
const T0 = Date.UTC(2026, 10, 7, 3, 0, 0);

test("같은 병실, 같은 시각이면 어느 화면에서 계산해도 같은 자리예요", () => {
  // 화면 둘을 흉내 내려고 길 캐시도 따로 만들어요.
  const a = roomOf(2);
  const b = roomOf(2);
  for (let t = T0; t < T0 + CAT_SLOT_MS * 30; t += 731) {
    assert.deepEqual(catFrameAt(a, t, free, null), catFrameAt(b, t, free, null));
  }
});

test("병실이 다르면 고양이마다 다르게 움직여요", () => {
  const goals = (index: number) => Array.from({ length: 40 }, (_, k) => JSON.stringify(slotGoal(roomOf(index), slotOf(T0) + k)));
  assert.notDeepEqual(goals(0), goals(1));
});

test("칸이 바뀌는 순간에도 순간이동하지 않아요", () => {
  for (const index of [0, 3, 5]) {
    const room = roomOf(index);
    for (let k = 1; k < 200; k++) {
      const boundary = (slotOf(T0) + k) * CAT_SLOT_MS;
      const before = catFrameAt(room, boundary - 1, free, null);
      const after = catFrameAt(room, boundary + 1, free, null);
      assert.ok(Math.hypot(before.x - after.x, before.z - after.z) < 0.05, `${index} ${k}`);
      assert.ok(Math.abs(before.y - after.y) < 0.05, `${index} ${k} y`);
    }
  }
});

test("어느 자리에서 어느 자리로 가든 한 칸 안에 도착해요", () => {
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const room = roomOf(index);
    for (let k = 0; k < 300; k++) {
      const end = (slotOf(T0) + k + 1) * CAT_SLOT_MS - 1;
      const frame = catFrameAt(room, end, free, null);
      assert.notEqual(frame.pose, "walk", `${index} ${k}`);
      assert.notEqual(frame.pose, "hop", `${index} ${k}`);
    }
  }
});

test("가끔 침대에서 쉬고, 누가 쓰는 침대에서는 쉬지 않아요", () => {
  const room = roomOf(1);
  let resting = 0;
  for (let k = 0; k < 400; k++) {
    const end = (slotOf(T0) + k + 1) * CAT_SLOT_MS - 1;
    const goal = slotGoal(room, slotOf(end));
    const frame = catFrameAt(room, end, free, null);
    if (goal.kind === "rest") {
      resting++;
      assert.equal(frame.pose, "curl");
      assert.ok(frame.y > 0.5);
      const taken = catFrameAt(room, end, (bed) => bed === goal.bed, null);
      assert.equal(taken.y, 0);
      assert.equal(taken.pose, "sit");
    }
  }
  assert.ok(resting > 40 && resting < 160, `${resting}`);
});

test("서버가 정한 방문 시각이 되면 그 침대 발치로 가서 앉아요", () => {
  const room = roomOf(3);
  const bed = room.beds[2];
  const visit = { bed, at: T0 + 5000, until: null };
  assert.deepEqual(catFrameAt(room, T0 + 4000, free, visit), catFrameAt(room, T0 + 4000, free, null));
  const seated = catFrameAt(room, T0 + 5000 + CAT_SLOT_MS, (b) => b === bed, visit);
  const seat = bedCatSeat(BEDS[bed], true);
  assert.ok(Math.hypot(seated.x - seat.x, seated.z - seat.z) < 1e-9);
  assert.equal(seated.pose, "sit");
  assert.ok(seated.y > 0.5);
  // 몇 시간이 지나도 그대로예요. 서버가 그만두라고 할 때까지요.
  const later = catFrameAt(room, T0 + 3_600_000, (b) => b === bed, visit);
  assert.deepEqual([later.x, later.z], [seated.x, seated.z]);
});

test("방문을 그만두면 그 시각부터 내려와 원래 길로 돌아가요", () => {
  const room = roomOf(3);
  const bed = room.beds[2];
  const stop = T0 + 60_000;
  const visit = { bed, at: T0 + 5000, until: stop };
  const atStop = catFrameAt(room, stop - 1, (b) => b === bed, visit);
  const justAfter = catFrameAt(room, stop + 1, free, visit);
  assert.ok(Math.hypot(atStop.x - justAfter.x, atStop.z - justAfter.z) < 0.05);
  // 다음 칸부터는 방문이 없던 것과 같아요.
  const next = (slotOf(stop) + 1) * CAT_SLOT_MS + 3000;
  assert.deepEqual(catFrameAt(room, next, free, visit), catFrameAt(room, next, free, null));
});

test("코 맞대기는 가까울 때만, 너무 자주 하지 않아요", () => {
  assert.equal(shouldGreet(0.5, 10, null), true);
  assert.equal(shouldGreet(0.9, 10, null), false);
  assert.equal(shouldGreet(0.5, 10, 5), false);
  assert.equal(shouldGreet(0.5, 5 + CAT_GREET_GAP_SECONDS, 5), true);
});

test("데리고 온 고양이는 내가 지나온 길을 몇 걸음 뒤에서 따라와요", () => {
  let trail = addCrumb([], { x: 0, z: 0 });
  for (let z = 1; z <= 50; z++) trail = addCrumb(trail, { x: 0, z: z / 10 });
  assert.ok(Math.abs(trailLength({ x: 0, z: 0 }, trail) - 5) < 1e-9);
  const step = followTrail({ x: 0, z: 0 }, trail, 100, 1.2);
  assert.ok(Math.abs(step.position.z - 3.8) < 1e-9);
  assert.ok(Math.abs(step.walked - 3.8) < 1e-9);
  // 한 프레임에는 걸을 수 있는 만큼만 가요.
  assert.ok(Math.abs(followTrail({ x: 0, z: 0 }, trail, 0.5, 1.2).position.z - 0.5) < 1e-9);
  // 이미 가까우면 그 자리에 있어요.
  const near = followTrail({ x: 0, z: 4.5 }, trail.slice(-5), 1, 1.2);
  assert.equal(near.walked, 0);
});

test("끝까지 따라가면 발자국을 비워요", () => {
  const trail = [{ x: 0, z: 1 }, { x: 0, z: 2 }];
  const step = followTrail({ x: 0, z: 0 }, trail, 10, 0);
  assert.deepEqual(step.position, { x: 0, z: 2 });
  assert.deepEqual(step.trail, []);
});

test("조금 움직이면 발자국을 남기지 않아요", () => {
  const trail = addCrumb([], { x: 0, z: 0 });
  assert.equal(addCrumb(trail, { x: 0, z: 0.01 }), trail);
});

test("선물은 빈 칸부터 놓고, 차면 가장 오래된 칸에 놓아요", () => {
  assert.equal(GIFT_SLOTS_PER_STAND, 2);
  assert.equal(chooseGiftSlot([null, null]), 0);
  assert.equal(chooseGiftSlot([{ order: 1, gift: 0 }, null]), 1);
  assert.equal(chooseGiftSlot([{ order: 5, gift: 0 }, { order: 2, gift: 1 }]), 1);
  assert.equal(chooseGiftSlot([{ order: 2, gift: 0 }, { order: 5, gift: 1 }]), 0);
});

test("램프는 정원까지만 놓고 칸이 겹치지 않아요", () => {
  assert.equal(canAddLamp(LAMPS_PER_WINDOW - 1), true);
  assert.equal(canAddLamp(LAMPS_PER_WINDOW), false);
  const spots = Array.from({ length: LAMPS_PER_WINDOW }, (_, slot) => lampSlotPosition(slot));
  assert.equal(new Set(spots).size, LAMPS_PER_WINDOW);
  for (const spot of spots) assert.ok(spot > -1 && spot < 1);
});

test("병실마다 고양이 자리는 비어 있고 병실 안이에요", () => {
  for (const room of ROOMS) {
    const rect = roomRect(room);
    const nav = createNavGrid({
      areas: [{ minX: rect.minX + 0.15, maxX: rect.maxX - 0.15, minZ: rect.minZ + 0.15, maxZ: rect.maxZ - 0.15 }],
      obstacles: OBSTACLES,
      radius: 0.14,
      cellSize: 0.2,
    });
    const spots = catSpots(room);
    assert.equal(spots.length, 6);
    for (const spot of spots) {
      assert.ok(nav.isFree(spot), `${room.number} ${spot.x},${spot.z}`);
      assert.ok(nav.findPath(spots[0], spot).length > 0);
      assert.equal(roomAt(spot.x, spot.z)?.index, room.index);
    }
  }
});

test("웅크리는 자리는 비어 있고, 앉는 자리는 침대 위예요", () => {
  const nav = createNavGrid({ areas: ROOMS.map(roomRect), obstacles: OBSTACLES, radius: 0.1, cellSize: 0.2 });
  for (const bed of BEDS) {
    assert.ok(nav.isFree(bedCurlSpot(bed)), `${bed.roomIndex}-${bed.index}`);
    for (const atFoot of [true, false]) {
      const seat = bedCatSeat(bed, atFoot);
      assert.ok(Math.abs(seat.x - bed.x) < 0.5 && Math.abs(seat.z - bed.z) < 1.05);
    }
    const head = bedHeadSpot(bed);
    assert.ok(Math.abs(head.x - bed.x) < 0.5 && Math.abs(head.z - bed.z) < 1.05);
  }
});

test("선물 칸은 협탁 위이고, 램프는 창틀 위예요", () => {
  for (let stand = 0; stand < NIGHTSTANDS.length; stand++) {
    for (const slot of [0, 1]) {
      const spot = giftSpot(stand, slot);
      assert.ok(Math.abs(spot.x - NIGHTSTANDS[stand].x) < 0.28);
      assert.ok(Math.abs(spot.z - NIGHTSTANDS[stand].z) < 0.28);
    }
  }
  for (const room of ROOMS) {
    const spot = windowLampSpot(room, 1);
    assert.equal(roomAt(spot.x, spot.z)?.index, room.index);
    assert.ok(Math.abs(spot.x - room.x) > ROOM.maxZ - 0.2, "창가");
  }
});

test("두 고양이는 무늬가 다르고, 무늬마다 도형을 재사용해요", () => {
  assert.notEqual(CAT_COATS.ward.fur, CAT_COATS.companion.fur);
  const ward = getCatKit("ward");
  assert.equal(getCatKit("ward"), ward);
  assert.notEqual(getCatKit("companion").body, ward.body);
  assert.equal(getCatMaterial(), getCatMaterial());
});

test("고양이 한 마리의 삼각형 수가 휴대폰 목표 안에 있어요", () => {
  for (const coat of ["ward", "companion"] as const) {
    assert.ok(catTriangles(getCatKit(coat)) <= 500, `${coat} ${catTriangles(getCatKit(coat))}`);
  }
});

test("고양이 자세: 걷기, 앉기, 웅크리기, 눈 깜빡임", () => {
  const base = { walkPhase: 0, walkWeight: 0, sit: 0, curl: 0, lookUp: 0, blink: 0, nose: 0 };
  const walk = composeCatPose(createCatPose(), { ...base, walkPhase: Math.PI / 2, walkWeight: 1 });
  // 대각선 다리가 함께 움직여요.
  assert.equal(walk.legFrontLeft, walk.legBackRight);
  assert.equal(walk.legFrontRight, walk.legBackLeft);
  assert.equal(walk.legFrontLeft, -walk.legFrontRight);
  const sit = composeCatPose(createCatPose(), { ...base, sit: 1 });
  assert.ok(sit.bodyPitch < 0);
  const curl = composeCatPose(createCatPose(), { ...base, curl: 1 });
  assert.ok(curl.bodyLower > 0.05);
  const up = composeCatPose(createCatPose(), { ...base, lookUp: 1 });
  assert.ok(up.headPitch < 0);
  const shut = composeCatPose(createCatPose(), { ...base, blink: 1 });
  assert.ok(shut.eyeOpen < 0.3);
  assert.equal(blinkAmount(0), 0);
  assert.ok(blinkAmount(0.9) > 0.8);
  assert.equal(blinkAmount(100), 0);
});
