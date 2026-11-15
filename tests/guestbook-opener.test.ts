import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createGuestbookOpener,
  OPEN_GIVE_UP_MS,
  OPEN_GOING_TEXT,
  OPEN_OFFLINE_TEXT,
  OPEN_RETRY_SHOWN_MS,
  OPEN_RETRY_TEXT,
  OPEN_SLOW_MS,
  OPEN_SLOW_TEXT,
  openStage,
} from "../src/guestbook/opener.ts";
import type { GuestbookOpenerDeps } from "../src/guestbook/opener.ts";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

const message = {
  v: PROTOCOL_VERSION,
  type: "guestbook" as const,
  token: null,
  active: true,
  count: 2,
  apples: [],
};

function setup(options: { online?: boolean; panel?: Promise<void> } = {}) {
  const log = {
    requests: 0,
    shown: [] as unknown[],
    status: [] as [string | null, boolean][],
    toasts: [] as string[],
  };
  const deps: GuestbookOpenerDeps = {
    online: () => options.online ?? true,
    now: () => 0,
    request: () => {
      log.requests += 1;
    },
    loadPanel: () => options.panel ?? Promise.resolve(),
    show: (m) => log.shown.push(m),
    status: (text, busy) => log.status.push([text, busy]),
    toast: (text) => log.toasts.push(text),
  };
  return { opener: createGuestbookOpener(deps), log };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("기다린 시간에 맞는 단계예요", () => {
  assert.equal(openStage(0), "going");
  assert.equal(openStage(OPEN_SLOW_MS - 1), "going");
  assert.equal(openStage(OPEN_SLOW_MS), "slow");
  assert.equal(openStage(OPEN_GIVE_UP_MS), "retry");
});

test("누르면 바로 기다림 표시가 뜨고, 답이 오면 지우고 화면을 열어요", async () => {
  const { opener, log } = setup();
  assert.equal(opener.start(0), true);
  assert.deepEqual(log.status[0], [OPEN_GOING_TEXT, true]);
  assert.equal(log.requests, 1);
  await settle();
  assert.equal(opener.receive(message), true);
  assert.deepEqual(log.status.at(-1), [null, false]);
  assert.deepEqual(log.shown, [message]);
  assert.equal(opener.waiting, false);
});

test("기다리는 동안 다시 눌러도 다시 묻지 않아요", () => {
  const { opener, log } = setup();
  opener.start(0);
  assert.equal(opener.start(100), false);
  assert.equal(opener.start(200), false);
  assert.equal(log.requests, 1);
});

test("답이 먼저 와도 화면 코드를 다 받은 뒤에 열어요", async () => {
  let ready: () => void = () => undefined;
  const panel = new Promise<void>((resolve) => (ready = resolve));
  const { opener, log } = setup({ panel });
  opener.start(0);
  opener.receive(message);
  assert.equal(log.shown.length, 0);
  ready();
  await settle();
  assert.deepEqual(log.shown, [message]);
});

test("3초가 지나면 조금 오래 걸린다고 알리고, 10초가 지나면 다시 눌러 달라며 기다림을 풀어요", () => {
  const { opener, log } = setup();
  opener.start(0);
  opener.update(OPEN_SLOW_MS - 1);
  assert.deepEqual(log.status.at(-1), [OPEN_GOING_TEXT, true]);
  opener.update(OPEN_SLOW_MS);
  assert.deepEqual(log.status.at(-1), [OPEN_SLOW_TEXT, true]);
  opener.update(OPEN_GIVE_UP_MS);
  assert.deepEqual(log.status.at(-1), [OPEN_RETRY_TEXT, false]);
  assert.equal(opener.waiting, false);
  // 잠시 뒤 문구도 지워요.
  opener.update(OPEN_GIVE_UP_MS + OPEN_RETRY_SHOWN_MS);
  assert.deepEqual(log.status.at(-1), [null, false]);
  // 다시 누르면 다시 물어요.
  assert.equal(opener.start(OPEN_GIVE_UP_MS + OPEN_RETRY_SHOWN_MS + 1), true);
  assert.equal(log.requests, 2);
});

test("기다림을 푼 뒤에 늦게 온 답은 화면을 열지 않아요", () => {
  const { opener, log } = setup();
  opener.start(0);
  opener.update(OPEN_GIVE_UP_MS);
  assert.equal(opener.receive(message), false);
  assert.equal(log.shown.length, 0);
});

test("서버가 거절하면 기다림을 풀고 다시 눌러 달라고 해요", () => {
  const { opener, log } = setup();
  opener.start(0);
  assert.equal(opener.denied(500), true);
  assert.deepEqual(log.status.at(-1), [OPEN_RETRY_TEXT, false]);
  assert.equal(opener.denied(600), false);
});

test("병동에 닿지 않으면 기다리지 않고 바로 알려요", () => {
  const { opener, log } = setup({ online: false });
  assert.equal(opener.start(0), false);
  assert.equal(log.requests, 0);
  assert.deepEqual(log.toasts, [OPEN_OFFLINE_TEXT]);
});

test("화면 코드를 받지 못하면 다시 눌러 달라고 해요", async () => {
  const { opener, log } = setup({ panel: Promise.reject(new Error("offline")) });
  opener.start(0);
  await settle();
  assert.deepEqual(log.status.at(-1), [OPEN_RETRY_TEXT, false]);
  assert.equal(opener.waiting, false);
});
