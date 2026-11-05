import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BED_LENGTH,
  BED_WIDTH,
  BEDS,
  BUILDING,
  CORRIDOR,
  CURTAIN_BUNCHES,
  ENTRANCE_GARDENS,
  ENTRANCE,
  FRIDGES,
  isInsideWard,
  IV_STAND_RADIUS,
  IV_STANDS,
  IV_TUBE_REACH,
  LOBBY,
  NIGHTSTAND_SIZE,
  NIGHTSTANDS,
  NURSE_STATION,
  NURSES,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_START,
  ROOMS,
  roomRect,
  roomToWorld,
  WALK_AREAS,
  YARD,
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

/** 병실 가운데 탁자와 침대 발치 사이의 통로예요. */
const AISLE_OFFSET = 0.9;

/** 경로 위의 점이 어느 병실 사각형 안에 있는지 찾아요. */
function roomOf(point: Point) {
  return ROOMS.find((room) => {
    const rect = roomRect(room);
    return point.x >= rect.minX && point.x <= rect.maxX && point.z >= rect.minZ && point.z <= rect.maxZ;
  });
}

test("병실은 101호부터 6개이고 침대가 36개예요", () => {
  assert.equal(ROOMS.length, 6);
  assert.deepEqual(ROOMS.map((room) => room.number), [101, 102, 103, 104, 105, 106]);
  assert.equal(BEDS.length, 36);
  assert.equal(NIGHTSTANDS.length, 36);
});

test("병실은 복도 양옆에 3개씩 있어요", () => {
  assert.equal(ROOMS.filter((room) => room.x < 0).length, 3);
  assert.equal(ROOMS.filter((room) => room.x > 0).length, 3);
  for (const room of ROOMS) {
    const rect = roomRect(room);
    assert.ok(rect.maxX <= CORRIDOR.minX || rect.minX >= CORRIDOR.maxX, `${room.number}호가 복도와 겹쳐요`);
  }
});

test("병실 안쪽 좌표의 문은 복도를, 창문은 바깥벽을 향해요", () => {
  for (const room of ROOMS) {
    const door = roomToWorld(room, 0, 5);
    const window = roomToWorld(room, 0, -5);
    assert.ok(Math.abs(door.x) < Math.abs(window.x), `${room.number}호 방향이 반대예요`);
    assert.ok(Math.abs(door.x) < CORRIDOR.maxX + 0.3, `${room.number}호 문이 복도에 닿지 않아요`);
    assert.ok(Math.abs(window.x) > BUILDING.maxX - 0.3, `${room.number}호 창이 바깥벽에 닿지 않아요`);
  }
});

function insideStation(point: Point): boolean {
  return (
    point.x >= NURSE_STATION.minX &&
    point.x <= NURSE_STATION.maxX &&
    point.z >= NURSE_STATION.minZ &&
    point.z <= NURSE_STATION.maxZ
  );
}

test("간호사실은 로비 오른쪽에 있고 복도 입구를 막지 않아요", () => {
  assert.ok(NURSE_STATION.minZ >= LOBBY.minZ && NURSE_STATION.maxZ <= LOBBY.maxZ);
  assert.ok(NURSE_STATION.minX > CORRIDOR.maxX, "복도 입구 오른쪽에 있어야 해요");
  for (const room of ROOMS) assert.ok(roomRect(room).maxZ <= NURSE_STATION.minZ);
});

test("병아리 간호사 3명은 모두 카운터 안쪽에 있어요", () => {
  assert.equal(NURSES.length, 3);
  for (const nurse of NURSES) {
    assert.ok(insideStation(nurse), "카운터 안쪽에 있어야 해요");
    assert.equal(nav.isFree(nurse), false);
  }
});

test("현관에서 복도까지 곧장 걸어갈 수 있어요", () => {
  const from = { x: 0, z: LOBBY.maxZ - 0.5 };
  const goal = { x: 0, z: CORRIDOR.maxZ - 1 };
  assert.deepEqual(nav.findPath(from, goal), [goal]);
});

test("정원은 현관 양옆에 있고 진입로를 막지 않아요", () => {
  assert.equal(ENTRANCE_GARDENS.length, 2);
  assert.ok(ENTRANCE_GARDENS.some((garden) => garden.maxX < ENTRANCE.minX));
  assert.ok(ENTRANCE_GARDENS.some((garden) => garden.minX > ENTRANCE.maxX));
  const path = nav.findPath(PLAYER_START, { x: 0, z: LOBBY.maxZ - 0.5 });
  assert.equal(path.length, 1, "진입로는 곧게 이어져야 해요");
  for (const garden of ENTRANCE_GARDENS) {
    const inside = { x: (garden.minX + garden.maxX) / 2, z: (garden.minZ + garden.maxZ) / 2 };
    assert.equal(nav.isFree(inside), false);
  }
});

test("침대마다 커튼 다발이 있고, 가구와 겹치지 않아요", () => {
  assert.equal(CURTAIN_BUNCHES.length, BEDS.length);
  const half = 0.2;
  CURTAIN_BUNCHES.forEach((bunch) => {
    assert.ok(roomOf(bunch), "병실 안에 있어야 해요");
    for (const stand of NIGHTSTANDS) {
      const apart =
        Math.abs(bunch.x - stand.x) >= half + NIGHTSTAND_SIZE / 2 ||
        Math.abs(bunch.z - stand.z) >= half + NIGHTSTAND_SIZE / 2;
      assert.ok(apart, "협탁과 겹쳐요");
    }
    for (const fridge of FRIDGES) {
      const apart = Math.abs(bunch.x - fridge.x) >= half + 0.3 || Math.abs(bunch.z - fridge.z) >= half + 0.3;
      assert.ok(apart, "냉장고와 겹쳐요");
    }
    for (const stand of IV_STANDS) {
      const apart =
        Math.abs(bunch.x - stand.x) >= half + IV_STAND_RADIUS ||
        Math.abs(bunch.z - stand.z) >= half + IV_STAND_RADIUS;
      assert.ok(apart, "링거와 겹쳐요");
    }
  });
});

test("병실마다 침대는 3개씩 두 줄로 마주 봐요", () => {
  for (const room of ROOMS) {
    const beds = BEDS.filter((bed) => bed.roomIndex === room.index);
    const firstRow = beds.filter((bed) => bed.index < 3);
    const secondRow = beds.filter((bed) => bed.index >= 3);
    assert.equal(firstRow.length, 3);
    assert.equal(secondRow.length, 3);
    // 두 줄은 병실 가운데를 사이에 두고 z 방향 양쪽에 있어요.
    for (const bed of firstRow) assert.ok(bed.z !== room.z);
    const firstSide = Math.sign(firstRow[0].z - room.z);
    assert.ok(firstRow.every((bed) => Math.sign(bed.z - room.z) === firstSide));
    assert.ok(secondRow.every((bed) => Math.sign(bed.z - room.z) === -firstSide));
  }
});

test("가구는 병실 안에, 로비 가구는 로비나 앞마당에 있어요", () => {
  const containers = [...ROOMS.map(roomRect), LOBBY, YARD];
  for (const obstacle of OBSTACLES) {
    const inside = containers.some(
      (rect) =>
        obstacle.minX >= rect.minX &&
        obstacle.maxX <= rect.maxX &&
        obstacle.minZ >= rect.minZ &&
        obstacle.maxZ <= rect.maxZ,
    );
    assert.ok(inside, `벗어난 가구예요: ${JSON.stringify(obstacle)}`);
  }
});

test("시작 위치는 건물 밖 앞마당이에요", () => {
  assert.equal(isInsideWard(PLAYER_START.x, PLAYER_START.z), false);
  assert.ok(nav.isFree(PLAYER_START));
});

test("앞마당에서 현관과 로비를 지나 복도 끝까지 가요", () => {
  const goal = { x: 0, z: CORRIDOR.minZ + 0.5 };
  const path = nav.findPath(PLAYER_START, goal);
  assert.ok(path.length > 0);
  assert.deepEqual(path.at(-1), goal);
  assertWalkable(PLAYER_START, path);
});

test("앞마당에서 현관을 지나지 않고는 건물로 들어올 수 없어요", () => {
  // 현관 옆의 앞벽 안쪽을 곧바로 가로지를 수 없어요.
  const inLobby = { x: 6, z: LOBBY.maxZ - 1 };
  const inYard = { x: 6, z: YARD.minZ + 10 };
  const path = nav.findPath(inYard, inLobby);
  assert.ok(path.length >= 2, "문을 돌아가야 해요");
  assertWalkable(inYard, path);
  const passedEntrance = [inYard, ...path].some(
    (point) => point.x >= ENTRANCE.minX && point.x <= ENTRANCE.maxX,
  );
  assert.ok(passedEntrance, "현관을 지나야 해요");
});

test("모든 병실의 모든 침대 곁까지 현관에서 걸어갈 수 있어요", () => {
  for (const bed of BEDS) {
    const room = ROOMS[bed.roomIndex];
    const goal = nav.nearestFree({ x: bed.x, z: room.z + Math.sign(bed.z - room.z) * 1 });
    assert.ok(goal);
    const path = nav.findPath(PLAYER_START, goal);
    assert.ok(path.length > 0, `${room.number}호 ${bed.index}번 침대에 닿지 못해요`);
    assertWalkable(PLAYER_START, path);
  }
});

test("병실에서 옆 병실로 갈 때는 벽을 뚫지 않고 복도를 지나요", () => {
  const [room301, room302] = ROOMS;
  const from = { x: room301.x, z: room301.z + AISLE_OFFSET };
  const goal = { x: room302.x, z: room302.z - AISLE_OFFSET };
  const path = nav.findPath(from, goal);
  assert.ok(path.length >= 2);
  assertWalkable(from, path);
  assert.ok(
    path.some((point) => Math.abs(point.x) <= CORRIDOR.maxX + 0.5),
    "복도를 지나야 해요",
  );
});

test("맞은편 병실로 갈 때도 복도를 지나요", () => {
  const from = { x: ROOMS[1].x, z: ROOMS[1].z + AISLE_OFFSET };
  const goal = { x: ROOMS[4].x, z: ROOMS[4].z + AISLE_OFFSET };
  const path = nav.findPath(from, goal);
  assert.ok(path.length >= 2);
  assertWalkable(from, path);
  assert.equal(roomOf(goal)?.number, 105);
});

test("간호사실 카운터 안쪽은 걸어 들어갈 수 없어요", () => {
  const inside = {
    x: (NURSE_STATION.minX + NURSE_STATION.maxX) / 2,
    z: (NURSE_STATION.minZ + NURSE_STATION.maxZ) / 2,
  };
  assert.equal(nav.isFree(inside), false);
});

test("병실마다 냉장고가 한 대씩 있고, 앞까지 걸어갈 수 있어요", () => {
  assert.equal(FRIDGES.length, ROOMS.length);
  FRIDGES.forEach((fridge, index) => {
    const room = ROOMS[index];
    assert.equal(roomOf(fridge)?.number, room.number);
    // 냉장고 문은 병실 안쪽 좌표의 -x를 봐요. 그 앞이 비어 있어야 열 수 있어요.
    const front = roomToWorld(fridge, -0.6, 0);
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
    assert.ok(!overlaps(bed.x, bed.z, BED_WIDTH / 2, BED_LENGTH / 2), "침대와 겹쳐요");
    for (const other of NIGHTSTANDS) {
      assert.ok(!overlaps(other.x, other.z, NIGHTSTAND_SIZE / 2, NIGHTSTAND_SIZE / 2), "협탁과 겹쳐요");
    }
    // 수액 줄의 끝은 그 침대 위에 닿아요.
    const end = roomToWorld(stand, IV_TUBE_REACH, 0);
    assert.ok(Math.abs(end.x - bed.x) < BED_WIDTH / 2, "수액 줄이 침대에서 벗어나요");
    assert.ok(Math.abs(end.z - bed.z) < BED_LENGTH / 2, "수액 줄이 침대에서 벗어나요");
  });
});

test("눈은 건물 안에 내리지 않아요", () => {
  assert.equal(isInsideWard(0, 0), true);
  assert.equal(isInsideWard(0, LOBBY.maxZ - 1), true);
  assert.equal(isInsideWard(0, YARD.maxZ - 1), false);
  assert.equal(isInsideWard(BUILDING.maxX + 1, 0), false);
});

test("가구 위를 누르면 가장 가까운 빈자리로 가요", () => {
  const onBed = nav.nearestFree({ x: BEDS[0].x, z: BEDS[0].z });
  assert.ok(onBed);
  assert.ok(nav.isFree(onBed));
  const onTable = nav.nearestFree({ x: ROOMS[0].x, z: ROOMS[0].z });
  assert.ok(onTable);
  assert.ok(nav.isFree(onTable));
  assert.ok(Math.hypot(onTable.x - ROOMS[0].x, onTable.z - ROOMS[0].z) < 1.2);
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
