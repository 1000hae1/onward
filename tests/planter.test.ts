import assert from "node:assert/strict";
import { test } from "vitest";
import { addPeace, formatCount, planterStage, planterText, PLANTER_STAGES } from "../shared/planter.ts";

test("누적 수에 따라 6단계로 자라요", () => {
  assert.equal(planterStage(0), 0);
  assert.equal(planterStage(29), 0);
  assert.equal(planterStage(30), 1);
  assert.equal(planterStage(99), 1);
  assert.equal(planterStage(100), 2);
  assert.equal(planterStage(300), 3);
  assert.equal(planterStage(999), 3);
  assert.equal(planterStage(1000), 4);
  assert.equal(planterStage(3000), 5);
  assert.equal(planterStage(1_000_000), 5);
  assert.equal(PLANTER_STAGES.length, 6);
});

test("단계가 오르는 순간만 grew예요", () => {
  assert.deepEqual(addPeace(28), { total: 29, stage: 0, grew: false });
  assert.deepEqual(addPeace(29), { total: 30, stage: 1, grew: true });
  assert.deepEqual(addPeace(30), { total: 31, stage: 1, grew: false });
});

test("줄어드는 일은 없어요", () => {
  assert.equal(addPeace(10, -5).total, 10);
  assert.equal(addPeace(10, 0.5).total, 10);
  assert.equal(addPeace(10, 3).total, 13);
});

test("화분을 누르면 쉼표가 들어간 누적 수를 보여 줘요", () => {
  assert.equal(formatCount(1234), "1,234");
  assert.equal(formatCount(1234567), "1,234,567");
  assert.equal(formatCount(12), "12");
  assert.equal(planterText(1234), "이 병실에 모인 평안 1,234");
});
