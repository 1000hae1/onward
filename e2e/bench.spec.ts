import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

/**
 * 앞마당 벤치 자리는 서버가 정해요. 두 사람이 실제 서버(workerd)에 이어서 같은 자리를 다퉈 봐요.
 * 화면 없이 WebSocket만 써요. 다른 시험과 섞이지 않게 96병동을 쓰고, 새 게스트 한도에 걸리지 않게 two-guests와 같은 토큰을 써요.
 */
const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), ".tokens.json");

type Frame = { type?: string; you?: string; token?: string; seat?: number; event?: { kind?: string; id?: string; seat?: number } };

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
  const url = new URL("/ws?ward=96&instance=1", baseURL);
  url.protocol = "ws:";
  const socket = new WebSocket(url);
  const frames: Frame[] = [];
  const waiters: { match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }[] = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string" || event.data === "pong") return;
    const frame = JSON.parse(event.data) as Frame;
    frames.push(frame);
    if (frame.type === "guest-token" && frame.token) {
      // 새 게스트는 IP마다 한 시간에 20명까지라서, 받은 토큰을 다음에 다시 써요.
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

test("같은 벤치 자리는 먼저 온 사람만 앉고, 다른 사람에게 앉고 일어나는 모습이 보여요", async ({ baseURL }) => {
  const a = await connect(baseURL ?? "", "a", "벤치토끼");
  const b = await connect(baseURL ?? "", "b", "벤치곰돌");
  try {
    a.send({ type: "sit", seat: 0 });
    expect((await a.waitFor((frame) => frame.type?.startsWith("seat-") === true)).type).toBe("seat-granted");
    await b.waitFor((frame) => frame.event?.kind === "sit" && frame.event.id === a.id && frame.event.seat === 0);

    // 같은 자리는 받지 못하고, 옆자리는 앉을 수 있어요.
    b.send({ type: "sit", seat: 0 });
    expect((await b.waitFor((frame) => frame.type === "seat-unavailable" || frame.type === "seat-granted")).type).toBe(
      "seat-unavailable",
    );
    b.send({ type: "sit", seat: 1 });
    await b.waitFor((frame) => frame.type === "seat-granted" && frame.seat === 1);
    await a.waitFor((frame) => frame.event?.kind === "sit" && frame.event.id === b.id && frame.event.seat === 1);

    // 걸어가면 일어나요. 비워진 자리는 다른 사람이 앉을 수 있어요.
    a.send({ type: "walk-to", x: 0, z: 30 });
    await b.waitFor((frame) => frame.event?.kind === "stand" && frame.event.id === a.id);
    b.send({ type: "stand" });
    await a.waitFor((frame) => frame.event?.kind === "stand" && frame.event.id === b.id);
    const before = b.frames.length;
    b.send({ type: "sit", seat: 0 });
    await b.waitFor((frame) => b.frames.indexOf(frame) >= before && frame.type === "seat-granted" && frame.seat === 0);

    // 다시 이어서 받은 snapshot에도 다른 사람이 앉은 자리가 보여요. 두 시험(two-guests)과 같은 토큰을 써요.
    a.close();
    const again = await connect(baseURL ?? "", "a", "벤치토끼");
    try {
      const snapshot = again.frames.find((frame) => frame.type === "snapshot") as unknown as {
        guests: { id: string; bench: number | null }[];
      };
      expect(snapshot.guests.find((guest) => guest.id === b.id)?.bench).toBe(0);
      expect(snapshot.guests.find((guest) => guest.id === again.id)?.bench).toBeNull();
    } finally {
      again.close();
    }
  } finally {
    a.close();
    b.close();
  }
});
