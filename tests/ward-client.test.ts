import assert from "node:assert/strict";
import { test } from "vitest";
import { retryDelaySeconds } from "../src/net/ward-client.ts";
import { readWardParams, wardLabel } from "../src/net/ward-params.ts";

test("끊기면 1초, 2초, 4초… 최대 30초 간격으로 다시 이어요", () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, attempt) => retryDelaySeconds(attempt)),
    [1, 2, 4, 8, 16, 30, 30, 30],
  );
});

test("처음에는 언제나 1번 병실부터 시도해요", () => {
  assert.deepEqual(readWardParams(""), { ward: 3, instance: 1 });
  assert.deepEqual(readWardParams("?ward=5"), { ward: 5, instance: 1 });
  assert.deepEqual(readWardParams("?ward=0&instance=99"), { ward: 3, instance: 1 });
});

test("상단에는 병동 이름과 접속자 수가 보여요", () => {
  assert.equal(wardLabel(3, 5, 30), "onWard 3병동 · 5/30");
  assert.equal(wardLabel(3, null, 30), "onWard 3병동");
});
