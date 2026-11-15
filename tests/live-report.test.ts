import assert from "node:assert/strict";
import { test } from "vitest";
import { LIVE_REPORT_URL, liveCount, liveReport } from "../worker/live-report.ts";

test("METAMOA_KEY가 없거나 비어 있으면 보내지 않고 건너뛰어요", () => {
  assert.deepEqual(liveReport(3, undefined), { kind: "skip", reason: "no-key" });
  assert.deepEqual(liveReport(3, ""), { kind: "skip", reason: "no-key" });
  assert.deepEqual(liveReport(3, "   "), { kind: "skip", reason: "no-key" });
});

test("키가 있으면 메타모아 주소로 Bearer 키와 JSON 본문을 보내요", () => {
  const report = liveReport(7, "test-key");
  assert.equal(report.kind, "send");
  if (report.kind !== "send") return;
  assert.equal(report.url, LIVE_REPORT_URL);
  assert.equal(report.init.method, "POST");
  assert.deepEqual(report.init.headers, { Authorization: "Bearer test-key", "Content-Type": "application/json" });
});

test("본문에는 접속자 수(count) 하나만 들어가요", () => {
  const report = liveReport(12, "test-key");
  if (report.kind !== "send") assert.fail("보내야 해요");
  assert.deepEqual(JSON.parse(report.init.body), { count: 12 });
  assert.deepEqual(Object.keys(JSON.parse(report.init.body)), ["count"]);
});

test("접속자 수는 0 이상의 정수로 다듬어요", () => {
  assert.equal(liveCount(4.7), 4);
  assert.equal(liveCount(-2), 0);
  assert.equal(liveCount(Number.NaN), 0);
  assert.equal(liveCount("5"), 0);
  assert.equal(liveCount(undefined), 0);
});
