import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  ANNOUNCE_GAP_MS,
  blessedMeText,
  bowText,
  giftForMeText,
  objectParticle,
  shouldAnnounce,
} from "../src/ui/announcer.ts";
import { contrastRatio, over, parseColor } from "../src/ui/contrast.ts";
import type { Rgba } from "../src/ui/contrast.ts";

const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

/** style.css에서 selector 규칙의 속성 값을 읽어요. 같은 selector가 여럿이면 마지막 값이에요. */
function cssValue(selector: string, property: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
  const blocks = [...CSS.matchAll(new RegExp(`(?:^|\\n|,\\s*)${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "g"))];
  let found: string | null = null;
  for (const block of blocks) {
    const match = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+);`).exec(block[1]);
    if (match) found = match[1].replace(/!important/, "").trim();
  }
  assert.ok(found, `${selector} { ${property} } 를 찾지 못했어요`);
  return found;
}

const WHITE: Rgba = [255, 255, 255, 1];
const DAY_SKY: Rgba = [200, 225, 245, 1];

/** 3D 화면 바로 위에 뜨는 글자예요. 뒤가 가장 밝은 흰 벽이나 낮 하늘이어도 읽혀야 해요. */
const OVERLAYS: { selector: string; color?: string }[] = [
  { selector: ".head-name" },
  { selector: "#hud" },
  { selector: "#toast" },
  { selector: "#notice" },
  { selector: "#settings .settings-toggle", color: cssValue("#settings button", "color") },
  { selector: ".ward-panel" },
  { selector: ".action-buttons button", color: cssValue("#settings button", "color") },
];

for (const { selector, color } of OVERLAYS) {
  test(`${selector} 글자는 밝은 장면 위에서도 대비가 4.5:1 이상이에요`, () => {
    const text = parseColor(color ?? cssValue(selector, "color"));
    const background = parseColor(cssValue(selector, "background"));
    assert.ok(text && background);
    for (const behind of [WHITE, DAY_SKY]) {
      const ratio = contrastRatio(text, over(background, behind));
      assert.ok(ratio >= 4.5, `${selector}: ${ratio.toFixed(2)}:1`);
    }
  });
}

test("대비 계산은 WCAG 값과 맞아요", () => {
  assert.equal(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1]).toFixed(1), "21.0");
  assert.equal(contrastRatio([119, 119, 119, 1], [255, 255, 255, 1]).toFixed(2), "4.48");
  assert.deepEqual(parseColor("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(parseColor("rgba(27, 36, 51, 0.8)"), [27, 36, 51, 0.8]);
  assert.equal(parseColor("red"), null);
});

test("같은 안내가 짧은 사이에 다시 오면 한 번만 읽어요", () => {
  assert.equal(shouldAnnounce(null, "가", 0), true);
  assert.equal(shouldAnnounce({ text: "가", at: 0 }, "가", ANNOUNCE_GAP_MS - 1), false);
  assert.equal(shouldAnnounce({ text: "가", at: 0 }, "가", ANNOUNCE_GAP_MS), true);
  assert.equal(shouldAnnounce({ text: "가", at: 0 }, "나", 1), true);
  assert.equal(shouldAnnounce(null, "  ", 0), false);
});

test("안내 문장은 받침에 맞춰 을/를을 붙여요", () => {
  assert.equal(objectParticle("귤"), "을");
  assert.equal(objectParticle("홍시"), "를");
  assert.equal(objectParticle("호빵"), "을");
  assert.equal(objectParticle("네잎클로버"), "를");
  assert.equal(giftForMeText("따뜻한 곰", "귤"), "따뜻한 곰님이 머리맡에 귤을 놓아 주었어요.");
  assert.equal(blessedMeText("따뜻한 곰"), "따뜻한 곰님이 평안을 빌어 주었어요.");
  assert.equal(bowText("따뜻한 곰", "평안하시길"), '따뜻한 곰님이 목례하며 "평안하시길" 하고 건넸어요.');
});
