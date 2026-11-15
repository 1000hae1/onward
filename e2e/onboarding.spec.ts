import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * 병아리 간호사의 첫 안내예요. 처음 들어온 분에게만 보이고, 건너뛰거나 끝내면 다시 나오지 않아요.
 * 새 게스트 한도(1시간 20명)에 걸리지 않게 시험 하나에 새 게스트 하나만 써요. 로컬 개발 서버에서만 돌아요.
 */
const WARD_URL = "/?ward=93&debug=1";
const SHOTS = process.env.ONBOARDING_SHOTS;

async function enterAsNew(page: Page, outfit: "환자" | "문병객" = "환자"): Promise<void> {
  await page.goto(WARD_URL);
  await page.getByRole("button", { name: "병실로 들어가기" }).click({ timeout: 30_000 });
  if (outfit === "문병객") await page.getByRole("button", { name: "문병객", exact: true }).click();
  await page.getByRole("button", { name: "병동에 들어갈게요" }).click();
}

/** 말풍선이 하단 버튼 줄(열린 확인 창 포함)과 겹치지 않는지 봐요. */
async function expectAboveActionBar(page: Page): Promise<void> {
  const bubble = await page.locator(".ob-bubble").boundingBox();
  const bar = await page.locator("#action-bar").boundingBox();
  expect(bubble).not.toBeNull();
  expect(bar).not.toBeNull();
  if (bubble && bar) expect(bubble.y + bubble.height).toBeLessThanOrEqual(bar.y);
}

test("처음 들어오면 1단계가 보이고, 건너뛰면 다시 나오지 않고, 설정에서 다시 볼 수 있어요", async ({ page }) => {
  await enterAsNew(page);
  const bubble = page.locator(".ob-bubble");
  await expect(bubble.locator(".ob-text")).toHaveText("빈 침대를 눌러 보세요", { timeout: 15_000 });
  // 시작 자리(병실 밖)에서는 병실에 들어가 보라는 작은 글이 붙어요.
  await expect(bubble.locator(".ob-sub")).toHaveText("병실에 들어가면 빈 침대가 보여요");
  await page.waitForTimeout(2500);
  await expectAboveActionBar(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onboarding-step1.png` });

  // [건너뛰기]는 이 단계만 넘겨요. 침대가 없어도 2단계를 볼 수 있어요.
  await bubble.getByRole("button", { name: "건너뛰기" }).click();
  await expect(bubble.locator(".ob-text")).toHaveText(/평안을/);
  // [안내 그만 보기]는 바로 끝내요.
  await bubble.getByRole("button", { name: "안내 그만 보기" }).click();
  await expect(bubble).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("onward.onboarding"))).toBe("skipped");

  // 다시 들어와도 나오지 않아요.
  await page.reload();
  await page.getByRole("button", { name: /들어갈게요/ }).click({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(page.locator(".ob-bubble")).toBeHidden();

  // 설정의 [안내 다시 보기]로 처음부터 다시 봐요.
  await page.locator("#settings .settings-toggle").click();
  await page.getByRole("button", { name: "안내 다시 보기" }).click();
  await expect(page.locator(".ob-bubble .ob-text")).toHaveText(/빈 침대를 눌러 보세요|평안을/);
  expect(await page.evaluate(() => localStorage.getItem("onward.onboarding"))).toBeNull();
});

test("문병객은 2단계부터예요. 평안 빌기가 반짝이고, 고르는 창이 열려도 말풍선이 겹치지 않아요", async ({ page }) => {
  await enterAsNew(page, "문병객");
  const bubble = page.locator(".ob-bubble");
  await expect(bubble.locator(".ob-text")).toHaveText("빈 침대에도 평안을 남길 수 있어요. 다음에 눕는 분께 닿아요", { timeout: 15_000 });
  const pray = page.getByRole("button", { name: "평안 빌기" });
  await expect(pray).toHaveClass(/onboard-glow/);

  await pray.click();
  await expect(page.locator(".action-sheet")).toBeVisible();
  await page.waitForTimeout(500);
  await expectAboveActionBar(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onboarding-step2-sheet.png` });

  await page.keyboard.press("Escape");
  // 건너뛰면 3단계(사과나무)예요. 평안 빌기는 더 반짝이지 않아요.
  await bubble.getByRole("button", { name: "건너뛰기" }).click();
  await expect(bubble.locator(".ob-text")).toHaveText("보고 싶은 얼굴들에게 사과나무를 보내 보세요");
  await expect(bubble.getByRole("button", { name: "🍎 내 사과나무" })).toBeVisible();
  await expect(pray).not.toHaveClass(/onboard-glow/);
  // 3단계도 건너뛰면 마지막 한마디 뒤에 끝나고, 끝까지 본 것으로 적어요.
  await bubble.getByRole("button", { name: "건너뛰기" }).click();
  await expect(bubble.locator(".ob-text")).toHaveText("편히 쉬다 가세요");
  await expect(bubble).toBeHidden({ timeout: 15_000 });
  expect(await page.evaluate(() => localStorage.getItem("onward.onboarding"))).toBe("done");
});

test("돌아온 분에게는 첫 안내가 나오지 않아요", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 } });
  await context.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    window.localStorage.setItem(
      "onward.profile",
      JSON.stringify({ species: "bear", outfit: "patient", nickname: "따뜻한 곰", nicknameAuto: false, withCat: false, hugsOff: false }),
    );
    window.localStorage.setItem("onward.token", `1.${"a".repeat(22)}.${"b".repeat(43)}`);
  });
  const page = await context.newPage();
  await page.goto(WARD_URL);
  await page.getByRole("button", { name: "이대로 들어갈게요" }).click({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(page.locator(".ob-bubble")).toBeHidden();
  // 이 기능 전부터 오던 분은 끝낸 것으로 적어 둬요.
  expect(await page.evaluate(() => localStorage.getItem("onward.onboarding"))).toBe("done");
  await context.close();
});
