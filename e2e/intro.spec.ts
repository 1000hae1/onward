import { expect, test } from "@playwright/test";

/**
 * 처음 온 분을 위한 소개 카드예요. 동물 고르기 앞에서 한 번 보이고, 돌아온 분에게는 보이지 않아요.
 * 로컬 개발 서버에서만 돌아요.
 */
const WARD_URL = "/?ward=96&debug=1";
const ENTER = "병실로 들어가기";

test("처음 온 분에게 소개 카드가 먼저 보이고, 누르면 동물 고르기로 가요", async ({ page }) => {
  await page.goto(WARD_URL);
  const intro = page.getByRole("dialog", { name: "오늘 밤, 옆 침대에 누군가 있어요" });
  await expect(intro).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#entry")).toBeHidden();
  // 캐릭터 그림은 꾸밈이라 alt가 비어 있어요.
  for (const alt of await intro.locator("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")))) {
    expect(alt).toBe("");
  }
  await expect(intro.locator(".intro-strong")).toHaveText("사과나무");
  const enter = page.getByRole("button", { name: ENTER });
  // 처음에는 대화상자에 포커스가 있고, Tab 한 번이면 버튼이에요.
  await expect(page.locator("#intro")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(enter).toBeFocused();
  // 휴대폰 한 화면에 스크롤 없이 들어가요.
  const scroll = await page.locator("#intro").evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(scroll).toBeLessThanOrEqual(0);

  await enter.click();
  await expect(page.locator("#intro")).toBeHidden();
  await expect(page.locator("#entry h1")).toHaveText("어떤 모습으로 머물까요?");
});

test("돌아온 분에게는 소개 카드 없이 바로 '돌아왔네요'예요", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 } });
  await context.addInitScript(() => {
    window.localStorage.setItem(
      "onward.profile",
      JSON.stringify({ species: "bear", outfit: "patient", nickname: "따뜻한 곰", nicknameAuto: false, withCat: false, hugsOff: false }),
    );
    window.localStorage.setItem("onward.token", `1.${"a".repeat(22)}.${"b".repeat(43)}`);
  });
  const page = await context.newPage();
  await page.goto(WARD_URL);
  await expect(page.locator("#entry h1")).toHaveText(/돌아왔네요/, { timeout: 30_000 });
  await expect(page.locator("#intro")).toBeHidden();
  await context.close();
});

test("설정의 [온기병동 소개]로 다시 보고, 닫으면 설정 버튼으로 돌아가요", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("onward.onboarding", "done"));
  await page.goto(WARD_URL);
  await page.getByRole("button", { name: ENTER }).click({ timeout: 30_000 });
  await page.locator("#entry-nickname").fill("소개곰");
  await page.getByRole("button", { name: "병동에 들어갈게요" }).click();

  await page.locator("#settings .settings-toggle").click();
  await page.getByRole("button", { name: "온기병동 소개" }).click();
  await expect(page.locator("#intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#intro")).toBeHidden();
  await expect(page.locator("#settings .settings-toggle")).toBeFocused();

  await page.locator("#settings .settings-toggle").click();
  await page.getByRole("button", { name: "온기병동 소개" }).click();
  await page.getByRole("button", { name: ENTER }).click();
  await expect(page.locator("#intro")).toBeHidden();
});
