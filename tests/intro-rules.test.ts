import assert from "node:assert/strict";
import { test } from "vitest";
import { INTRO_TEXT, shouldShowIntro, splitStrong } from "../src/ui/intro-rules";

test("처음 온 분에게만 소개 카드를 보여 줘요", () => {
  assert.equal(shouldShowIntro({ returning: false, viaLink: false }), true);
});

test("돌아온 분은 소개 없이 바로 입장 화면이에요", () => {
  assert.equal(shouldShowIntro({ returning: true, viaLink: false }), false);
});

test("방명록·문병 링크로 온 분에게는 보여 주지 않아요", () => {
  assert.equal(shouldShowIntro({ returning: false, viaLink: true }), false);
  assert.equal(shouldShowIntro({ returning: true, viaLink: true }), false);
});

test("굵은 낱말을 기준으로 나눠요", () => {
  assert.deepEqual(splitStrong("가 사과나무 나", "사과나무"), { before: "가 ", strong: "사과나무", after: " 나" });
  assert.deepEqual(splitStrong("가나다", "없음"), { before: "가나다", strong: "", after: "" });
  assert.deepEqual(splitStrong("가나다"), { before: "가나다", strong: "", after: "" });
});

test("강조 항목은 사과나무 하나이고, 굵은 낱말은 글 안에 있어요", () => {
  const highlighted = INTRO_TEXT.items.filter((item) => item.highlight);
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0].icon, "tree");
  for (const item of INTRO_TEXT.items) {
    if ("strong" in item) assert.ok(item.text.includes(item.strong));
  }
});

test("쓰지 않기로 한 말은 없어요", () => {
  const all = [INTRO_TEXT.title, INTRO_TEXT.subtitle, INTRO_TEXT.enter, ...INTRO_TEXT.items.map((item) => item.text)].join(" ");
  assert.ok(!all.includes("괜찮아요?"));
  assert.ok(!all.includes("힘내요"));
});
