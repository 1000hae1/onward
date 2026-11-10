import assert from "node:assert/strict";
import { test } from "vitest";
import {
  chooseSideSpot,
  clearLine,
  nextHeading,
  SIDE_GAP,
  sideSpot,
  stepToward,
  wardWalkable,
} from "../src/ward/companion-side.ts";
import { CORRIDOR, DOOR_RECTS, OBSTACLES, PLAYER_START } from "../shared/ward-layout.ts";

const open = () => true;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("옆자리는 바라보는 방향의 옆으로 SIDE_GAP만큼 떨어져 있어요", () => {
  const owner = { x: 1, z: 2 };
  // +z를 보면 오른쪽은 -x예요.
  const right = sideSpot(owner, 0, 1);
  near(right.x, 1 - SIDE_GAP);
  near(right.z, 2);
  const left = sideSpot(owner, 0, -1);
  near(left.x, 1 + SIDE_GAP);
  // +x를 보면 오른쪽은 +z예요.
  const turned = sideSpot(owner, Math.PI / 2, 1);
  near(turned.x, 1);
  near(turned.z, 2 + SIDE_GAP);
});

test("주인이 움직일 때만 걷는 방향이 바뀌어요", () => {
  near(nextHeading({ x: 0, z: 0 }, { x: 0, z: 1 }, 2), 0);
  near(nextHeading({ x: 0, z: 0 }, { x: 1, z: 0 }, 0), Math.PI / 2);
  // 거의 그대로면 하던 방향 그대로예요. 멈춰도 옆에 앉아 같은 쪽을 봐요.
  near(nextHeading({ x: 0, z: 0 }, { x: 0.001, z: 0 }, 1.2), 1.2);
});

test("옆자리가 막히면 반대쪽, 둘 다 막히면 발자국을 따라가요", () => {
  const owner = { x: 0, z: 0 };
  assert.equal(chooseSideSpot(owner, 0, 1, open)?.side, 1);
  const noRight = (p: { x: number }) => p.x > -0.2;
  assert.equal(chooseSideSpot(owner, 0, 1, noRight)?.side, -1);
  const narrow = (p: { x: number }) => Math.abs(p.x) < 0.2;
  assert.equal(chooseSideSpot(owner, 0, 1, narrow), null);
});

test("곧게 가는 길에 막힌 곳이 하나라도 있으면 막힌 길이에요", () => {
  const wall = (p: { x: number }) => p.x < 0.5 || p.x > 0.6;
  assert.equal(clearLine({ x: 0, z: 0 }, { x: 0.4, z: 0 }, wall), true);
  assert.equal(clearLine({ x: 0, z: 0 }, { x: 1, z: 0 }, wall), false);
});

test("병동 바닥에서는 가구와 바깥을 피해요", () => {
  assert.equal(wardWalkable(PLAYER_START), true);
  const bed = OBSTACLES[0];
  assert.equal(wardWalkable({ x: (bed.minX + bed.maxX) / 2, z: (bed.minZ + bed.maxZ) / 2 }), false);
  assert.equal(wardWalkable({ x: 500, z: 500 }), false);
  // 문틀은 좁아서 복도 쪽 사람이 문 가운데에 서면 양옆이 막혀요.
  const door = DOOR_RECTS[0];
  const middle = { x: (door.minX + door.maxX) / 2, z: (door.minZ + door.maxZ) / 2 };
  assert.equal(chooseSideSpot(middle, Math.PI / 2, 1, wardWalkable), null);
  assert.ok(CORRIDOR.maxX > CORRIDOR.minX);
});

test("가까우면 보통 걸음, 멀면 서둘러 따라붙고, 닿으면 멈춰요", () => {
  const slow = stepToward({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 0.1, 2, 3);
  near(slow.walked, 0.2);
  const fast = stepToward({ x: 0, z: 0 }, { x: 2, z: 0 }, 0.1, 2, 3);
  near(fast.walked, 0.3);
  const arrive = stepToward({ x: 0, z: 0 }, { x: 0.05, z: 0 }, 0.1, 2, 3);
  near(arrive.position.x, 0.05);
  assert.equal(stepToward({ x: 0, z: 0 }, { x: 0.01, z: 0 }, 0.1, 2, 3).walked, 0);
});
