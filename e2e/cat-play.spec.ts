import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import { ROOMS } from "../shared/ward-layout.ts";

/**
 * 고양이 놀이는 서버가 정해요. 두 사람이 실제 서버(workerd)에 이어서 같은 고양이를 함께 눌러 봐요.
 * 화면 없이 WebSocket만 써요. 다른 시험과 섞이지 않게 95병동을 쓰고, 새 게스트 한도에 걸리지 않게 다른 시험과 같은 토큰을 써요.
 */
const TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), ".tokens.json");

type Frame = {
  type?: string;
  you?: string;
  token?: string;
  nickname?: string;
  action?: string;
  reason?: string;
  event?: { kind?: string; catId?: string; until?: number; play?: { catId: string; kind: string; by: string } };
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
  /** from 번째 메시지부터 찾아요. */
  waitFor(match: (frame: Frame) => boolean, from?: number): Promise<Frame>;
  close(): void;
}

async function connect(baseURL: string, name: string, nickname: string, withCat: boolean): Promise<Guest> {
  const url = new URL("/ws?ward=95&instance=1", baseURL);
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
  const waitFor = (match: (frame: Frame) => boolean, from = 0): Promise<Frame> => {
    const seen = frames.slice(from).find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      waiters.push({ match, resolve });
      setTimeout(() => reject(new Error(`${name}: 기다리던 메시지가 오지 않았어요. 받은 것: ${JSON.stringify(frames.map((frame) => frame.type))}`)), 12_000);
    });
  };
  const send = (message: Record<string, unknown>): void => socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error(`${name}: 이어지지 않았어요.`)));
  });
  const token = tokens()[name];
  send({ type: "hello", ...(token ? { token } : {}), animal: "rabbit", outfit: "patient", nickname, withCat });
  const snapshot = await waitFor((frame) => frame.type === "snapshot");
  return { id: snapshot.you as string, frames, send, waitFor, close: () => socket.close() };
}

const isPlay = (frame: Frame, catId: string, by?: string): boolean =>
  frame.event?.kind === "cat-play" && frame.event.play?.catId === catId && (by === undefined || frame.event.play.by === by);

test("같은 고양이는 한 사람과만 놀고, 남의 고양이는 쓰다듬기만, 연달아 세 번째에는 쉬어요", async ({ baseURL }) => {
  const a = await connect(baseURL ?? "", "a", "고양이토끼", true);
  const b = await connect(baseURL ?? "", "b", "고양이곰돌", false);
  try {
    // 오늘 많이 쓰다듬어 준 사람이면 들어올 때 병동 고양이 하나가 먼저 다가와 비벼요(18초).
    // 그 고양이는 바쁘니, 비비지 않는 병실 고양이로 시험해요.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rubbing = new Set(
      [...a.frames, ...b.frames].flatMap((frame) => (frame.event?.kind === "cat-play" && frame.event.play?.kind === "rub" ? [frame.event.play.catId] : [])),
    );
    const room = ROOMS.find((candidate) => !rubbing.has(`w${candidate.index}`)) ?? ROOMS[0];
    a.send({ type: "walk-to", x: room.x, z: room.z });
    b.send({ type: "walk-to", x: room.x + 0.4, z: room.z });
    await a.waitFor((frame) => frame.event?.kind === "walk");
    await b.waitFor((frame) => frame.event?.kind === "walk");

    // 1. 같은 병동 고양이를 동시에 누르면 한 사람만 놀아요. 늦은 사람은 누구와 노는지 들어요.
    const ward = `w${room.index}`;
    a.send({ type: "cat-play", catId: ward, kind: "pet" });
    b.send({ type: "cat-play", catId: ward, kind: "yarn" });
    const granted = await a.waitFor((frame) => isPlay(frame, ward));
    const winner = granted.event?.play?.by;
    const loser = winner === a.id ? b : a;
    const busy = await loser.waitFor((frame) => frame.type === "cat-busy");
    expect(busy.nickname).toBe(winner === a.id ? "고양이토끼" : "고양이곰돌");
    // 놀이는 같은 병동 모두에게 한 번 가요.
    await b.waitFor((frame) => isPlay(frame, ward, winner));

    // 2. 다른 사람의 고양이는 쓰다듬기만 해요. 주인에게 알려요. 연결마다 1초 간격을 지켜요.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    let mark = b.frames.length;
    b.send({ type: "cat-play", catId: a.id, kind: "yarn" });
    const denied = await b.waitFor((frame) => frame.type === "action-denied", mark);
    expect(denied.reason).toBe("pet-only");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    b.send({ type: "cat-play", catId: a.id, kind: "pet" });
    await a.waitFor((frame) => isPlay(frame, a.id, b.id));
    expect((await a.waitFor((frame) => frame.type === "cat-petted")).nickname).toBe("고양이곰돌");

    // 3. 놀이가 끝나고 곧바로 또 놀면 연달아예요. 세 번째 요청에서 10초 쉬어요.
    await new Promise((resolve) => setTimeout(resolve, 7_100));
    mark = a.frames.length;
    a.send({ type: "cat-play", catId: a.id, kind: "wand" });
    await a.waitFor((frame) => isPlay(frame, a.id, a.id), mark);
    await new Promise((resolve) => setTimeout(resolve, 6_600));
    mark = a.frames.length;
    a.send({ type: "cat-play", catId: a.id, kind: "yarn" });
    const rest = await a.waitFor((frame) => frame.event?.kind === "cat-rest", mark);
    expect(rest.event?.catId).toBe(a.id);
    await b.waitFor((frame) => frame.event?.kind === "cat-rest" && frame.event.catId === a.id);
    // 쉬는 동안에는 누가 눌러도 쉬어요.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    mark = b.frames.length;
    b.send({ type: "cat-play", catId: a.id, kind: "pet" });
    expect((await b.waitFor((frame) => frame.type === "action-denied", mark)).reason).toBe("resting");
  } finally {
    a.close();
    b.close();
  }
});
