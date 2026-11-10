import assert from "node:assert/strict";
import { test } from "vitest";
import { retryDelaySeconds } from "../src/net/ward-client.ts";
import { formatSeat, parseSeat, readDebugFlag, readWardParams, wardLabel } from "../src/net/ward-params.ts";

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

test("상단에는 병동 이름과 접속자 수가 \"3병동 · 4/30\"처럼 보여요", () => {
  assert.equal(wardLabel(3, 1, 4, 30), "3병동 · 4/30");
  assert.equal(wardLabel(2, 1, null, 30), "2병동");
  // 1호가 아니면 두 기기가 같은 곳인지 견줘 보게 호수를 붙여요.
  assert.equal(wardLabel(2, 3, 5, 30), "2병동 3호 · 5/30");
});

test("서버에 닿지 않으면 상단에 혼자 머무는 중이라고 보여요", () => {
  assert.equal(wardLabel(1, 1, null, 30, true), "1병동 · 혼자 머무는 중");
  // 인원을 알면 혼자가 아니에요.
  assert.equal(wardLabel(1, 1, 2, 30, true), "1병동 · 2/30");
});

test("기억되는 자리는 병동·병실·침대 번호만 담고, 모양이 틀리면 버려요", () => {
  const seat = { ward: 3, instance: 2, bed: 17 };
  assert.deepEqual(parseSeat(formatSeat(seat), 36), seat);
  assert.equal(parseSeat(null, 36), null);
  assert.equal(parseSeat("3.2.36", 36), null);
  assert.equal(parseSeat("0.1.1", 36), null);
  assert.equal(parseSeat("3.21.1", 36), null);
  assert.equal(parseSeat("<b>.1.1", 36), null);
});

test("주소에 병실이 없으면 같은 병동의 기억되는 병실로 가요", () => {
  const seat = { ward: 3, instance: 2, bed: 17 };
  assert.deepEqual(readWardParams("?ward=3", seat), { ward: 3, instance: 2 });
  // 주소에 적힌 병실이 먼저예요.
  assert.deepEqual(readWardParams("?ward=3&instance=4", seat), { ward: 3, instance: 4 });
  // 다른 병동이면 기억한 자리를 쓰지 않아요.
  assert.deepEqual(readWardParams("?ward=5", seat), { ward: 5, instance: 1 });
  assert.deepEqual(readWardParams("", null), { ward: 1, instance: 1 });
});

test("디버그 표시는 ?debug=1일 때만 켜져요", () => {
  assert.equal(readDebugFlag("?debug=1"), true);
  assert.equal(readDebugFlag("?ward=2&debug=1"), true);
  assert.equal(readDebugFlag(""), false);
  assert.equal(readDebugFlag("?debug=0"), false);
  assert.equal(readDebugFlag("?debug=true"), false);
});
