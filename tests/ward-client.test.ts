import assert from "node:assert/strict";
import { test } from "vitest";
import { retryDelaySeconds } from "../src/net/ward-client.ts";
import { readDebugFlag, readWardParams, wardLabel } from "../src/net/ward-params.ts";

test("끊기면 1초, 2초, 4초… 최대 30초 간격으로 다시 이어요", () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, attempt) => retryDelaySeconds(attempt)),
    [1, 2, 4, 8, 16, 30, 30, 30],
  );
});

test("처음에는 언제나 1번 병실부터 시도해요", () => {
  assert.deepEqual(readWardParams(""), { ward: 1, instance: 1 });
  assert.deepEqual(readWardParams("?ward=5"), { ward: 5, instance: 1 });
  assert.deepEqual(readWardParams("?ward=0&instance=99"), { ward: 1, instance: 1 });
});

test("상단에는 병동 이름과 접속자 수가 보여요", () => {
  assert.equal(wardLabel(1, 5, 30), "온기병동 1병동 · 5/30");
  assert.equal(wardLabel(1, null, 30), "온기병동 1병동");
});

test("디버그 표시는 ?debug=1일 때만 켜져요", () => {
  assert.equal(readDebugFlag("?debug=1"), true);
  assert.equal(readDebugFlag("?ward=2&debug=1"), true);
  assert.equal(readDebugFlag(""), false);
  assert.equal(readDebugFlag("?debug=0"), false);
  assert.equal(readDebugFlag("?debug=true"), false);
});
