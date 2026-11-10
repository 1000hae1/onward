import assert from "node:assert/strict";
import { test } from "vitest";
import { catFrameAt, CAT_SLOT_MS, resumeSlot } from "../src/cat/cat-path.ts";
import type { CatRoom } from "../src/cat/cat-path.ts";
import { petSpot, sceneFrame, sceneRest, WAND_JUMP_HEIGHT } from "../src/cat/cat-play.ts";
import type { PlayScene } from "../src/cat/cat-play.ts";
import { PLAY_TIMING } from "../shared/cat-play-rules.ts";
import type { CatSceneKind } from "../shared/cat-play-rules.ts";
import { createNavGrid } from "../src/ward/movement.ts";
import { bedApproach, bedCatSeat, bedCatYaw, BED_SURFACE_Y, BEDS, catSpots, doorSpots, OBSTACLES, roomRect, ROOMS } from "../shared/ward-layout.ts";
import { composeCatPose, createCatPose, restPlayPose } from "../src/cat/cat-pose.ts";

const ROOM_INDEX = 1;
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

/** 화면 하나가 받은 놀이로 만드는 장면이에요. 서버가 알린 값과 시각만 써요. */
function sceneOf(room: CatRoom, kind: CatSceneKind, at: number, seed: number): PlayScene {
  const start = catFrameAt(room, at, free, null);
  const bedIndex = room.beds[0];
  const bed = BEDS[bedIndex];
  const spot = room.spots[0];
  return {
    kind,
    seed,
    at,
    until: at + PLAY_TIMING[kind].untilMs,
    start: { x: start.x, y: 0, z: start.z, yaw: start.yaw },
    floor: { x: start.x, z: start.z },
    person: { x: spot.x + 1, z: spot.z },
    bed: { approach: bedApproach(bed), seat: bedCatSeat(bed, true), yaw: bedCatYaw(bed), height: BED_SURFACE_Y },
    door: doorSpots(ROOMS[room.roomIndex]),
    path: room.path,
  };
}

test("같은 놀이 소식이면 두 화면이 같은 장면을 그려요", () => {
  const a = roomOf(ROOM_INDEX);
  const b = roomOf(ROOM_INDEX);
  for (const kind of ["pet", "yarn", "wand", "knead", "rub"] as const) {
    const at = T0 + 5_000;
    const sa = sceneOf(a, kind, at, 0.37);
    const sb = sceneOf(b, kind, at, 0.37);
    for (let t = at; t < at + Math.min(PLAY_TIMING[kind].untilMs, 20_000); t += 137) {
      assert.deepEqual(sceneFrame(sa, t), sceneFrame(sb, t), `${kind} @${t - at}`);
    }
  }
});

test("놀이를 시작할 때 고양이가 있던 자리에서 순간 이동하지 않아요", () => {
  const room = roomOf(ROOM_INDEX);
  for (const kind of ["pet", "yarn", "wand", "knead", "rub"] as const) {
    const at = T0 + 11_000;
    const scene = sceneOf(room, kind, at, 0.5);
    const first = sceneFrame(scene, at);
    assert.ok(Math.hypot(first.x - scene.start.x, first.z - scene.start.z) < 1e-6, kind);
  }
});

test("놀이가 끝나면 놀던 자리에서 원래 일정으로 걸어 돌아가요", () => {
  const room = roomOf(ROOM_INDEX);
  for (const kind of ["yarn", "wand", "pet"] as const) {
    const at = T0 + 3_000;
    const scene = sceneOf(room, kind, at, 0.8);
    const last = sceneFrame(scene, scene.until - 1);
    const rest = sceneRest(scene);
    const resume = { at: scene.until, from: rest.point, fromSeat: rest.seat };
    // 끝나는 순간 장면의 마지막 자리와 돌아가기의 첫 자리가 이어져요.
    const back = catFrameAt(room, scene.until, free, null, resume);
    assert.ok(Math.hypot(back.x - last.x, back.z - last.z) < 0.05, `${kind}: ${back.x},${back.z} vs ${last.x},${last.z}`);
    // 돌아가기 칸이 끝나면 놀이를 모르는 화면과 같은 자리예요.
    const after = (resumeSlot(resume) + 1) * CAT_SLOT_MS + 50;
    assert.deepEqual(catFrameAt(room, after, free, null, resume), catFrameAt(room, after, free, null));
    // 돌아가는 동안 걸음은 이어져요. 프레임 사이에 멀리 건너뛰지 않아요.
    let previous = back;
    for (let t = scene.until; t < after; t += 100) {
      const frame = catFrameAt(room, t, free, null, resume);
      assert.ok(Math.hypot(frame.x - previous.x, frame.z - previous.z) < 0.3, `${kind} jump at ${t - scene.until}`);
      previous = frame;
    }
  }
});

test("낚싯대 놀이에서 고양이는 살짝만 떠요", () => {
  const room = roomOf(ROOM_INDEX);
  const scene = sceneOf(room, "wand", T0, 0.2);
  let highest = 0;
  for (let t = scene.at; t < scene.until; t += 20) highest = Math.max(highest, sceneFrame(scene, t).y);
  assert.ok(highest > 0.03);
  assert.ok(highest <= WAND_JUMP_HEIGHT + 1e-9);
});

test("쓰다듬기는 눈을 가늘게 감고 하트 하나가 떠요", () => {
  const room = roomOf(ROOM_INDEX);
  const scene = sceneOf(room, "pet", T0, 0.2);
  const spot = petSpot(scene);
  assert.ok(Math.abs(Math.hypot(spot.x - scene.start.x, spot.z - scene.start.z) - 0.42) < 1e-6);
  let hearts = 0;
  let wasHeart = false;
  let squinted = false;
  for (let t = scene.at; t < scene.until; t += 50) {
    const frame = sceneFrame(scene, t);
    if (frame.heart !== null && !wasHeart) hearts += 1;
    wasHeart = frame.heart !== null;
    if (frame.play.squint > 0.9) squinted = true;
  }
  assert.equal(hearts, 1);
  assert.ok(squinted);
});

test("털실은 사람 쪽에서 굴러와 고양이 품에 안겨요", () => {
  const room = roomOf(ROOM_INDEX);
  const scene = sceneOf(room, "yarn", T0, 0.5);
  const start = sceneFrame(scene, scene.at).yarn;
  assert.ok(start);
  const toPerson = Math.hypot(start.x - scene.person.x, start.z - scene.person.z);
  assert.ok(toPerson < 0.3);
  const hugging = sceneFrame(scene, scene.at + 6_500);
  assert.ok(hugging.play.roll > 0.8);
  assert.ok(hugging.yarn && Math.hypot(hugging.yarn.x - hugging.x, hugging.yarn.z - hugging.z) < 0.25);
});

test("꾹꾹이를 하고 나면 침대 위에 웅크려 자요", () => {
  const room = roomOf(ROOM_INDEX);
  const scene = sceneOf(room, "knead", T0, 0.5);
  const sleeping = sceneFrame(scene, scene.at + 30_000);
  assert.equal(sleeping.y, BED_SURFACE_Y);
  assert.ok(sleeping.curl > 0.9);
  let kneaded = false;
  for (let t = scene.at; t < scene.at + 20_000; t += 50) if (sceneFrame(scene, t).play.knead !== 0) kneaded = true;
  assert.ok(kneaded);
  assert.deepEqual(sceneRest(scene).seat, scene.bed?.seat);
});

test("놀이 자세가 없으면 예전과 같은 자세예요", () => {
  const input = { walkPhase: 1.2, walkWeight: 0.4, sit: 0.3, curl: 0.1, lookUp: 0, blink: 0.2, nose: 0 };
  const plain = composeCatPose(createCatPose(), input);
  const rested = composeCatPose(createCatPose(), { ...input, play: restPlayPose() });
  assert.deepEqual(rested, plain);
});
