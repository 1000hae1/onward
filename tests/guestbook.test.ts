import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  APPLE_NOTE_MAX,
  APPLE_SLOTS,
  APPLES_PER_HOUR,
  appleCountText,
  appleLabel,
  carriesAppleData,
  checkApple,
  checkApplePost,
  checkAppleNote,
  guestbookTitle,
  HOUR_MS,
  OWNER_ONLY_MESSAGES,
  ownerTree,
  readGuestbookPath,
  slotFor,
  visibleApples,
  visitorTree,
} from "../shared/guestbook-rules.ts";
import type { StoredApple } from "../shared/guestbook-rules.ts";
import {
  applePostSchema,
  clientMessageSchema,
  guestbookViewSchema,
  parseMessage,
  PROTOCOL_VERSION,
  serverMessageSchema,
  WARD_CAPACITY,
} from "../shared/protocol.ts";
import { checkVisit, findLink, MAX_VISITORS_PER_LINK, replaceLink, turnOffLink, visitorMay, visitorSpot } from "../shared/visit-rules.ts";
import type { VisitLinkRow } from "../shared/visit-rules.ts";
import { admit, toPublic } from "../shared/ward-rules.ts";
import { claimBed } from "../shared/bed-rules.ts";
import type { GuestRecord, VerifiedHello, VisitRole } from "../shared/ward-rules.ts";
import { appleSlotPoint, insideCanopy, othersSlots, TREE_HEIGHT, TREE_WIDTH } from "../src/guestbook/tree-shape.ts";

const NOW = 1_800_000_000_000;
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const v = PROTOCOL_VERSION;

const draft = (owner: string, tokenHash: string): Omit<VisitLinkRow, "off" | "visits"> => ({
  tokenHash,
  owner,
  addressHash: `addr-${owner}`,
  nickname: "따뜻한 곰",
  animal: "bear",
  created: NOW,
  ward: 3,
  instance: 1,
  bed: 4,
});

const apple = (id: number, writerHash: string, over: Partial<StoredApple> = {}): StoredApple => ({
  id,
  owner: "owner-a",
  name: `이름${String.fromCharCode(0xac00 + id)}`,
  phrase: id % 5,
  note: id % 2 === 0 ? `짧은 글 ${String.fromCharCode(0xac00 + id)}` : null,
  at: NOW - id * 1000,
  linkHash: "hash-1",
  writerHash,
  slot: slotFor(id - 1),
  ...over,
});

const record = (n: number, over: Partial<GuestRecord> = {}): GuestRecord => ({
  id: `p${String(n).padStart(7, "0")}`,
  guestId: `guest-${n}`,
  animal: "bear",
  outfit: "patient",
  nickname: "따뜻한 곰",
  withCat: false,
  x: 0,
  z: 0,
  bed: n % 36,
  address: "A".repeat(22),
  lyingSince: null,
  lastAction: { link: NOW },
  key: `key-${n}`,
  linked: true,
  ...over,
});

/* ───────── 1. 다른 사용자에게 가는 메시지에는 사과가 없어요 ───────── */

test("다른 사람에게 보이는 손님 정보에는 사과 관련 값이 없어요", () => {
  // 링크가 켜져 있고 사과가 많은 주인이어도 다른 사람에게는 같은 모양이에요.
  const owner = toPublic(record(1, { linked: true }));
  assert.equal(carriesAppleData(owner), false);
  assert.deepEqual(Object.keys(owner).sort(), ["address", "animal", "bed", "bench", "hugOk", "id", "lying", "nickname", "outfit", "sleeping", "withCat", "x", "z"]);
});

test("snapshot과 모든 event 모양에는 사과를 담을 자리가 없어요", () => {
  const guest = toPublic(record(2));
  const snapshot = {
    v,
    type: "snapshot",
    you: guest.id,
    capacity: WARD_CAPACITY,
    guests: [guest],
    gifts: [],
    lamps: [0, 0, 0, 0, 0, 0],
    seasonalGifts: false,
    serverNow: NOW,
    catVisits: [],
    catPlays: [],
    catRests: [],
    restored: false,
    inbox: [],
    stats: { visitors: 1, blessings: 0, lamps: 0 },
    visit: { ownerNickname: "따뜻한 곰", ownerPresent: false, bed: 4 },
    greet: false,
    welcomeBack: false,
    fiveLeafUsed: null,
    morningRooms: [],
    planters: [0, 0, 0, 0, 0, 0],
  };
  assert.equal(carriesAppleData(snapshot), false);
  // 서버가 실수로 사과를 섞어도 화면은 정해 둔 모양만 읽어요.
  const parsed = parseMessage(serverMessageSchema, JSON.stringify({ ...snapshot, apples: [{ id: 1 }], appleCount: 3 }), 65_536);
  assert.ok(parsed);
  assert.equal(carriesAppleData(parsed), false);

  const events = [
    { kind: "join", guest },
    { kind: "update", guest },
    { kind: "leave", id: guest.id },
    { kind: "walk", id: guest.id, x: 1, z: 1 },
    { kind: "lie", id: guest.id, bedId: 1 },
    { kind: "bless", id: guest.id, bedId: 1, targetId: null },
    { kind: "stats", stats: { visitors: 1, blessings: 1, lamps: 0 } },
    { kind: "planter", room: 0, total: 3 },
    { kind: "discharge", id: guest.id },
    { kind: "cat-play", play: { catId: "w0", kind: "pet", by: guest.id, at: 1, until: 2, seed: 0.5, x: 0, z: 0, bed: null } },
    { kind: "cat-rest", catId: "w0", until: 2 },
    { kind: "cat-wake", catId: guest.id, until: 2 },
  ];
  for (const event of events) {
    const message = parseMessage(serverMessageSchema, JSON.stringify({ v, type: "event", event }));
    assert.ok(message, event.kind);
    assert.equal(carriesAppleData(message), false, event.kind);
  }
});

test("사과를 담는 메시지는 주인 한 사람에게만 보내요", () => {
  const book = { v, type: "guestbook", token: null, active: true, count: 1, apples: [] };
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify(book)));
  assert.equal(carriesAppleData(book), true);
  assert.equal(carriesAppleData({ v, type: "my-tree", active: true, count: 2 }), true);
  assert.deepEqual([...OWNER_ONLY_MESSAGES].sort(), ["guestbook", "my-tree"]);

  // 병실 서버는 이 두 메시지를 그 연결(this.send(ws, ...))로만 보내고, broadcast에는 넣지 않아요.
  const source = readFileSync(new URL("../worker/ward-room.ts", import.meta.url), "utf8");
  const sends = source.split("\n").filter((line) => /type: "(guestbook|my-tree)"/.test(line));
  assert.ok(sends.length >= 2);
  for (const line of sends) assert.match(line, /this\.send\(ws, /);
  assert.doesNotMatch(source, /broadcast\([^)]*(apple|guestbook|my-tree)/);
});

/* ───────── 2. 토큰이 있어야 사과를 달 수 있어요 ───────── */

test("토큰이 없거나 꺼진 링크로는 사과를 달 수 없어요", () => {
  assert.deepEqual(checkApplePost(null, [], NOW), { kind: "closed" });
  const rows = replaceLink([], draft("owner-a", "hash-1"));
  assert.equal(checkApplePost(findLink(rows, "hash-1"), [], NOW).kind, "ok");
  assert.equal(checkApplePost(findLink(rows, "hash-unknown"), [], NOW).kind, "closed");
  const off = turnOffLink(rows, "owner-a");
  assert.equal(checkApplePost(findLink(off, "hash-1"), [], NOW).kind, "closed");
  // 꺼진 링크로는 문병도 올 수 없어요.
  assert.equal(checkVisit(findLink(off, "hash-1"), "v", 0, [], NOW).kind, "closed");
});

test("새 링크를 만들면 이전 링크로는 사과를 달 수도, 문병 올 수도 없어요", () => {
  const first = replaceLink([], draft("owner-a", "hash-1"));
  const second = replaceLink(first, draft("owner-a", "hash-2"));
  assert.equal(checkApplePost(findLink(second, "hash-1"), [], NOW).kind, "closed");
  assert.equal(checkVisit(findLink(second, "hash-1"), "v", 0, [], NOW).kind, "closed");
  assert.equal(checkApplePost(findLink(second, "hash-2"), [], NOW).kind, "ok");
});

test("사과 달기 요청은 토큰과 같은 모양의 열쇠를 꼭 담아요", () => {
  const ok = { v, writer: TOKEN, name: "엄마", phrase: 0, note: null };
  assert.ok(applePostSchema.safeParse(ok).success);
  assert.equal(applePostSchema.safeParse({ ...ok, writer: undefined }).success, false);
  assert.equal(applePostSchema.safeParse({ ...ok, phrase: 5 }).success, false);
  assert.equal(applePostSchema.safeParse({ ...ok, v: 5 }).success, false);
  // 모르는 값(병실 번호 같은 것)은 받지 않아요.
  assert.equal(applePostSchema.safeParse({ ...ok, owner: "key-1" }).success, false);
});

test("주소는 /guestbook/{토큰}만 읽고, 닉네임이나 병실 정보는 없어요", () => {
  assert.equal(readGuestbookPath(`/guestbook/${TOKEN}`), TOKEN);
  assert.equal(readGuestbookPath(`/guestbook/${TOKEN}/`), TOKEN);
  assert.equal(readGuestbookPath("/guestbook/short"), null);
  assert.equal(readGuestbookPath(`/guestbook/${TOKEN}x`), null);
  assert.equal(readGuestbookPath(`/visit/${TOKEN}`), null);
});

/* ───────── 3. 링크로 온 사람은 남의 사과 내용을 볼 수 없어요 ───────── */

test("링크로 온 사람은 자기가 단 사과의 내용만, 다른 사과는 개수만 받아요", () => {
  const apples = [apple(1, "writer-me"), apple(2, "writer-other"), apple(3, "writer-other"), apple(4, "writer-me")];
  const mine = visitorTree(apples, "writer-me");
  assert.equal(mine.count, 4);
  assert.deepEqual(
    mine.mine.map((card) => card.id),
    [1, 4],
  );
  const text = JSON.stringify(mine);
  for (const other of apples.filter((entry) => entry.writerHash !== "writer-me")) {
    assert.ok(!text.includes(other.name), other.name);
    if (other.note) assert.ok(!text.includes(other.note));
  }
  // 해시는 아무에게도 보내지 않아요.
  assert.ok(!text.includes("writer-") && !text.includes("hash-1") && !text.includes("owner-a"));
  // 열쇠가 없으면 내용은 하나도 없어요.
  assert.deepEqual(visitorTree(apples, null), { count: 4, mine: [] });
});

test("링크로 온 사람의 답에는 정해 둔 값만 들어가요", () => {
  const view = { v, open: true, ownerNickname: "따뜻한 곰", ownerAnimal: "bear", ward: 3, instance: 1, count: 2, mine: [] };
  assert.ok(guestbookViewSchema.safeParse(view).success);
  // 다른 사람의 사과 목록을 끼워 넣을 자리가 없어요.
  assert.equal(guestbookViewSchema.safeParse({ ...view, apples: [{ id: 2 }] }).success, false);
  assert.equal(guestbookViewSchema.safeParse({ v, open: false, count: 3 }).success, false);
});

test("주인은 모든 사과의 내용을 봐요. 나무에는 최근 40개만 열려요", () => {
  const apples = Array.from({ length: 45 }, (_, index) => apple(index + 1, "w"));
  const tree = ownerTree(apples);
  assert.equal(tree.count, 45);
  assert.equal(tree.apples.length, APPLE_SLOTS);
  assert.equal(tree.apples[0].id, 6);
  // 보이는 사과는 자리가 겹치지 않아요. 41번째 사과는 첫 사과 자리에 열려요.
  assert.equal(new Set(tree.apples.map((card) => card.slot)).size, APPLE_SLOTS);
  assert.equal(slotFor(40), slotFor(0));
  assert.deepEqual(visibleApples([{ id: 3 }, { id: 1 }, { id: 2 }]), [{ id: 1 }, { id: 2 }, { id: 3 }]);
});

/* ───────── 4. 시간당 10개, 이름과 짧은 글 ───────── */

test("같은 링크로 1시간에 10개까지예요", () => {
  const link = findLink(replaceLink([], draft("owner-a", "hash-1")), "hash-1");
  const nine = Array.from({ length: APPLES_PER_HOUR - 1 }, (_, i) => NOW - i * 60_000);
  assert.equal(APPLES_PER_HOUR, 10);
  assert.equal(checkApplePost(link, nine, NOW).kind, "ok");
  assert.equal(checkApplePost(link, [...nine, NOW - 1000], NOW).kind, "limit");
  // 1시간이 지난 사과는 세지 않아요.
  const old = Array.from({ length: 20 }, () => NOW - HOUR_MS);
  assert.equal(checkApplePost(link, old, NOW).kind, "ok");
});

test("이름은 닉네임 규칙(2~10자, 금칙어·숫자 연속·주소 거절)이에요", () => {
  const ok = checkApple({ name: "  엄마  ", phrase: 0 });
  assert.deepEqual(ok, { ok: true, value: { name: "엄마", phrase: 0, note: null } });
  assert.deepEqual(checkApple({ name: "엄", phrase: 0 }), { ok: false, field: "name", problem: "short" });
  assert.deepEqual(checkApple({ name: "열한글자가넘는긴이름이에요", phrase: 0 }), { ok: false, field: "name", problem: "long" });
  assert.deepEqual(checkApple({ name: "곰01012345", phrase: 0 }), { ok: false, field: "name", problem: "digits" });
  assert.deepEqual(checkApple({ name: "www.a.kr", phrase: 0 }), { ok: false, field: "name", problem: "url" });
  assert.deepEqual(checkApple({ name: "운영자곰", phrase: 0 }), { ok: false, field: "name", problem: "banned" });
  assert.deepEqual(checkApple({ name: "엄마", phrase: 5 }), { ok: false, field: "phrase" });
  assert.deepEqual(checkApple({ name: "엄마", phrase: 1.5 }), { ok: false, field: "phrase" });
});

test("짧은 글은 선택이고 100자, 금칙어·주소를 거절해요", () => {
  assert.deepEqual(checkAppleNote(undefined), { ok: true, value: null });
  assert.deepEqual(checkAppleNote("   "), { ok: true, value: null });
  assert.deepEqual(checkAppleNote("푹 쉬고\n 내일 봐요"), { ok: true, value: "푹 쉬고 내일 봐요" });
  assert.equal(checkAppleNote("가".repeat(APPLE_NOTE_MAX)).ok, true);
  assert.deepEqual(checkAppleNote("가".repeat(APPLE_NOTE_MAX + 1)), { ok: false, problem: "long" });
  assert.deepEqual(checkAppleNote("여기 보세요 https://example.com"), { ok: false, problem: "url" });
  assert.deepEqual(checkAppleNote("example.com 으로 와요"), { ok: false, problem: "url" });
  assert.deepEqual(checkAppleNote("연락 주세요 a@b"), { ok: false, problem: "email" });
  assert.deepEqual(checkAppleNote("01012345678로 연락"), { ok: false, problem: "digits" });
  assert.deepEqual(checkAppleNote("시 발"), { ok: false, problem: "banned" });
  assert.deepEqual(checkApple({ name: "엄마", phrase: 2, note: "https://x.y" }), { ok: false, field: "note", problem: "url" });
});

/* ───────── 5. 문병객 권한 ───────── */

const hello = (over: Partial<VerifiedHello> = {}): VerifiedHello => ({
  v,
  type: "hello",
  guestId: "guest-visit-0001",
  animal: "bear",
  outfit: "patient",
  nickname: "엄마곰",
  withCat: false,
  visitToken: TOKEN,
  ...over,
});
const role: VisitRole = { owner: "owner-a", bed: 4, session: "s-1", ownerNickname: "따뜻한 곰" };

test("문병객은 침대를 차지할 수 없고 정원에 세지 않아요", () => {
  const full = Array.from({ length: WARD_CAPACITY }, (_, i) => record(i, { bed: null, linked: false }));
  const admitted = admit(full, 0, hello(), WARD_CAPACITY, "visitor1", null, { role, spot: visitorSpot(4, 0) });
  assert.equal(admitted.kind, "admitted");
  if (admitted.kind !== "admitted") return;
  assert.equal(admitted.record.outfit, "visitor");
  assert.equal(admitted.record.bed, null);
  assert.equal(claimBed([], admitted.record, 4).granted, false);
  assert.equal(claimBed([], { ...admitted.record, outfit: "patient" }, 4).granted, false);
});

test("한 링크로 동시에 3명까지 문병 와요", () => {
  const link = findLink(replaceLink([], draft("owner-a", "hash-1")), "hash-1");
  assert.equal(MAX_VISITORS_PER_LINK, 3);
  assert.equal(checkVisit(link, "v", 2, [], NOW).kind, "ok");
  assert.equal(checkVisit(link, "v", 3, [], NOW).kind, "busy");
});

test("병실 안에서는 누구도 다른 사람의 사과나무를 열거나 사과를 달 수 없어요", () => {
  // 문병객은 방명록 메시지를 보낼 수 없어요.
  assert.equal(visitorMay("guestbook"), false);
  assert.equal(visitorMay("hide-apple"), false);
  // 병실 메시지에는 남의 나무를 가리킬 자리(사람·침대·토큰)가 없어요. 늘 "내" 나무예요.
  const read = (value: unknown) => parseMessage(clientMessageSchema, JSON.stringify(value));
  assert.ok(read({ v, type: "guestbook", action: "info" }));
  assert.equal(read({ v, type: "guestbook", action: "info", targetId: "abcd1234" })?.type, "guestbook");
  const parsed = read({ v, type: "guestbook", action: "info", targetId: "abcd1234", bedId: 3 });
  assert.deepEqual(parsed, { v, type: "guestbook", action: "info" });
  // 병실에서 사과를 다는 메시지는 없어요.
  assert.equal(read({ v, type: "apple", name: "엄마", phrase: 0 }), null);
  assert.equal(read({ v, type: "add-apple", name: "엄마", phrase: 0 }), null);
});

/* ───────── 그림과 문구 ───────── */

test("사과 40자리는 모두 수관 안에 있고 서로 겹치지 않아요", () => {
  const points = Array.from({ length: APPLE_SLOTS }, (_, slot) => appleSlotPoint(slot));
  for (const point of points) {
    assert.ok(insideCanopy(point.x, point.y, 10), JSON.stringify(point));
    assert.ok(point.x > 0 && point.x < TREE_WIDTH && point.y > 0 && point.y < TREE_HEIGHT);
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) >= 22);
  }
  assert.deepEqual(othersSlots(3, []), [0, 1, 2]);
  assert.deepEqual(othersSlots(4, [1]), [0, 2, 3]);
  assert.equal(othersSlots(100, [5]).length, APPLE_SLOTS - 1);
});

test("문구는 부드러운 해요체예요", () => {
  assert.equal(guestbookTitle("따뜻한 곰"), "따뜻한 곰님의 사과나무");
  assert.equal(appleCountText(12), "지금까지 사과 12개가 열렸어요");
  assert.equal(appleCountText(0), "아직 열린 사과가 없어요");
  const nov9 = Date.UTC(2026, 10, 9, 3);
  assert.equal(appleLabel("엄마", nov9), "엄마가 남긴 사과, 11월 9일");
  assert.equal(appleLabel("아기곰", nov9), "아기곰이 남긴 사과, 11월 9일");
  // 한국 시간으로 날짜를 적어요. UTC 11월 9일 15시는 한국 11월 10일이에요.
  assert.equal(appleLabel("엄마", Date.UTC(2026, 10, 9, 15)), "엄마가 남긴 사과, 11월 10일");
});
