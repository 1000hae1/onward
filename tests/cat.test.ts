import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAT_GREET_GAP_SECONDS,
  CAT_HOP_SECONDS,
  CAT_VISIT_AFTER_SECONDS,
  catCanGreet,
  createCatBrain,
  decideCat,
  shouldGreet,
  startGreet,
} from "../shared/cat-brain.ts";
import type { CatBrain, CatFacts, CatPlan } from "../shared/cat-brain.ts";
import { addCrumb, followTrail, trailLength } from "../src/ward/companion-trail.ts";
import {
  canAddLamp,
  chooseGiftSlot,
  GIFT_SLOTS_PER_STAND,
  lampSlotPosition,
  LAMPS_PER_WINDOW,
} from "../src/ward/offering-rules.ts";
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
} from "../src/ward/layout.ts";
import { CAT_COATS, getCatKit, catTriangles, getCatMaterial } from "../src/cat/cat-kit.ts";
import { blinkAmount, composeCatPose, createCatPose } from "../src/cat/cat-pose.ts";

const beds = [0, 1, 2, 3, 4, 5];
const facts = (over: Partial<CatFacts> = {}): CatFacts => ({
  now: 0,
  beds,
  takenBeds: [],
  lying: null,
  alone: true,
  arrived: false,
  spotCount: 6,
  ...over,
});
const brainWith = (plan: CatPlan): CatBrain => ({ seed: 7, plan });

test("시드가 같으면 같은 순서로 움직여요. 서버와 화면이 같은 결과를 내기 위해서예요", () => {
  const run = (seed: number): string[] => {
    let brain = createCatBrain(seed, 0);
    const log: string[] = [];
    for (let now = 0; now < 600; now += 1) {
      brain = decideCat(brain, facts({ now, arrived: true }));
      log.push(JSON.stringify(brain.plan));
    }
    return log;
  };
  assert.deepEqual(run(11), run(11));
  assert.notDeepEqual(run(11), run(12));
});

test("바뀔 일이 없으면 같은 객체를 돌려줘요. 계획이 바뀔 때만 알리기 위해서예요", () => {
  const brain = brainWith({ kind: "pause", until: 10 });
  assert.equal(decideCat(brain, facts({ now: 5 })), brain);
  const walking = brainWith({ kind: "stroll", spot: 1 });
  assert.equal(decideCat(walking, facts({ now: 5 })), walking);
});

test("쉬고 나면 걷거나 빈 침대로 가요", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    const next = decideCat({ seed, plan: { kind: "pause", until: 0 } }, facts({ now: 1 }));
    seen.add(next.plan.kind);
    if (next.plan.kind === "stroll") assert.ok(next.plan.spot >= 0 && next.plan.spot < 6);
  }
  assert.deepEqual([...seen].sort(), ["stroll", "toBed"]);
});

test("누가 쓰는 침대로는 쉬러 가지 않아요", () => {
  for (let seed = 0; seed < 200; seed++) {
    const next = decideCat(
      { seed, plan: { kind: "pause", until: 0 } },
      facts({ now: 1, takenBeds: [0, 1, 2, 3, 4] }),
    );
    if (next.plan.kind === "toBed") assert.equal(next.plan.bed, 5);
  }
});

test("쉬는 침대에 사람이 오면 내려와요", () => {
  const resting = brainWith({ kind: "onBed", bed: 2, purpose: "rest", until: 100 });
  assert.equal(decideCat(resting, facts({ now: 5, takenBeds: [2] })).plan.kind, "offBed");
  assert.equal(decideCat(resting, facts({ now: 5 })), resting);
  assert.equal(decideCat(resting, facts({ now: 100 })).plan.kind, "offBed");
});

test("쉬러 가는 길에 침대에 사람이 오면 멈춰요", () => {
  const going = brainWith({ kind: "toBed", bed: 2, purpose: "rest" });
  assert.equal(decideCat(going, facts({ takenBeds: [2] })).plan.kind, "pause");
});

test("2분이 되기 전에는 찾아오지 않아요", () => {
  const brain = brainWith({ kind: "pause", until: 500 });
  const lying = { bed: 3, since: 0 };
  assert.equal(decideCat(brain, facts({ now: CAT_VISIT_AFTER_SECONDS - 1, lying })), brain);
  const next = decideCat(brain, facts({ now: CAT_VISIT_AFTER_SECONDS, lying }));
  assert.deepEqual(next.plan, { kind: "toBed", bed: 3, purpose: "visit" });
});

test("다른 병실에 누워 있거나 혼자가 아니면 찾아오지 않아요", () => {
  const brain = brainWith({ kind: "pause", until: 500 });
  const now = CAT_VISIT_AFTER_SECONDS * 2;
  assert.equal(decideCat(brain, facts({ now, lying: { bed: 99, since: 0 } })), brain);
  assert.equal(decideCat(brain, facts({ now, lying: { bed: 3, since: 0 }, alone: false })), brain);
});

test("다른 침대에서 쉬던 고양이는 내려온 뒤에 찾아와요", () => {
  const now = CAT_VISIT_AFTER_SECONDS;
  const lying = { bed: 3, since: 0 };
  const resting = brainWith({ kind: "onBed", bed: 1, purpose: "rest", until: 900 });
  const off = decideCat(resting, facts({ now, lying }));
  assert.deepEqual(off.plan, { kind: "offBed", bed: 1, until: now + CAT_HOP_SECONDS });
  assert.equal(decideCat(off, facts({ now: now + 0.1, lying })), off);
  // 바닥에 내려선 다음 판단에서 찾아가요.
  const landed = decideCat(off, facts({ now: now + CAT_HOP_SECONDS, lying }));
  assert.equal(landed.plan.kind, "pause");
  assert.deepEqual(decideCat(landed, facts({ now: now + CAT_HOP_SECONDS, lying })).plan, {
    kind: "toBed",
    bed: 3,
    purpose: "visit",
  });
});

test("도착하면 발치에 머물다가 내가 일어나면 내려가요", () => {
  const lying = { bed: 3, since: 0 };
  const now = 200;
  const going = brainWith({ kind: "toBed", bed: 3, purpose: "visit" });
  const seated = decideCat(going, facts({ now, lying, arrived: true }));
  assert.deepEqual(seated.plan, { kind: "onBed", bed: 3, purpose: "visit", until: null });
  assert.equal(decideCat(seated, facts({ now: 9999, lying })), seated);
  assert.equal(decideCat(seated, facts({ now: 9999 })).plan.kind, "offBed");
});

test("찾아가는 길에 내가 일어나면 가던 길을 멈춰요", () => {
  const going = brainWith({ kind: "toBed", bed: 3, purpose: "visit" });
  assert.equal(decideCat(going, facts({ now: 200 })).plan.kind, "pause");
});

test("바닥에 있을 때만 코를 맞대고, 너무 자주 하지 않아요", () => {
  assert.equal(catCanGreet({ kind: "pause", until: 1 }), true);
  assert.equal(catCanGreet({ kind: "stroll", spot: 1 }), true);
  assert.equal(catCanGreet({ kind: "onBed", bed: 1, purpose: "rest", until: 1 }), false);
  assert.equal(catCanGreet({ kind: "offBed", bed: 1, until: 1 }), false);
  assert.equal(shouldGreet(0.5, 10, null), true);
  assert.equal(shouldGreet(0.9, 10, null), false);
  assert.equal(shouldGreet(0.5, 10, 5), false);
  assert.equal(shouldGreet(0.5, 5 + CAT_GREET_GAP_SECONDS, 5), true);
  assert.equal(startGreet(brainWith({ kind: "stroll", spot: 1 }), 3).plan.kind, "pause");
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
