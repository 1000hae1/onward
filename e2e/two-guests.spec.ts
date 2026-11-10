import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

/**
 * 가장 기본 흐름: 두 사람이 입장 → 서로 보이기 → A가 B에게 평안 빌기 → B에게 도착.
 * 로컬 개발 서버에서만 돌아요. 수동 테스트와 섞이지 않게 97병동을 써요.
 */
const WARD_URL = "/?ward=97&debug=1";
const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), ".tokens.json");

type Frame = { type?: string; you?: string; event?: { kind?: string; id?: string; targetId?: string } };

test.beforeAll(({ baseURL }) => {
  // 배포 주소에서 돌면 실제 사용자 병동에 시험 손님이 생겨요. 로컬에서만 돌아요.
  const host = new URL(baseURL ?? "").hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error("E2E는 로컬 개발 서버에서만 돌려요.");
});

/**
 * 새 게스트는 IP마다 1시간에 20명까지라서, 지난번 토큰을 다시 써서 같은 사람으로 들어가요.
 * 토큰 파일은 git에 올라가지 않아요(.gitignore).
 */
function savedTokens(): Record<string, string> {
  try {
    return existsSync(TOKEN_FILE) ? (JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function openGuest(browser: Browser, name: string) {
  // 휴대폰만 한 작은 화면이에요. 헤드리스 브라우저가 그릴 양이 줄어서 조작이 멈추지 않아요.
  const context = await browser.newContext({ viewport: { width: 390, height: 700 } });
  const token = savedTokens()[name];
  if (token) {
    await context.addInitScript((value) => {
      if (!window.localStorage.getItem("onward.token")) window.localStorage.setItem("onward.token", value);
    }, token);
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`[${name}] 화면 오류:`, error.message));
  const frames: Frame[] = [];
  const raw: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || payload === "pong") return;
      raw.push(payload);
      try {
        frames.push(JSON.parse(payload) as Frame);
      } catch {
        // 맞지 않는 글자는 건너뛰어요.
      }
    });
  });
  return { context, page, frames, raw };
}

async function enter(page: Page, nickname: string): Promise<void> {
  await page.goto(WARD_URL);
  const input = page.locator("#entry-nickname");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(nickname);
  await page.getByRole("button", { name: "병동에 들어갈게요" }).click();
  await expect(page.locator("#debug-panel")).toContainText("연결 online");
}

test("두 사람이 서로 보이고, 평안 빌기가 상대에게 도착해요", async ({ browser }) => {
  const a = await openGuest(browser, "a");
  const b = await openGuest(browser, "b");
  try {
    await enter(a.page, "가람토끼");
    await enter(b.page, "나래곰");

    // 서로 보이기: 상대의 머리 위 닉네임이 내 화면에 있어요.
    await expect(a.page.locator("#remote-labels")).toContainText("나래곰");
    await expect(b.page.locator("#remote-labels")).toContainText("가람토끼");

    const bId = b.frames.find((frame) => frame.type === "snapshot")?.you;
    expect(bId, "B가 snapshot에서 공개 번호를 받아요").toMatch(/^[a-z0-9]{8}$/);

    // A가 [평안 빌기] → [자리에 없는 분께 남기기] → 나래곰
    await a.page.getByRole("button", { name: "평안 빌기" }).click();
    await a.page.getByRole("button", { name: "자리에 없는 분께 남기기" }).click();
    await a.page.getByRole("button", { name: /^나래곰/ }).click();

    // B에게 나를 향한 bless 이벤트가 도착해요.
    await expect
      .poll(() => b.frames.some((frame) => frame.event?.kind === "bless" && frame.event.targetId === bId))
      .toBe(true);

    // 덤: 남에게서 온 메시지에 guestId나 남의 토큰이 없어요(guest-token은 나에게만 오는 내 토큰이에요).
    const leaked = b.raw.filter((text) => !text.includes('"type":"guest-token"') && /guestId|"token"/.test(text));
    expect(leaked).toEqual([]);

    // 다음 실행 때 같은 사람으로 들어가려고 토큰을 남겨요.
    const tokens: Record<string, string> = {};
    for (const [name, guest] of [["a", a], ["b", b]] as const) {
      const saved = await guest.page.evaluate(() => window.localStorage.getItem("onward.token"));
      if (saved) tokens[name] = saved;
    }
    mkdirSync(dirname(TOKEN_FILE), { recursive: true });
    writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
