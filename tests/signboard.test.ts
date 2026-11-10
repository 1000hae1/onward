import assert from "node:assert/strict";
import { test } from "vitest";
import {
  SIGN_FRAME,
  SIGN_MOON,
  SIGN_STARS,
  SIGN_SUBTITLE,
  SIGN_TEXTURE,
  SIGN_TITLE,
  STAR_CLEARANCE,
  circleBoxGap,
  circleGap,
  easeLit,
  signLitFor,
  starOpacity,
  stepLit,
  twinkleOpacity,
} from "../src/ward/signboard-layout.ts";

test("낮에는 불 꺼진 간판, 저녁과 소등 시간에는 불 켜진 간판이에요", () => {
  assert.equal(signLitFor("day"), false);
  assert.equal(signLitFor("evening"), true);
  assert.equal(signLitFor("night"), true);
});

test("불은 2초 동안 켜지고 꺼져요", () => {
  let lit = 0;
  for (let i = 0; i < 19; i++) lit = stepLit(lit, 1, 0.1);
  assert.ok(lit > 0.9 && lit < 1);
  lit = stepLit(lit, 1, 0.1);
  assert.equal(lit, 1);
  assert.equal(stepLit(1, 0, 1), 0.5);
  assert.equal(stepLit(0.2, 0, 5), 0);
  assert.equal(easeLit(0), 0);
  assert.equal(easeLit(1), 1);
  assert.equal(easeLit(0.5), 0.5);
});

test("별은 점 별 16개와 십자 별 4개예요", () => {
  assert.equal(SIGN_STARS.length, 20);
  assert.equal(SIGN_STARS.filter((star) => star.kind === "dot").length, 16);
  assert.equal(SIGN_STARS.filter((star) => star.kind === "sparkle").length, 4);
});

test("별은 글자와 달을 가리지 않고 테두리 안에 있어요", () => {
  const { border } = SIGN_FRAME;
  for (const star of SIGN_STARS) {
    const where = `${star.kind} (${star.x}, ${star.y})`;
    assert.ok(circleGap(star, SIGN_MOON) >= STAR_CLEARANCE, `${where}이 달에 붙어 있어요`);
    assert.ok(circleBoxGap(star, SIGN_TITLE) >= STAR_CLEARANCE, `${where}이 큰 글자에 붙어 있어요`);
    assert.ok(circleBoxGap(star, SIGN_SUBTITLE) >= STAR_CLEARANCE, `${where}이 작은 문구에 붙어 있어요`);
    assert.ok(star.x - star.r >= border + 8 && star.x + star.r <= SIGN_TEXTURE.width - border - 8, where);
    assert.ok(star.y - star.r >= border + 8 && star.y + star.r <= SIGN_TEXTURE.height - border - 8, where);
  }
});

test("글자와 달도 서로 겹치지 않아요", () => {
  assert.ok(circleBoxGap(SIGN_MOON, SIGN_TITLE) > 0);
  assert.ok(circleBoxGap(SIGN_MOON, SIGN_SUBTITLE) > 0);
  assert.ok(SIGN_TITLE.y + SIGN_TITLE.h <= SIGN_SUBTITLE.y);
});

test("별 크기와 밝기는 조금씩 달라요", () => {
  const dots = SIGN_STARS.filter((star) => star.kind === "dot");
  assert.ok(new Set(dots.map((star) => star.r)).size >= 4);
  assert.ok(new Set(dots.map((star) => star.bright)).size >= 6);
});

test("별 투명도는 낮과 밤의 범위 안이에요", () => {
  for (const star of SIGN_STARS) {
    const day = starOpacity(star, false);
    const night = starOpacity(star, true);
    if (star.kind === "dot") {
      assert.ok(day >= 0.5 && day <= 0.7);
      assert.ok(night >= 0.7 && night <= 1);
    } else {
      assert.ok(day >= 0.75 && day <= 0.85);
      assert.equal(night, 1);
    }
  }
});

test("반짝이는 별은 몇 개뿐이고 3~5초마다 서로 다른 박자로 반짝여요", () => {
  const twinkling = SIGN_STARS.filter((star) => star.twinkle);
  assert.ok(twinkling.length >= 4 && twinkling.length <= 8);
  for (const star of twinkling) {
    assert.ok(star.twinkle!.period >= 3 && star.twinkle!.period <= 5);
  }
  const beats = new Set(twinkling.map((star) => `${star.twinkle!.period}:${star.twinkle!.phase}`));
  assert.equal(beats.size, twinkling.length);
});

test("반짝임은 밝아졌다 어두워지고, 저사양에서는 멈춰요", () => {
  const star = SIGN_STARS.find((candidate) => candidate.twinkle)!;
  const values = Array.from({ length: 50 }, (_, i) => twinkleOpacity(star, (i / 50) * star.twinkle!.period, true));
  const base = starOpacity(star, true);
  assert.ok(Math.max(...values) > base * 0.95);
  assert.ok(Math.min(...values) < base * 0.5);
  for (let t = 0; t < 10; t += 0.7) assert.equal(twinkleOpacity(star, t, false), base);
  const still = SIGN_STARS.find((candidate) => !candidate.twinkle)!;
  assert.equal(twinkleOpacity(still, 2.3, true), starOpacity(still, true));
});
