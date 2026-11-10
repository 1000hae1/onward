import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CAT_TAP_GAP_MS,
  CAT_TAPS_PER_WINDOW,
  catBusyText,
  catTapAllowed,
  freshCatState,
  PET_REMEMBER_COUNT,
  PLAY_TIMING,
  REST_MS,
  requestPlay,
  shouldRub,
  startRub,
  STREAK_GAP_MS,
  wakeFromKnead,
  wardCatRoom,
} from "../shared/cat-play-rules.ts";
import type { CatState, PlayDecision, PlayRequest, PlayRequester } from "../shared/cat-play-rules.ts";
import { clientMessageSchema, parseMessage, PROTOCOL_VERSION, serverMessageSchema } from "../shared/protocol.ts";

const ROOM = 2;
const WARD_CAT = `w${ROOM}`;

const person = (id: string, over: Partial<PlayRequester> = {}): PlayRequester => ({
  id,
  nickname: `닉네임${id.slice(0, 2)}`,
  x: 1,
  z: 1,
  room: ROOM,
  lyingBed: null,
  lyingRoom: null,
  ...over,
});

const ask = (requester: PlayRequester, over: Partial<PlayRequest> = {}): PlayRequest => ({
  catId: WARD_CAT,
  kind: "pet",
  requester,
  owner: null,
  ...over,
});

function granted(decision: PlayDecision): CatState {
  assert.equal(decision.kind, "granted");
  return (decision as Extract<PlayDecision, { kind: "granted" }>).state;
}

test("병동 고양이 번호는 w0~w5예요", () => {
  assert.equal(wardCatRoom("w0"), 0);
  assert.equal(wardCatRoom("w5"), 5);
  assert.equal(wardCatRoom("w6"), null);
  assert.equal(wardCatRoom("abcd1234"), null);
});

test("같은 고양이를 동시에 누르면 먼저 처리된 사람만 놀고, 늦은 사람은 누구와 노는지 들어요", () => {
  const now = 1_000_000;
  const a = person("aaaa1111");
  const b = person("bbbb2222");
  // 서버는 메시지를 하나씩 처리해요. 같은 시각이어도 앞의 결과가 다음의 상태가 돼요.
  const first = requestPlay(freshCatState(), ask(a), now, 0.3);
  const state = granted(first);
  const second = requestPlay(state, ask(b, { kind: "yarn" }), now, 0.7);
  assert.equal(second.kind, "busy");
  assert.equal((second as Extract<PlayDecision, { kind: "busy" }>).nickname, a.nickname);
  assert.equal(catBusyText(a.nickname, "pet"), `지금 ${a.nickname}님이랑 놀고 있어요`);
  // 놀이가 끝나면 다른 사람도 놀 수 있어요.
  const later = requestPlay(state, ask(b), now + PLAY_TIMING.pet.busyMs, 0.1);
  assert.equal(later.kind, "granted");
});

test("연달아 두 번 논 뒤 세 번째 요청에서 10초 쉬고, 그 뒤에는 다시 놀아요", () => {
  const a = person("aaaa1111");
  let now = 5_000_000;
  let state = granted(requestPlay(freshCatState(), ask(a), now, 0));
  now += PLAY_TIMING.pet.busyMs + 1_000;
  state = granted(requestPlay(state, ask(a, { kind: "wand" }), now, 0));
  now += PLAY_TIMING.wand.busyMs + 1_000;

  const third = requestPlay(state, ask(a, { kind: "yarn" }), now, 0);
  assert.equal(third.kind, "resting");
  const rest = third as Extract<PlayDecision, { kind: "resting" }>;
  assert.equal(rest.started, true);
  assert.equal(rest.until, now + REST_MS);
  state = rest.state;

  // 쉬는 동안에는 누가 눌러도 쉬어요. 이번에는 새로 쉬기 시작한 게 아니에요.
  const during = requestPlay(state, ask(person("bbbb2222")), now + REST_MS - 1, 0);
  assert.equal(during.kind, "resting");
  assert.equal((during as Extract<PlayDecision, { kind: "resting" }>).started, false);

  // 10초가 지나면 다시 놀아요. 연달아 횟수는 처음부터 세요.
  state = granted(requestPlay(state, ask(a), now + REST_MS, 0));
  assert.equal(state.streak, 1);
});

test("놀이 사이가 넉넉하면 연달아로 세지 않아요", () => {
  const a = person("aaaa1111");
  let now = 0;
  let state = freshCatState();
  for (let round = 0; round < 5; round++) {
    state = granted(requestPlay(state, ask(a), now, 0));
    now += PLAY_TIMING.pet.busyMs + STREAK_GAP_MS;
  }
  assert.equal(state.streak, 1);
});

test("다른 사람의 고양이는 쓰다듬기만 하고, 주인은 모든 놀이를 해요", () => {
  const owner = person("owner111", { room: null });
  const other = person("other222", { room: null });
  const companion = (requester: PlayRequester, kind: PlayRequest["kind"]): PlayRequest => ({
    catId: owner.id,
    kind,
    requester,
    owner: owner.id,
  });
  for (const kind of ["yarn", "wand", "knead"] as const) {
    assert.deepEqual(requestPlay(freshCatState(), companion(other, kind), 0, 0), { kind: "denied", reason: "pet-only" });
  }
  assert.equal(requestPlay(freshCatState(), companion(other, "pet"), 0, 0).kind, "granted");
  for (const kind of ["pet", "yarn", "wand"] as const) {
    assert.equal(requestPlay(freshCatState(), companion(owner, kind), 0, 0).kind, "granted");
  }
  // 주인의 꾹꾹이도 누워 있을 때만이에요.
  assert.deepEqual(requestPlay(freshCatState(), companion(owner, "knead"), 0, 0), { kind: "denied", reason: "not-lying" });
  const lying = { ...owner, lyingBed: 4, lyingRoom: 0 };
  assert.equal(requestPlay(freshCatState(), companion(lying, "knead"), 0, 0).kind, "granted");
});

test("병동 고양이는 같은 병실에서만, 꾹꾹이는 그 병실 침대에 누웠을 때만이에요", () => {
  assert.deepEqual(requestPlay(freshCatState(), ask(person("aaaa1111", { room: 0 })), 0, 0), {
    kind: "denied",
    reason: "not-in-room",
  });
  assert.deepEqual(requestPlay(freshCatState(), ask(person("aaaa1111"), { kind: "knead" }), 0, 0), {
    kind: "denied",
    reason: "not-lying",
  });
  const lying = person("aaaa1111", { lyingBed: 13, lyingRoom: ROOM });
  const decision = requestPlay(freshCatState(), ask(lying, { kind: "knead" }), 0, 0);
  assert.equal(decision.kind, "granted");
  const play = (decision as Extract<PlayDecision, { kind: "granted" }>).play;
  assert.equal(play.bed, 13);
  // 꾹꾹이 뒤 곁에서 자는 동안은 다른 사람도 놀 수 있어요. 그러면 고양이가 일어나 가요.
  assert.ok(play.until > play.busyUntil);
  assert.equal(requestPlay({ play, streak: 1, restUntil: 0 }, ask(person("bbbb2222")), play.busyUntil, 0).kind, "granted");
});

test("곁에서 자던 고양이는 그 사람이 일어나면 깨어나요", () => {
  const lying = person("aaaa1111", { lyingBed: 13, lyingRoom: ROOM });
  const state = granted(requestPlay(freshCatState(), ask(lying, { kind: "knead" }), 0, 0));
  assert.equal(wakeFromKnead(state, "bbbb2222", 20_000), null);
  const woke = wakeFromKnead(state, lying.id, 20_000);
  assert.equal(woke?.play?.until, 20_000);
  // 이미 깨어났으면 바꾸지 않아요.
  assert.equal(wakeFromKnead(woke as CatState, lying.id, 30_000), null);
});

test("연결마다 1초 간격, 30초에 여섯 번까지 받아요", () => {
  let log: readonly number[] = [];
  let now = 0;
  for (let index = 0; index < CAT_TAPS_PER_WINDOW; index++) {
    const result = catTapAllowed(log, now);
    assert.equal(result.ok, true);
    log = result.log;
    now += CAT_TAP_GAP_MS;
  }
  assert.equal(catTapAllowed(log, now).ok, false);
  assert.equal(catTapAllowed([0], CAT_TAP_GAP_MS - 1).ok, false);
  // 30초가 지나면 다시 받아요.
  assert.equal(catTapAllowed(log, 30_000).ok, true);
});

test("오늘이나 어제 세 번 넘게 쓰다듬어 준 사람에게 하루 한 번 먼저 다가가요", () => {
  assert.equal(shouldRub(PET_REMEMBER_COUNT, 0, false), true);
  assert.equal(shouldRub(0, PET_REMEMBER_COUNT, false), true);
  assert.equal(shouldRub(PET_REMEMBER_COUNT - 1, 1, false), false);
  assert.equal(shouldRub(10, 10, true), false);
  const guest = { id: "aaaa1111", nickname: "따뜻한 곰", x: 0, z: 0 };
  const started = startRub(freshCatState(), guest, 0, 0.5);
  assert.equal(started?.play.kind, "rub");
  // 누가 놀고 있으면 기다리지 않고 건너뛰어요.
  const busy = granted(requestPlay(freshCatState(), ask(person("bbbb2222")), 0, 0));
  assert.equal(startRub(busy, guest, 1_000, 0), null);
});

test("고양이 메시지도 v와 zod 검사를 지나요", () => {
  const v = PROTOCOL_VERSION;
  const read = (value: unknown) => parseMessage(clientMessageSchema, JSON.stringify(value));
  assert.ok(read({ v, type: "cat-play", catId: "w3", kind: "yarn" }));
  assert.ok(read({ v, type: "cat-play", catId: "abcd1234", kind: "pet" }));
  assert.equal(read({ v, type: "cat-play", catId: "w9", kind: "pet" }), null);
  assert.equal(read({ v, type: "cat-play", catId: "w1", kind: "rub" }), null);
  assert.equal(read({ v: v - 1, type: "cat-play", catId: "w1", kind: "pet" }), null);
  const play = { catId: "w1", kind: "rub", by: "abcd1234", at: 1, until: 2, seed: 0.5, x: 0, z: 0, bed: null };
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify({ v, type: "event", event: { kind: "cat-play", play } })));
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify({ v, type: "cat-petted", nickname: "따뜻한 곰" })));
  // 놀이 이벤트에는 닉네임 자리가 없어요.
  const leaked = parseMessage(
    serverMessageSchema,
    JSON.stringify({ v, type: "event", event: { kind: "cat-play", play: { ...play, byName: "x" } } }),
  ) as { event: { play: Record<string, unknown> } } | null;
  assert.equal(leaked?.event.play.byName, undefined);
});
