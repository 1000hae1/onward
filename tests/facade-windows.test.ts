import assert from "node:assert/strict";
import { test } from "vitest";
import { facadeWindowCenters, mirrorPairIndex } from "../src/ward/facade-windows.ts";
import { BUILDING } from "../shared/ward-layout.ts";

const OPTIONS = { spacing: 3.6, width: 2.2, margin: 0.6 };

const faces = [
  { name: "앞뒤", from: BUILDING.minX, to: BUILDING.maxX },
  { name: "옆", from: BUILDING.minZ, to: BUILDING.maxZ },
];

for (const face of faces) {
  test(`${face.name}면의 창은 모두 벽 안에 있어요`, () => {
    const centers = facadeWindowCenters(face.from, face.to, OPTIONS);
    assert.ok(centers.length > 0);
    for (const center of centers) {
      assert.ok(center - OPTIONS.width / 2 >= face.from + OPTIONS.margin - 1e-9, `${center}의 왼쪽 끝이 벽 밖이에요`);
      assert.ok(center + OPTIONS.width / 2 <= face.to - OPTIONS.margin + 1e-9, `${center}의 오른쪽 끝이 벽 밖이에요`);
    }
  });

  test(`${face.name}면의 창은 벽 가운데를 기준으로 대칭이에요`, () => {
    const centers = facadeWindowCenters(face.from, face.to, OPTIONS);
    const middle = (face.from + face.to) / 2;
    const n = centers.length;
    for (let i = 0; i < n; i++) {
      assert.ok(Math.abs(centers[i] - middle + (centers[n - 1 - i] - middle)) < 1e-9);
    }
  });
}

test("앞면은 가운데를 기준으로 ±1.8, ±5.4, ±9.0에 창이 있어요", () => {
  const centers = facadeWindowCenters(BUILDING.minX, BUILDING.maxX, OPTIONS).map((x) => Math.round(x * 10) / 10);
  assert.deepEqual(centers, [-9, -5.4, -1.8, 1.8, 5.4, 9]);
});

test("벽이 창보다 좁으면 창을 두지 않아요", () => {
  assert.deepEqual(facadeWindowCenters(0, 2, OPTIONS), []);
});

test("마주 보는 창은 같은 짝 번호예요", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => mirrorPairIndex(i, 6)), [0, 1, 2, 2, 1, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => mirrorPairIndex(i, 5)), [0, 1, 2, 1, 0]);
});
