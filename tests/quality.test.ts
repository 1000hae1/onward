import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createFpsProbe,
  hintsSayLight,
  judgeQuality,
  pixelRatioFor,
  simpleAvatarAt,
  SIMPLE_AVATAR_DISTANCE,
  snowFraction,
  snowSpeed,
  startQuality,
} from "../src/ward/quality.ts";
import { DEFAULT_VIEW, parseViewPrefs } from "../src/ui/view-prefs.ts";

test("메모리 2GB 이하나 코어 2개 이하면 재 보지 않아도 가볍게예요", () => {
  assert.equal(hintsSayLight({ deviceMemory: 2 }), true);
  assert.equal(hintsSayLight({ cores: 2 }), true);
  assert.equal(hintsSayLight({ deviceMemory: 4, cores: 8 }), false);
  // 알려 주지 않는 브라우저(사파리)는 프레임 속도로만 정해요.
  assert.equal(hintsSayLight({}), false);
});

test("직접 고른 값이 먼저예요. 자동이면 지난번 결과를 따라요", () => {
  assert.equal(startQuality("light", { deviceMemory: 8 }, "normal"), "light");
  assert.equal(startQuality("normal", { deviceMemory: 1 }, "light"), "normal");
  assert.equal(startQuality("auto", {}, null), "normal");
  assert.equal(startQuality("auto", {}, "light"), "light");
  assert.equal(startQuality("auto", { deviceMemory: 2 }, "normal"), "light");
});

test("처음 5초가 느리면 가볍게, 코어가 적으면 조금 더 일찍 가볍게예요", () => {
  assert.equal(judgeQuality(60, {}, "normal"), "normal");
  assert.equal(judgeQuality(39, {}, "normal"), "light");
  assert.equal(judgeQuality(45, { cores: 8 }, "normal"), "normal");
  assert.equal(judgeQuality(45, { cores: 4 }, "normal"), "light");
  assert.equal(judgeQuality(120, { deviceMemory: 2 }, "normal"), "light");
});

test("가볍게 그리는 중에는 충분히 빨라야 보통으로 돌아가요", () => {
  assert.equal(judgeQuality(50, {}, "light"), "light");
  assert.equal(judgeQuality(58, {}, "light"), "normal");
});

test("픽셀 비율은 보통이어도 최대 2, 가볍게면 최대 1.5예요", () => {
  assert.equal(pixelRatioFor("normal", 3, false), 2);
  assert.equal(pixelRatioFor("normal", 3, true), 1.75);
  assert.equal(pixelRatioFor("light", 3, true), 1.5);
  assert.equal(pixelRatioFor("light", 1, false), 1);
  assert.equal(pixelRatioFor("normal", 0, false), 1);
});

test("눈은 가볍게 보기나 움직임 줄이기면 1/3이고, 움직임 줄이기면 천천히 내려요", () => {
  assert.equal(snowFraction("normal", false), 1);
  assert.equal(snowFraction("light", false), 1 / 3);
  assert.equal(snowFraction("normal", true), 1 / 3);
  assert.equal(snowSpeed(false), 1);
  assert.ok(snowSpeed(true) > 0 && snowSpeed(true) < 1);
});

test("가볍게일 때만 먼 동물을 몸만 그려요", () => {
  assert.equal(simpleAvatarAt("light", SIMPLE_AVATAR_DISTANCE + 0.1), true);
  assert.equal(simpleAvatarAt("light", SIMPLE_AVATAR_DISTANCE - 0.1), false);
  assert.equal(simpleAvatarAt("normal", 100), false);
});

test("프레임 속도는 처음 0.5초를 빼고 5초 동안 재서 한 번만 알려요", () => {
  const probe = createFpsProbe(5, 0.5);
  let result: number | null = null;
  // 처음 0.5초는 아주 느려도 세지 않아요.
  for (let i = 0; i < 5; i++) assert.equal(probe.add(0.1), null);
  for (let i = 0; i < 300 && result === null; i++) result = probe.add(1 / 30);
  assert.ok(result !== null && Math.abs(result - 30) < 0.5);
  assert.equal(probe.done, true);
  assert.equal(probe.add(1 / 30), null);
});

test("탭이 숨겨졌다 돌아오면 처음부터 다시 재요", () => {
  const probe = createFpsProbe(1, 0);
  for (let i = 0; i < 5; i++) probe.add(1 / 10);
  probe.restart();
  let result: number | null = null;
  for (let i = 0; i < 200 && result === null; i++) result = probe.add(1 / 60);
  assert.ok(result !== null && Math.abs(result - 60) < 1);
});

test("보기 설정은 맞지 않는 칸만 기본값으로 둬요", () => {
  assert.deepEqual(parseViewPrefs(null), DEFAULT_VIEW);
  assert.deepEqual(parseViewPrefs("{"), DEFAULT_VIEW);
  assert.deepEqual(parseViewPrefs('{"quality":"light","largeText":true,"lastAuto":"normal"}'), {
    quality: "light",
    largeText: true,
    lastAuto: "normal",
  });
  assert.deepEqual(parseViewPrefs('{"quality":"ultra","largeText":"yes","lastAuto":3}'), DEFAULT_VIEW);
});
