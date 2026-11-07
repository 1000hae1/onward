import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cameraAngleToSee,
  easeDistance,
  enteredThroughFront,
  firstBlocked,
  glancePhase,
  pullCamera,
  turnToward,
} from "../src/ward/camera-view.ts";
import { CORRIDOR, ENTRANCE, LOBBY, lightSpots, NURSES, ROOMS, roomRect, WALL_BOXES, WALL_HEIGHT, YARD } from "../shared/ward-layout.ts";

const CLEARANCE = 0.25;

test("앞마당에서 건물 앞벽을 뚫고 볼 수 없어요", () => {
  const blocked = firstBlocked(
    { x: 6, y: 1.2, z: YARD.minZ + 2 },
    { x: 6, y: 1.2, z: LOBBY.maxZ - 2 },
    WALL_BOXES,
  );
  assert.ok(blocked < 1);
});

test("현관으로는 앞마당과 로비가 이어져 보여요", () => {
  const blocked = firstBlocked(
    { x: 0, y: 1.2, z: YARD.minZ + 2 },
    { x: 0, y: 1.2, z: LOBBY.minZ + 1 },
    WALL_BOXES,
  );
  assert.equal(blocked, 1);
  assert.ok(ENTRANCE.height > 1.2);
});

test("복도에서 열린 문으로 병실 안이 보여요", () => {
  const room = ROOMS[1];
  const blocked = firstBlocked({ x: 0, y: 1.2, z: room.z }, { x: room.x, y: 1.2, z: room.z }, WALL_BOXES);
  assert.equal(blocked, 1);
});

test("복도에서 벽 너머 병실은 보이지 않아요", () => {
  const room = ROOMS[1];
  const blocked = firstBlocked(
    { x: 0, y: 1.2, z: room.z + 2.5 },
    { x: room.x, y: 1.2, z: room.z + 2.5 },
    WALL_BOXES,
  );
  assert.ok(blocked < 1);
});

test("옆 병실 사이의 칸막이가 막혀 있어요", () => {
  const [room301, room302] = ROOMS;
  const blocked = firstBlocked(
    { x: room301.x, y: 1.2, z: room301.z },
    { x: room302.x, y: 1.2, z: room302.z },
    WALL_BOXES,
  );
  assert.ok(blocked < 1);
});

test("건물 안에서는 천장 위로 카메라가 나가지 않아요", () => {
  const target = { x: 0, y: 1.2, z: 0 };
  const pulled = pullCamera(target, { x: 0, y: 8, z: 3 }, WALL_BOXES, CLEARANCE);
  assert.ok(pulled.y < WALL_HEIGHT);
});

test("병실 안 카메라는 벽 앞으로 당겨져요", () => {
  const room = ROOMS[1];
  const rect = roomRect(room);
  // 병실 칸막이 쪽으로 뒤로 물러나는 카메라예요.
  const target = { x: room.x, y: 1.2, z: rect.maxZ - 0.5 };
  const pulled = pullCamera(target, { x: room.x, y: 1.2, z: rect.maxZ + 3 }, WALL_BOXES, CLEARANCE);
  assert.ok(pulled.z <= rect.maxZ, "칸막이 안쪽에 있어야 해요");
  assert.ok(pulled.z > target.z, "캐릭터 뒤에 있어야 해요");
});

test("막힌 곳이 없으면 카메라는 바라던 자리에 그대로 있어요", () => {
  const target = { x: 0, y: 1.2, z: 24 };
  const desired = { x: 0, y: 2.6, z: 28 };
  assert.deepEqual(pullCamera(target, desired, WALL_BOXES, CLEARANCE), desired);
});

test("걷는 쪽으로 카메라가 더 가까운 방향으로 돌아요", () => {
  assert.ok(Math.abs(turnToward(0, 1, 0.5) - 0.5) < 1e-9);
  // 170도에서 -170도로 갈 때는 180도를 넘어 짧게 돌아요.
  const from = (170 * Math.PI) / 180;
  const to = (-170 * Math.PI) / 180;
  const turned = turnToward(from, to, 0.5);
  assert.ok(Math.abs(turned - Math.PI) < 1e-9);
});

test("빛은 캐릭터가 있는 공간을 비춰요", () => {
  const room = ROOMS[2];
  const inRoom = lightSpots(room.x, room.z);
  assert.ok(inRoom.every((spot) => Math.abs(spot.x - room.x) < 3.5 && spot.z === room.z));
  const inCorridor = lightSpots(0, 0);
  assert.ok(inCorridor.every((spot) => Math.abs(spot.x) <= CORRIDOR.maxX));
  const outside = lightSpots(0, YARD.maxZ - 1);
  assert.ok(outside.every((spot) => spot.z > LOBBY.minZ && spot.z < LOBBY.maxZ));
});

test("벽에 막히면 카메라 거리를 바로 줄여요", () => {
  assert.equal(easeDistance(4.6, 1.2, 0.016, 3), 1.2);
});

test("벽에서 벗어나면 카메라가 천천히 물러나요", () => {
  const next = easeDistance(1.2, 4.6, 0.016, 3);
  assert.ok(next > 1.2 && next < 1.4, "한 프레임에 튀지 않아야 해요");
  let distance = 1.2;
  for (let frame = 0; frame < 300; frame++) distance = easeDistance(distance, 4.6, 0.016, 3);
  assert.ok(Math.abs(distance - 4.6) < 0.05, "결국 바라던 거리로 돌아와요");
});

test("멈춰 있으면 거리가 그대로예요", () => {
  assert.equal(easeDistance(2, 4.6, 0, 3), 2);
});

test("현관 밖에서도 가장 가까운 간호사가 보이고, 로비에 들어서면 모두 보여요", () => {
  const [nearest] = NURSES;
  assert.equal(
    firstBlocked({ x: 0, y: 1.6, z: LOBBY.maxZ + 2 }, { x: nearest.x, y: 1.3, z: nearest.z }, WALL_BOXES),
    1,
  );
  for (const nurse of NURSES) {
    assert.equal(
      firstBlocked({ x: 0, y: 1.6, z: LOBBY.maxZ - 0.5 }, { x: nurse.x, y: 1.3, z: nurse.z }, WALL_BOXES),
      1,
    );
  }
});

test("현관으로 들어설 때만 간호사실을 비춰요", () => {
  assert.equal(enteredThroughFront(17, 16.7, 16.8), true);
  assert.equal(enteredThroughFront(16.7, 16.5, 16.8), false, "로비 안에서 걸을 때");
  assert.equal(enteredThroughFront(16.7, 17, 16.8), false, "밖으로 나갈 때");
  assert.equal(enteredThroughFront(20, 19, 16.8), false, "앞마당을 걸을 때");
});

test("간호사실을 본 뒤 돌아오고 끝나요", () => {
  assert.equal(glancePhase(0, 2.2, 1.5), "look");
  assert.equal(glancePhase(2.2, 2.2, 1.5), "return");
  assert.equal(glancePhase(3.69, 2.2, 1.5), "return");
  assert.equal(glancePhase(3.7, 2.2, 1.5), "done");
});

test("카메라는 캐릭터를 사이에 두고 대상의 반대쪽에 있어요", () => {
  const target = { x: 0, z: 15 };
  // 정면(-z) 대상이면 카메라는 뒤쪽(+z)이에요.
  assert.equal(cameraAngleToSee(target, { x: 0, z: 10 }), 0);
  const subject = { x: 5, z: 15 };
  const angle = cameraAngleToSee(target, subject);
  assert.ok(Math.sin(angle) < 0, "오른쪽 대상이면 카메라는 왼쪽이에요");
});
