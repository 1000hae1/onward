import assert from "node:assert/strict";
import { test } from "vitest";
import {
  currentSlot,
  kstHour,
  parseTimeOverride,
  slotForHour,
} from "../src/ward/time-of-day.ts";

test("시간대 경계: 06시와 18시와 22시에 바뀌어요", () => {
  assert.equal(slotForHour(5), "night");
  assert.equal(slotForHour(6), "day");
  assert.equal(slotForHour(17), "day");
  assert.equal(slotForHour(18), "evening");
  assert.equal(slotForHour(21), "evening");
  assert.equal(slotForHour(22), "night");
  assert.equal(slotForHour(23), "night");
  assert.equal(slotForHour(0), "night");
});

test("UTC 시각을 한국 시각으로 바꿔요", () => {
  assert.equal(kstHour(new Date("2026-11-05T00:00:00Z")), 9);
  assert.equal(kstHour(new Date("2026-11-05T14:59:59Z")), 23);
  assert.equal(kstHour(new Date("2026-11-05T15:00:00Z")), 0);
});

test("기기 시간대가 달라도 판정은 같아요", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(currentSlot(new Date("2026-11-05T13:30:00Z"), ""), "night");
    process.env.TZ = "Asia/Seoul";
    assert.equal(currentSlot(new Date("2026-11-05T13:30:00Z"), ""), "night");
  } finally {
    process.env.TZ = original;
  }
});

test("?time 값이 있으면 그 시간대를 보여줘요", () => {
  assert.equal(parseTimeOverride("?time=day"), "day");
  assert.equal(parseTimeOverride("?time=evening"), "evening");
  assert.equal(parseTimeOverride("?time=night"), "night");
  assert.equal(currentSlot(new Date("2026-11-05T03:00:00Z"), "?time=night"), "night");
});

test("잘못된 ?time 값은 무시하고 실제 한국 시간을 따라요", () => {
  assert.equal(parseTimeOverride(""), null);
  assert.equal(parseTimeOverride("?time="), null);
  assert.equal(parseTimeOverride("?time=NIGHT"), null);
  assert.equal(parseTimeOverride("?time=noon"), null);
  // 한국 시각 12시
  assert.equal(currentSlot(new Date("2026-11-05T03:00:00Z"), "?time=noon"), "day");
});
