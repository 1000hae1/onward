import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

/**
 * 잠들기는 다른 사람에게도 보여요. 실제 서버(workerd)에 이어서 확인해요.
 * A는 WebSocket만 써서 침대에 눕고 잠들어요. B는 먼저 실제 화면으로 들어와 A의 이름표에 🌙가 붙는지 보고,
 * 화면을 닫은 뒤 같은 토큰으로 WebSocket만 다시 이어서 평안과 목례를 보내 봐요.
 * 다른 시험과 섞이지 않게 95병동을 쓰고, 새 게스트 한도에 걸리지 않게 지난번 토큰을 다시 써요.
 */
const WARD = 95;
const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), ".tokens.json");

type Frame = {
  type?: string;
  you?: string;
  token?: string;
  bedId?: number;
  people?: number;
  gifts?: number;
  guests?: { id: string; sleeping: boolean }[];
  event?: { kind?: string; id?: string; sleeping?: boolean; targetId?: string | null };
};

test.beforeAll(({ baseURL }) => {
  const host = new URL(baseURL ?? "").hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error("E2E는 로컬 개발 서버에서만 돌려요.");
});

function tokens(): Record<string, string> {
  try {
    return existsSync(TOKEN_FILE) ? (JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

interface Guest {
  id: string;
  frames: Frame[];
  send(message: Record<string, unknown>): void;
  waitFor(match: (frame: Frame) => boolean): Promise<Frame>;
  close(): void;
}

async function connect(baseURL: string, name: string, nickname: string): Promise<Guest> {
  const url = new URL(`/ws?ward=${WARD}&instance=1`, baseURL);
  url.protocol = "ws:";
  const socket = new WebSocket(url);
  const frames: Frame[] = [];
  const waiters: { match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }[] = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string" || event.data === "pong") return;
    const frame = JSON.parse(event.data) as Frame;
    frames.push(frame);
    if (frame.type === "guest-token" && frame.token) {
      writeFileSync(TOKEN_FILE, JSON.stringify({ ...tokens(), [name]: frame.token }));
    }
    for (const waiter of [...waiters]) {
      if (!waiter.match(frame)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  });
  const waitFor = (match: (frame: Frame) => boolean): Promise<Frame> => {
    const seen = frames.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      waiters.push({ match, resolve });
      setTimeout(() => reject(new Error(`${name}: 기다리던 메시지가 오지 않았어요. 받은 것: ${JSON.stringify(frames.map((frame) => frame.type))}`)), 10_000);
    });
  };
  const send = (message: Record<string, unknown>): void => socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error(`${name}: 이어지지 않았어요.`)));
  });
  const token = tokens()[name];
  send({ type: "hello", ...(token ? { token } : {}), animal: "rabbit", outfit: "patient", nickname, withCat: false });
  const snapshot = await waitFor((frame) => frame.type === "snapshot");
  return { id: snapshot.you as string, frames, send, waitFor, close: () => socket.close() };
}

/** 빈 침대를 하나 받아서 누워요. 지난 실행에서 맡아 둔 침대가 남아 있을 수 있어서 몇 개를 차례로 청해요. */
async function lieDown(guest: Guest): Promise<number> {
  for (const bed of [30, 31, 32, 33, 34, 35]) {
    guest.send({ type: "claim-bed", bedId: bed });
    const answer = await guest.waitFor((frame) => frame.bedId === bed && frame.type?.startsWith("bed-") === true);
    if (answer.type !== "bed-granted") continue;
    guest.frames.splice(guest.frames.indexOf(answer), 1);
    guest.send({ type: "lie-down", bedId: bed });
    expect((await guest.waitFor((frame) => frame.bedId === bed && frame.type?.startsWith("bed-") === true)).type).toBe("bed-granted");
    return bed;
  }
  throw new Error("빈 침대가 없어요.");
}

test("잠든 모습이 다른 사람에게 보이고, 평안은 쌓였다가 깨어날 때 전해져요", async ({ baseURL, browser }) => {
  const a = await connect(baseURL ?? "", "a", "잠꾸러기");
  const context = await browser.newContext({ viewport: { width: 390, height: 700 } });
  const savedB = tokens().b;
  if (savedB) {
    await context.addInitScript((value) => {
      if (!window.localStorage.getItem("onward.token")) window.localStorage.setItem("onward.token", value);
    }, savedB);
  }
  let c: Guest | null = null;
  try {
    // 서 있으면 잠들 수 없어요. 서버가 아무에게도 알리지 않아요.
    a.send({ type: "sleep", sleeping: true });
    await lieDown(a);
    a.send({ type: "sleep", sleeping: true });

    // B: 실제 화면으로 들어와요. 잠든 A의 이름표에 🌙(.asleep)가 붙어요.
    const page = await context.newPage();
    const pageFrames: Frame[] = [];
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string" || payload === "pong") return;
        try {
          pageFrames.push(JSON.parse(payload) as Frame);
        } catch {
          // 맞지 않는 글자는 건너뛰어요.
        }
      });
    });
    await page.goto(`/?ward=${WARD}&debug=1`);
    const input = page.locator("#entry-nickname");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill("살금곰");
    await page.getByRole("button", { name: "병동에 들어갈게요" }).click();
    await expect(page.locator("#debug-panel")).toContainText("연결 online");
    await expect(page.locator("#remote-labels .head-name.asleep")).toContainText("잠꾸러기");

    // A가 잠든 뒤에 들어온 B의 snapshot에 A가 잠든 채로 있어요.
    const snapshot = pageFrames.find((frame) => frame.type === "snapshot");
    expect(snapshot?.guests?.find((guest) => guest.id === a.id)?.sleeping).toBe(true);
    await context.close();

    // 같은 B가 WebSocket만으로 다시 들어와요(새 게스트를 만들지 않아요). 여기서도 A는 잠들어 있어요.
    c = await connect(baseURL ?? "", "b", "살금곰");
    const again = c.frames.find((frame) => frame.type === "snapshot");
    expect(again?.guests?.find((guest) => guest.id === a.id)?.sleeping).toBe(true);

    // B가 잠든 A에게 평안을 빌어요. B에게는 "살며시 두었어요", A에게는 bless가 가지 않아요.
    c.send({ type: "bless", targetId: a.id });
    await c.waitFor((frame) => frame.type === "kept-quiet");
    // 목례와 한마디도 잠든 A에게는 가지 않아요.
    c.frames.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    c.send({ type: "bow", phrase: 0 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(a.frames.some((frame) => frame.event?.kind === "bless" && frame.event.targetId === a.id)).toBe(false);
    expect(a.frames.some((frame) => frame.event?.kind === "bow")).toBe(false);

    // A가 깨어나면 다른 사람에게 한 번 알리고, A에게만 자는 동안 온 평안을 숫자로 전해요.
    a.send({ type: "sleep", sleeping: false });
    const summary = await a.waitFor((frame) => frame.type === "slept-summary");
    expect(summary.people).toBe(1);
    await c.waitFor((frame) => frame.event?.kind === "sleep" && frame.event.id === a.id && frame.event.sleeping === false);
    expect(c.frames.some((frame) => frame.type === "slept-summary")).toBe(false);
  } finally {
    a.close();
    c?.close();
    await context.close();
  }
});
