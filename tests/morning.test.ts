import assert from "node:assert/strict";
import { test } from "vitest";
import { isMorningWindow, MORNING_PHRASE, morningEndsAt, phraseAllowed, shouldOpenWindow } from "../shared/morning.ts";
import { BLESSINGS } from "../shared/gestures.ts";

const kst = (time: string): number => Date.parse(`2026-11-08T${time}+09:00`);

test("아침 창문은 한국 시간 06:30부터 09:00 전까지예요", () => {
  assert.equal(isMorningWindow(kst("06:29:59")), false);
  assert.equal(isMorningWindow(kst("06:30:00")), true);
  assert.equal(isMorningWindow(kst("08:59:59")), true);
  assert.equal(isMorningWindow(kst("09:00:00")), false);
  assert.equal(isMorningWindow(kst("22:00:00")), false);
});

test("기기 시간대와 상관없이 UTC로 계산해요", () => {
  // 한국 07:00은 UTC 전날 22:00이에요.
  assert.equal(isMorningWindow(Date.parse("2026-11-07T22:00:00Z")), true);
});

test("아침이 끝나는 시각은 그날 09:00이에요", () => {
  assert.equal(morningEndsAt(kst("07:10:00")), kst("09:00:00"));
  assert.equal(morningEndsAt(kst("12:00:00")), null);
});

test("좋은 아침이에요(5번)는 아침에만 보낼 수 있어요", () => {
  assert.equal(BLESSINGS[MORNING_PHRASE], "좋은 아침이에요");
  assert.equal(phraseAllowed(MORNING_PHRASE, kst("07:00:00")), true);
  assert.equal(phraseAllowed(MORNING_PHRASE, kst("10:00:00")), false);
  assert.equal(phraseAllowed(0, kst("10:00:00")), true);
});

test("창문은 아침에 그날 처음 들어온 사람이 있을 때 한 번만 열려요", () => {
  assert.equal(shouldOpenWindow(kst("07:00:00"), false), true);
  assert.equal(shouldOpenWindow(kst("07:00:00"), true), false);
  assert.equal(shouldOpenWindow(kst("11:00:00"), false), false);
});
