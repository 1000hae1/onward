import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { loadingProgress, SLOW_STRIDE, strideFor } from "../src/ui/loading-screen.ts";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("막대는 끝난 일만큼 차고, 다 끝나면 1이에요", () => {
  assert.equal(loadingProgress({ code: false, server: false, built: false }), 0.05);
  assert.equal(loadingProgress({ code: true, server: false, built: false }), 0.55);
  assert.ok(Math.abs(loadingProgress({ code: false, server: true, built: false }) - 0.25) < 1e-9);
  assert.ok(Math.abs(loadingProgress({ code: true, server: true, built: false }) - 0.75) < 1e-9);
  assert.equal(loadingProgress({ code: true, server: true, built: true }), 1);
});

test("진행될수록 걸음이 0.55초에서 0.30초로 짧아져요", () => {
  assert.equal(strideFor(0), 0.55);
  assert.equal(strideFor(0.5), 0.43);
  assert.equal(strideFor(1), 0.3);
  assert.equal(strideFor(-1), 0.55);
  assert.equal(strideFor(2), 0.3);
  assert.ok(strideFor(0.2) > strideFor(0.8));
  assert.ok(SLOW_STRIDE > strideFor(0));
});

test("로딩 고양이는 번들 없이도 보이게 index.html에 바로 들어 있어요", () => {
  const main = /<main id="loading"[\s\S]*?<\/main>/.exec(HTML)?.[0] ?? "";
  assert.match(main, /<svg class="cat"/);
  assert.match(main, /<g class="walk">/);
  assert.match(main, /<g class="sit">/);
  assert.match(main, /id="loading-retry"/);
  assert.match(HTML, /<style>[\s\S]*@keyframes run-fore[\s\S]*<\/style>/);
  // 미리보기 데모와 예전 동물은 남아 있지 않아요.
  assert.doesNotMatch(HTML, /setInterval|loading-critter/);
});

test("움직임 줄이기에서는 눈 깜빡임만 남아요", () => {
  const blocks = [...HTML.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const stopped = blocks.join("\n");
  for (const part of ["bob", "head", "tail", "fore", "hind", "shadow", "dust", "breath"]) {
    assert.match(stopped, new RegExp(`\\.cat \\.${part}[,\\s]`), `.${part}가 멈추지 않아요`);
  }
  assert.doesNotMatch(stopped, /\.eyes/);
});
