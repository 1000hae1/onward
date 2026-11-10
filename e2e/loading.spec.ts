import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * '병동을 여는 중' 화면이에요. 고양이는 번들 없이도 보이고, 서버에 닿지 않으면 앉아서 [다시 시도]를 보여 줘요.
 * 로컬 개발 서버에서만 돌아요.
 */
const WARD_URL = "/?ward=97";

/** 지금 돌고 있는 애니메이션이 붙은 요소의 class 목록이에요. */
async function animatedParts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("#loading-cat .walk *")]
      .filter((el) => el.getAnimations().some((a) => a.playState === "running"))
      .map((el) => el.getAttribute("class") ?? ""),
  );
}

test("자바스크립트가 없어도 고양이와 막대가 보여요", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(WARD_URL);
  await expect(page.locator("#loading-cat svg.cat")).toBeVisible();
  await expect(page.locator("#loading .loading-title")).toHaveText("병동을 여는 중");
  await context.close();
});

test("서버에 닿지 않으면 앉아서 기다리고, 다시 시도하면 병동이 열려요", async ({ page }) => {
  let blocked = true;
  await page.route("**/api/health", (route) => (blocked ? route.abort() : route.continue()));
  await page.goto(WARD_URL);

  await expect(page.locator("#loading-error")).toBeVisible();
  await expect(page.locator("#loading-cat")).toHaveClass(/is-sitting/);
  await expect(page.locator("#loading .loading-track")).toBeHidden();

  blocked = false;
  await page.locator("#loading-retry").click();
  await expect(page.locator("#loading")).toHaveCount(0);
  await expect(page.locator("#entry")).toBeVisible();
});

test("진행될수록 걸음이 짧아져요", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/health", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(WARD_URL);
  const stride = () =>
    page.locator("#loading-cat .cat-roam").evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue("--stride")));
  // 3D 코드를 받으면 막대가 절반을 넘고 걸음은 0.55초보다 짧아져요.
  await expect.poll(() => page.locator("#loading .loading-track").getAttribute("aria-valuenow")).toBe("55");
  expect(await stride()).toBeLessThan(0.55);
  release();
  await expect(page.locator("#loading")).toHaveCount(0);
});

test("8초가 지나면 조금만 기다려 달라고 해요", async ({ page }) => {
  await page.route("**/api/health", () => undefined); // 대답하지 않아요
  await page.goto(WARD_URL);
  await expect(page.locator("#loading-slow")).toBeVisible({ timeout: 9_500 });
  await expect(page.locator("#loading-cat .cat-roam")).toHaveAttribute("style", /--stride: 0\.62s/);
});

test("움직임 줄이기에서는 가만히 서서 눈만 깜빡여요", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(WARD_URL);
  expect(await animatedParts(page)).toEqual(["eyes"]);
  await context.close();

  const normal = await browser.newContext({ javaScriptEnabled: false });
  const moving = await normal.newPage();
  await moving.goto(WARD_URL);
  expect((await animatedParts(moving)).length).toBeGreaterThan(5);
  await normal.close();
});
