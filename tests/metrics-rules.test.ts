import assert from "node:assert/strict";
import { test } from "vitest";
import {
  cleanDepartures,
  clampStay,
  DEFAULT_METRICS_DAYS,
  departureOf,
  MAX_DEPARTURES_PER_REPORT,
  MAX_STAY_MS,
  readMetricsDays,
  sumDepartures,
  toMetricsView,
} from "../shared/metrics-rules.ts";

test("머문 시간은 0부터 12시간까지만 세요", () => {
  assert.equal(clampStay(-5), 0);
  assert.equal(clampStay(90_000), 90_000);
  assert.equal(clampStay(MAX_STAY_MS * 3), MAX_STAY_MS);
  assert.equal(clampStay(Number.NaN), 0);
});

test("입장 시각을 모르면 퇴장으로 세지 않아요", () => {
  assert.equal(departureOf({}, 1000), null);
  assert.deepEqual(departureOf({ joinedAt: 1000, blessings: 3 }, 61_000), { stayMs: 60_000, blessings: 3 });
  assert.deepEqual(departureOf({ joinedAt: 1000 }, 1000), { stayMs: 0, blessings: 0 });
});

test("병실이 보낸 퇴장 목록은 숫자만 남기고 개수를 제한해요", () => {
  assert.deepEqual(cleanDepartures("x"), []);
  assert.deepEqual(cleanDepartures([{ stayMs: 1.7, blessings: -2, nickname: "따뜻한 곰" }, null]), [{ stayMs: 1, blessings: 0 }]);
  const many = Array.from({ length: MAX_DEPARTURES_PER_REPORT + 10 }, () => ({ stayMs: 1, blessings: 1 }));
  assert.equal(cleanDepartures(many).length, MAX_DEPARTURES_PER_REPORT);
});

test("퇴장을 더해요", () => {
  assert.deepEqual(sumDepartures([]), { stayMs: 0, stays: 0, blessings: 0 });
  assert.deepEqual(
    sumDepartures([
      { stayMs: 60_000, blessings: 2 },
      { stayMs: 180_000, blessings: 0 },
    ]),
    { stayMs: 240_000, stays: 2, blessings: 2 },
  );
});

test("조회 일수는 1~400일만 받아요", () => {
  assert.equal(readMetricsDays(null), DEFAULT_METRICS_DAYS);
  assert.equal(readMetricsDays("7"), 7);
  assert.equal(readMetricsDays("400"), 400);
  assert.equal(readMetricsDays("0"), DEFAULT_METRICS_DAYS);
  assert.equal(readMetricsDays("401"), DEFAULT_METRICS_DAYS);
  assert.equal(readMetricsDays("1e3"), DEFAULT_METRICS_DAYS);
});

test("비율과 평균은 사람이 있을 때만 계산해요", () => {
  const view = toMetricsView({
    day: "2026-11-09",
    entries: 12,
    unique_guests: 8,
    returning_guests: 3,
    stay_ms: 3 * 600_000,
    stays: 3,
    blessings: 20,
    visit_entries: 2,
  });
  assert.deepEqual(view, {
    day: "2026-11-09",
    entries: 12,
    uniqueGuests: 8,
    returningRate: 0.375,
    avgStayMinutes: 10,
    blessings: 20,
    visitEntries: 2,
  });
  const empty = toMetricsView({ ...{ day: "d" }, entries: 0, unique_guests: 0, returning_guests: 0, stay_ms: 0, stays: 0, blessings: 0, visit_entries: 0 });
  assert.equal(empty.returningRate, null);
  assert.equal(empty.avgStayMinutes, null);
});
