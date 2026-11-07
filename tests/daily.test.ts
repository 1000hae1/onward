import assert from "node:assert/strict";
import { test } from "vitest";
import {
  countNight,
  IDLE_LIMIT_MS,
  lightsOutText,
  msUntilLightsOut,
  nextSlotChange,
  nightKey,
  nightOrdinal,
  nightsText,
  NO_NIGHTS,
  parseNightRecord,
  shouldPause,
  statsLine,
} from "../shared/daily.ts";
import { kstHour, slotForHour } from "../src/ward/time-of-day.ts";

/** 한국 시각으로 시각을 만들어요. */
const kst = (date: string, hour: number, minute = 0) =>
  Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`);

test("소등은 한국 시간 22시예요. 기기 시간대와 상관없어요", () => {
  assert.equal(msUntilLightsOut(kst("2026-11-07", 21, 59)), 60_000);
  assert.equal(msUntilLightsOut(kst("2026-11-07", 22, 0)), 24 * 3_600_000);
  assert.equal(msUntilLightsOut(kst("2026-11-08", 1, 0)), 21 * 3_600_000);
});

test("다음 시간대 바뀜은 6시, 18시, 22시예요", () => {
  assert.equal(nextSlotChange(kst("2026-11-07", 21, 30)), kst("2026-11-07", 22));
  assert.equal(nextSlotChange(kst("2026-11-07", 23)), kst("2026-11-08", 6));
  assert.equal(nextSlotChange(kst("2026-11-07", 3)), kst("2026-11-07", 6));
  assert.equal(nextSlotChange(kst("2026-11-07", 6)), kst("2026-11-07", 18));
  // 바뀌는 순간 바로 앞뒤로 기존 시간대 판정과 맞아요.
  for (const at of [kst("2026-11-07", 6), kst("2026-11-07", 18), kst("2026-11-07", 22)]) {
    assert.notEqual(slotForHour(kstHour(new Date(at - 1))), slotForHour(kstHour(new Date(at))));
  }
});

test("22시부터 다음 날 6시까지는 같은 밤이에요", () => {
  assert.equal(nightKey(kst("2026-11-07", 21, 59)), null);
  assert.equal(nightKey(kst("2026-11-07", 22)), "2026-11-07");
  assert.equal(nightKey(kst("2026-11-08", 2)), "2026-11-07");
  assert.equal(nightKey(kst("2026-11-08", 5, 59)), "2026-11-07");
  assert.equal(nightKey(kst("2026-11-08", 6)), null);
  // 해가 바뀌는 밤도 시작한 날짜로 세요.
  assert.equal(nightKey(kst("2027-01-01", 1)), "2026-12-31");
});

test("함께한 밤은 같은 밤을 두 번 세지 않고, 줄지 않아요", () => {
  let record = countNight(NO_NIGHTS, "2026-11-07");
  record = countNight(record, "2026-11-07");
  assert.deepEqual(record, { count: 1, lastNight: "2026-11-07" });
  // 며칠을 건너뛰어도 그대로 이어서 세요. 연속 기록이 아니에요.
  record = countNight(record, "2026-11-20");
  assert.equal(record.count, 2);
  assert.equal(nightOrdinal(record, "2026-11-20"), 2);
  assert.equal(nightOrdinal(record, "2026-11-21"), 3);
});

test("저장된 기록이 망가졌으면 처음부터예요", () => {
  assert.deepEqual(parseNightRecord(null), NO_NIGHTS);
  assert.deepEqual(parseNightRecord("{"), NO_NIGHTS);
  assert.deepEqual(parseNightRecord(JSON.stringify({ count: -3, lastNight: "x" })), NO_NIGHTS);
  assert.deepEqual(parseNightRecord(JSON.stringify({ count: 14, lastNight: "2026-11-07" })), { count: 14, lastNight: "2026-11-07" });
});

test("20분 동안 누르지 않으면 연결을 닫고, 수면 모드는 예외예요", () => {
  assert.equal(shouldPause(0, IDLE_LIMIT_MS - 1, false), false);
  assert.equal(shouldPause(0, IDLE_LIMIT_MS, false), true);
  assert.equal(shouldPause(0, IDLE_LIMIT_MS * 10, true), false);
});

test("문구는 부드러운 해요체예요", () => {
  assert.equal(statsLine(12, 128), "오늘 다녀간 동물 12마리 · 모인 평안 128");
  assert.equal(lightsOutText(5), "소등 시간이에요. 오늘 밤 함께 잠드는 분 5명");
  assert.equal(nightsText({ count: 13, lastNight: "2026-11-06" }, "2026-11-07"), "함께한 밤 14번째예요");
  assert.equal(nightsText({ count: 14, lastNight: "2026-11-07" }, "2026-11-07"), "함께한 밤 14번째예요");
  assert.equal(nightsText({ count: 14, lastNight: "2026-11-07" }, null), "지금까지 함께한 밤 14번이에요");
  assert.equal(nightsText(NO_NIGHTS, null), null);
});
