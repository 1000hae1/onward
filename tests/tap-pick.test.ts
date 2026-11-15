import assert from "node:assert/strict";
import { test } from "vitest";
import { chooseTap, isTap, TAP_MAX_MOVE_PX, TAP_MAX_MS } from "../src/ward/tap-pick.ts";
import type { TapCandidate } from "../src/ward/tap-pick.ts";
import { hitBox } from "../src/ward/camera-view.ts";
import {
  appleTreeSpot,
  BED_BOXES,
  BED_LENGTH,
  BED_WIDTH,
  BEDS,
  DOOR,
  NIGHTSTANDS,
  WALL_BOXES,
  WALL_HEIGHT,
  WINDOW,
  CURTAIN_RAIL_Y,
  HEADER_Y,
} from "../shared/ward-layout.ts";

const object = (value: string, enter: number, exit = enter + 0.01): TapCandidate<string> => ({
  layer: "object",
  value,
  enter,
  exit,
});
/** cover는 시선이 실제 몸통에 닿는 비율이에요. null이면 넉넉한 부분만 지나요. */
const area = (value: string, enter: number, cover: number | null = enter): TapCandidate<string> => ({
  layer: "area",
  value,
  enter,
  cover,
});

test("손가락이 10px 이상 움직였거나 300ms 넘게 누르면 탭이 아니에요", () => {
  assert.equal(isTap(0, 0), true);
  assert.equal(isTap(TAP_MAX_MOVE_PX - 0.5, TAP_MAX_MS), true);
  assert.equal(isTap(TAP_MAX_MOVE_PX, 100), false);
  assert.equal(isTap(2, TAP_MAX_MS + 1), false);
});

test("아무것도 맞지 않으면 고르지 않아요", () => {
  assert.equal(chooseTap([]), null);
});

test("작은 것끼리는 가장 앞에 맞은 것 하나만 골라요", () => {
  assert.equal(chooseTap([object("고양이", 0.3), object("다른 동물", 0.2)])?.value, "다른 동물");
});

test("침대끼리도 가장 앞에 맞은 것 하나만 골라요", () => {
  assert.equal(chooseTap([area("뒤 침대", 0.4), area("앞 침대", 0.1)])?.value, "앞 침대");
});

test("침대 위에 앉은 고양이는 침대보다 먼저예요", () => {
  // 넉넉한 상자에 0.10에 들어가고, 고양이에 0.12에 닿은 뒤 이불(몸통)에 0.14에 닿아요.
  assert.equal(chooseTap([area("침대", 0.1, 0.14), object("고양이", 0.12)])?.value, "고양이");
  // 침대 앞에 선 동물도 먼저예요.
  assert.equal(chooseTap([area("침대", 0.1, 0.14), object("동물", 0.05)])?.value, "동물");
});

test("넉넉한 침대 상자 위만 지나 그 너머에 있는 사과나무는 사과나무가 먼저예요", () => {
  // 보이지 않는 넉넉한 부분만 지나고 침대 몸통에는 닿지 않아요.
  assert.equal(chooseTap([area("침대", 0.1, null), object("사과나무", 0.3)])?.value, "사과나무");
});

test("침대 몸통 뒤에 가려진 것은 침대가 먼저예요", () => {
  assert.equal(chooseTap([area("침대", 0.1, 0.12), object("뒤 동물", 0.3)])?.value, "침대");
});

test("침대 히트박스는 침대 모양보다 넉넉해요", () => {
  for (const box of BED_BOXES) {
    const width = box.maxX - box.minX;
    const depth = box.maxZ - box.minZ;
    const [short, long] = [Math.min(width, depth), Math.max(width, depth)];
    assert.ok(short > BED_WIDTH + 0.3, `폭 ${short}`);
    assert.ok(long > BED_LENGTH + 0.25, `길이 ${long}`);
  }
});

test("넉넉해진 침대 히트박스끼리 겹치지 않아요", () => {
  BED_BOXES.forEach((a, i) => {
    BED_BOXES.forEach((b, j) => {
      if (j <= i) return;
      const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
      assert.equal(overlap, false, `${i}번과 ${j}번`);
    });
  });
});

test("협탁과 사과나무 자리를 누르면 침대가 잡히지 않아요", () => {
  BEDS.forEach((bed, index) => {
    const box = BED_BOXES[index];
    const stand = NIGHTSTANDS[index];
    const tree = appleTreeSpot(bed);
    const inside = (x: number, z: number): boolean =>
      x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
    assert.equal(inside(stand.x, stand.z), false, `${index}번 협탁 가운데`);
    assert.equal(inside(tree.x, tree.z), false, `${index}번 사과나무 줄기`);
  });
});

test("침대 옆 바닥을 내려다보며 누르면 넉넉한 히트박스에 잡혀요", () => {
  const box = BED_BOXES[0];
  // 히트박스 가장자리 바로 안쪽이에요. 침대 모양 밖이지만 잡혀요.
  const x = box.minX + 0.05;
  const z = (box.minZ + box.maxZ) / 2;
  assert.equal(hitBox({ x, y: 3, z }, { x, y: -1, z }, BED_BOXES, WALL_BOXES)?.index, 0);
});

test("병실 문은 넓고 높아요. 창문, 커튼 레일, 문 위 벽은 천장 아래에 있어요", () => {
  assert.ok(DOOR.maxX - DOOR.minX >= 2.6);
  assert.ok(DOOR.height >= 3.5);
  assert.ok(DOOR.height < WALL_HEIGHT);
  assert.ok(WINDOW.maxY < WALL_HEIGHT);
  assert.ok(CURTAIN_RAIL_Y < WALL_HEIGHT);
  assert.ok(HEADER_Y < WALL_HEIGHT);
});

test("병실 안과 문턱은 그 병실이고, 복도는 어느 병실도 아니에요", async () => {
  const { doorSpots, roomIndexNear, ROOMS, DOOR_RECTS } = await import("../shared/ward-layout.ts");
  for (const room of ROOMS) {
    const { inside, outside } = doorSpots(room);
    assert.equal(roomIndexNear(inside.x, inside.z), room.index);
    assert.equal(roomIndexNear(outside.x, outside.z), null);
    const door = DOOR_RECTS[room.index];
    assert.equal(roomIndexNear((door.minX + door.maxX) / 2, (door.minZ + door.maxZ) / 2), room.index);
  }
});
