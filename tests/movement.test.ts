import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BEDS,
  BED_LENGTH,
  BED_WIDTH,
  CAMERA_MAX_DISTANCE,
  ELEVATOR_DOOR_Z,
  ELEVATOR_HALL,
  FLOOR_AREAS,
  FRIDGES,
  HOSPITAL_BLOCKS,
  isInsideWard,
  NURSE_STATION,
  IV_STAND_RADIUS,
  IV_STANDS,
  NIGHTSTAND_SIZE,
  NIGHTSTANDS,
  nearestRoomIndex,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_START,
  ROOMS,
  roomRect,
  WALK_AREAS,
} from "../src/ward/layout.ts";
import { createNavGrid, stepAlong } from "../src/ward/movement.ts";
import type { Point } from "../src/ward/movement.ts";

const nav = createNavGrid({
  areas: WALK_AREAS,
  obstacles: OBSTACLES,
  radius: PLAYER_RADIUS,
  cellSize: 0.2,
});

function assertWalkable(from: Point, path: readonly Point[]): void {
  let current = from;
  for (const waypoint of path) {
    const length = Math.hypot(waypoint.x - current.x, waypoint.z - current.z);
    const steps = Math.ceil(length / 0.02) || 1;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const point = {
        x: current.x + (waypoint.x - current.x) * t,
        z: current.z + (waypoint.z - current.z) * t,
      };
      assert.ok(nav.isFree(point), `막힌 지점을 지나요: ${point.x}, ${point.z}`);
    }
    current = waypoint;
  }
}

test("병실 5개에 침대가 30개예요", () => {
  assert.equal(ROOMS.length, 5);
  assert.deepEqual(ROOMS.map((room) => room.number), [301, 302, 303, 304, 305]);
  assert.equal(BEDS.length, 30);
  assert.equal(NIGHTSTANDS.length, 30);
});

test("병실마다 침대는 3개씩 두 줄로 마주 봐요", () => {
  for (const room of ROOMS) {
    const beds = BEDS.filter((bed) => bed.roomIndex === room.index);
    const left = beds.filter((bed) => bed.x < room.x);
    const right = beds.filter((bed) => bed.x > room.x);
    assert.equal(left.length, 3);
    assert.equal(right.length, 3);
    assert.deepEqual(left.map((bed) => bed.z), right.map((bed) => bed.z));
  }
});

test("병실끼리 겹치지 않아요", () => {
  for (let i = 1; i < ROOMS.length; i++) {
    assert.ok(roomRect(ROOMS[i - 1]).maxX < roomRect(ROOMS[i]).minX);
  }
});

test("가구는 모두 어느 한 병실 안에 있어요", () => {
  for (const obstacle of OBSTACLES) {
    const inside = ROOMS.map(roomRect).some(
      (rect) =>
        obstacle.minX >= rect.minX &&
        obstacle.maxX <= rect.maxX &&
        obstacle.minZ >= rect.minZ &&
        obstacle.maxZ <= rect.maxZ,
    );
    assert.ok(inside);
  }
});

test("x 좌표에서 가까운 병실을 찾아요", () => {
  assert.equal(nearestRoomIndex(0), 2);
  assert.equal(nearestRoomIndex(ROOMS[0].x), 0);
  assert.equal(nearestRoomIndex(ROOMS[4].x), 4);
  assert.equal(nearestRoomIndex(ROOMS[1].x + 3), 1);
  assert.equal(nearestRoomIndex(-1000), 0);
  assert.equal(nearestRoomIndex(1000), 4);
});

test("복도에서 문을 지나 창가까지 가요", () => {
  const goal = { x: 0, z: -4.5 };
  const path = nav.findPath(PLAYER_START, goal);
  assert.ok(path.length > 0);
  assert.deepEqual(path.at(-1), goal);
  assertWalkable(PLAYER_START, path);
});

test("정면의 탁자는 돌아서 가요", () => {
  const from = { x: 0, z: 2 };
  const goal = { x: 0, z: -2 };
  const path = nav.findPath(from, goal);
  assert.ok(path.length >= 2);
  assertWalkable(from, path);
});

test("벽 너머 복도 끝에서 병실로 들어올 때는 문을 지나요", () => {
  const from = { x: 5, z: 6 };
  const goal = { x: 2.8, z: 4.5 };
  const path = nav.findPath(from, goal);
  assert.ok(path.length >= 2);
  assertWalkable(from, path);
});

test("칸막이를 뚫지 않고 복도를 거쳐 끝 병실에서 끝 병실로 가요", () => {
  const from = { x: ROOMS[0].x, z: -4.5 };
  const goal = { x: ROOMS[4].x, z: -4.5 };
  const path = nav.findPath(from, goal);
  assert.ok(path.length >= 2);
  assert.deepEqual(path.at(-1), goal);
  assertWalkable(from, path);
  assert.ok(path.some((point) => point.z > 5), "복도를 지나야 해요");
});

test("모든 병실의 모든 침대 곁 통로에 닿을 수 있어요", () => {
  for (const bed of BEDS) {
    const room = ROOMS[bed.roomIndex];
    const goal = nav.nearestFree({ x: room.x + (bed.index < 3 ? -1 : 1), z: bed.z });
    assert.ok(goal);
    const path = nav.findPath(PLAYER_START, goal);
    assert.ok(path.length > 0, `${room.number}호 ${bed.index}번 침대에 닿지 못해요`);
    assertWalkable(PLAYER_START, path);
  }
});

test("병실마다 냉장고가 한 대씩 있고, 앞까지 걸어갈 수 있어요", () => {
  assert.equal(FRIDGES.length, ROOMS.length);
  FRIDGES.forEach((fridge, index) => {
    const room = ROOMS[index];
    assert.equal(nearestRoomIndex(fridge.x), room.index);
    // 냉장고 문 바로 앞이 비어 있어야 열 수 있어요.
    const front = { x: fridge.x - 0.6, z: fridge.z };
    assert.ok(nav.isFree(front), `${room.number}호 냉장고 앞이 막혀 있어요`);
    const path = nav.findPath(PLAYER_START, front);
    assert.ok(path.length > 0, `${room.number}호 냉장고에 닿지 못해요`);
    assertWalkable(PLAYER_START, path);
  });
});

test("침대마다 링거가 있고, 침대와 협탁에 겹치지 않아요", () => {
  assert.equal(IV_STANDS.length, BEDS.length);
  IV_STANDS.forEach((stand, index) => {
    const bed = BEDS[index];
    const overlaps = (x: number, z: number, halfX: number, halfZ: number): boolean =>
      Math.abs(stand.x - x) < halfX + IV_STAND_RADIUS && Math.abs(stand.z - z) < halfZ + IV_STAND_RADIUS;
    assert.ok(!overlaps(bed.x, bed.z, BED_LENGTH / 2, BED_WIDTH / 2), "침대와 겹쳐요");
    for (const other of NIGHTSTANDS) {
      assert.ok(!overlaps(other.x, other.z, NIGHTSTAND_SIZE / 2, NIGHTSTAND_SIZE / 2), "협탁과 겹쳐요");
    }
    // 수액 줄의 끝은 그 침대 위에 닿아요.
    const endX = stand.x + Math.cos(stand.rotationY) * Math.hypot(0.65, 0.33);
    const endZ = stand.z - Math.sin(stand.rotationY) * Math.hypot(0.65, 0.33);
    assert.ok(Math.abs(endX - bed.x) < BED_LENGTH / 2, "수액 줄이 침대에서 벗어나요");
    assert.ok(Math.abs(endZ - bed.z) < BED_WIDTH / 2, "수액 줄이 침대에서 벗어나요");
  });
});

test("엘리베이터 앞까지 걸어갈 수 있어요", () => {
  for (const z of ELEVATOR_DOOR_Z) {
    const goal = { x: ELEVATOR_HALL.maxX - 0.5, z };
    assert.ok(nav.isFree(goal));
    const path = nav.findPath(PLAYER_START, goal);
    assert.ok(path.length > 0);
    assertWalkable(PLAYER_START, path);
  }
});

test("간호사실 안쪽은 걸어 들어갈 수 없어요", () => {
  const inside = { x: 0, z: (NURSE_STATION.minZ + NURSE_STATION.maxZ) / 2 };
  assert.equal(nav.isFree(inside), false);
  const tappable = FLOOR_AREAS.some(
    (area) =>
      inside.x >= area.minX && inside.x <= area.maxX && inside.z >= area.minZ && inside.z <= area.maxZ,
  );
  assert.equal(tappable, false);
});

test("가장 멀리 축소해 돌려도 카메라가 병원 건물에 닿지 않아요", () => {
  const minX = Math.min(...WALK_AREAS.map((area) => area.minX)) - CAMERA_MAX_DISTANCE;
  const maxX = Math.max(...WALK_AREAS.map((area) => area.maxX)) + CAMERA_MAX_DISTANCE;
  const minZ = Math.min(...WALK_AREAS.map((area) => area.minZ)) - CAMERA_MAX_DISTANCE;
  const maxZ = Math.max(...WALK_AREAS.map((area) => area.maxZ)) + CAMERA_MAX_DISTANCE;
  for (const block of HOSPITAL_BLOCKS) {
    const apart = block.minX > maxX || block.maxX < minX || block.minZ > maxZ || block.maxZ < minZ;
    assert.ok(apart, `건물에 닿아요: ${JSON.stringify(block)}`);
  }
});

test("눈은 병동 건물 안에 내리지 않아요", () => {
  assert.equal(isInsideWard(0, 0), true);
  assert.equal(isInsideWard(ELEVATOR_HALL.maxX - 1, ELEVATOR_HALL.maxZ - 1), true);
  assert.equal(isInsideWard(0, -7), false);
  assert.equal(isInsideWard(30, 6), false);
});

test("가구 위를 누르면 가장 가까운 빈자리로 가요", () => {
  const onBed = nav.nearestFree({ x: -2.3, z: 0 });
  assert.ok(onBed);
  assert.ok(nav.isFree(onBed));
  const onTable = nav.nearestFree({ x: 0, z: 0 });
  assert.ok(onTable);
  assert.ok(nav.isFree(onTable));
  assert.ok(Math.hypot(onTable.x, onTable.z) < 1.2);
});

test("빈자리는 눌린 자리를 그대로 돌려줘요", () => {
  assert.deepEqual(nav.nearestFree({ x: 0.5, z: 2 }), { x: 0.5, z: 2 });
});

test("경로를 따라 정해진 거리만큼 걸어요", () => {
  const path = [
    { x: 1, z: 0 },
    { x: 1, z: 1 },
  ];
  const partial = stepAlong({ x: 0, z: 0 }, path, 0.5);
  assert.deepEqual(partial.position, { x: 0.5, z: 0 });
  assert.equal(partial.path.length, 2);

  const turned = stepAlong({ x: 0, z: 0 }, path, 1.5);
  assert.deepEqual(turned.position, { x: 1, z: 0.5 });
  assert.equal(turned.path.length, 1);

  const finished = stepAlong({ x: 0, z: 0 }, path, 5);
  assert.deepEqual(finished.position, { x: 1, z: 1 });
  assert.equal(finished.path.length, 0);
});
