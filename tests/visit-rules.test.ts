import assert from "node:assert/strict";
import { test } from "vitest";
import { clientMessageSchema, parseMessage, PROTOCOL_VERSION, serverMessageSchema, WARD_CAPACITY } from "../shared/protocol.ts";
import type { VerifiedHello } from "../shared/ward-rules.ts";
import { BEDS, bedApproach, WALK_AREAS } from "../shared/ward-layout.ts";
import {
  checkVisit,
  findLink,
  HOUR_MS,
  linkOpen,
  MAX_VISITORS_PER_LINK,
  recentAttempts,
  replaceLink,
  turnOffLink,
  visitorDelivery,
  visitorMay,
  visitorSpot,
  VISITS_PER_HOUR,
  visitTitle,
} from "../shared/visit-rules.ts";
import type { VisitLinkRow } from "../shared/visit-rules.ts";
import { admit, updateProfile } from "../shared/ward-rules.ts";
import { claimBed } from "../shared/bed-rules.ts";
import type { GuestRecord, VisitRole } from "../shared/ward-rules.ts";

const NOW = 1_800_000_000_000;
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

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

test("링크 확인: 있는 링크만 열리고, 없거나 꺼진 링크는 닫혀 있어요", () => {
  const rows = replaceLink([], draft("owner-a", "hash-1"));
  const link = findLink(rows, "hash-1");
  assert.ok(linkOpen(link));
  assert.equal(checkVisit(link, "visitor", 0, [], NOW).kind, "ok");
  assert.equal(findLink(rows, "hash-x"), null);
  assert.deepEqual(checkVisit(null, "visitor", 0, [], NOW), { kind: "closed" });
});

test("주인이 자기 링크로 들어오면 그냥 일반 입장이에요", () => {
  const link = findLink(replaceLink([], draft("owner-a", "hash-1")), "hash-1");
  assert.deepEqual(checkVisit(link, "owner-a", 0, [], NOW), { kind: "self" });
});

test("새로 만들면 예전 링크는 바로 쓸 수 없고, 한 사람당 링크는 하나예요", () => {
  const first = replaceLink([], draft("owner-a", "hash-1"));
  const other = replaceLink(first, draft("owner-b", "hash-b"));
  const second = replaceLink(other, draft("owner-a", "hash-2"));
  assert.equal(findLink(second, "hash-1"), null);
  assert.equal(checkVisit(findLink(second, "hash-1"), "v", 0, [], NOW).kind, "closed");
  assert.equal(checkVisit(findLink(second, "hash-2"), "v", 0, [], NOW).kind, "ok");
  assert.equal(second.filter((row) => row.owner === "owner-a").length, 1);
  // 다른 사람의 링크는 그대로예요.
  assert.ok(findLink(second, "hash-b"));
});

test("새로 만들면 문병 온 횟수는 0부터 다시 세요", () => {
  const first = replaceLink([], draft("owner-a", "hash-1")).map((row) => ({ ...row, visits: 7 }));
  const second = replaceLink(first, draft("owner-a", "hash-2"));
  assert.equal(findLink(second, "hash-2")?.visits, 0);
});

test("끈 링크는 열리지 않고, 다른 사람의 링크는 그대로예요", () => {
  const rows = replaceLink(replaceLink([], draft("owner-a", "hash-1")), draft("owner-b", "hash-b"));
  const off = turnOffLink(rows, "owner-a");
  assert.equal(checkVisit(findLink(off, "hash-1"), "v", 0, [], NOW).kind, "closed");
  assert.equal(checkVisit(findLink(off, "hash-b"), "v", 0, [], NOW).kind, "ok");
  // 끈 뒤 새로 만들면 다시 열려요.
  const again = replaceLink(off, draft("owner-a", "hash-3"));
  assert.equal(checkVisit(findLink(again, "hash-3"), "v", 0, [], NOW).kind, "ok");
});

test("동시에 들어올 수 있는 문병객은 3명까지예요", () => {
  const link = findLink(replaceLink([], draft("owner-a", "hash-1")), "hash-1");
  assert.equal(MAX_VISITORS_PER_LINK, 3);
  for (let active = 0; active < 3; active++) assert.equal(checkVisit(link, "v", active, [], NOW).kind, "ok");
  assert.equal(checkVisit(link, "v", 3, [], NOW).kind, "busy");
});

test("같은 링크로 1시간에 30번까지만 들어올 수 있어요", () => {
  const link = findLink(replaceLink([], draft("owner-a", "hash-1")), "hash-1");
  const within = Array.from({ length: VISITS_PER_HOUR }, (_, i) => NOW - i * 60_000);
  assert.equal(checkVisit(link, "v", 0, within.slice(1), NOW).kind, "ok");
  assert.equal(checkVisit(link, "v", 0, within, NOW).kind, "busy");
  // 1시간이 지난 기록은 세지 않아요.
  const old = within.map((at) => at - HOUR_MS);
  assert.equal(recentAttempts(old, NOW).length, 0);
  assert.equal(checkVisit(link, "v", 0, old, NOW).kind, "ok");
});

test("문병객은 걷기, 평안, 목례와 한마디, 선물만 할 수 있어요", () => {
  for (const type of ["hello", "walk-to", "bless", "bow", "gift"]) assert.ok(visitorMay(type), type);
  for (const type of ["lie-down", "get-up", "lamp", "leave-for", "guestbook", "hide-apple"]) assert.ok(!visitorMay(type), type);
});

test("주인이 없을 때 주인 침대로 보낸 것만 주인에게 전해요", () => {
  assert.equal(visitorDelivery(4, false, 4), "owner-inbox");
  assert.equal(visitorDelivery(4, true, 4), "room");
  assert.equal(visitorDelivery(4, false, 5), "room");
  assert.equal(visitorDelivery(4, false, null), "room");
});

test("문병객은 주인 침대 곁에 서고, 여럿이면 조금씩 비켜 서요", () => {
  const bed = 4;
  const near = bedApproach(BEDS[bed]);
  const spots = [0, 1, 2].map((n) => visitorSpot(bed, n));
  for (const spot of spots) {
    assert.ok(Math.hypot(spot.x - near.x, spot.z - near.z) < 1.2);
    assert.ok(
      WALK_AREAS.some((a) => spot.x >= a.minX && spot.x <= a.maxX && spot.z >= a.minZ && spot.z <= a.maxZ),
    );
  }
  assert.notDeepEqual(spots[0], spots[1]);
});

test("방명록에서 문병 오면 입장 제목이 바뀌어요", () => {
  assert.equal(visitTitle("따뜻한 곰"), "따뜻한 곰님에게 문병 왔어요");
});

const hello = (over: Partial<VerifiedHello> = {}): VerifiedHello => ({
  v: PROTOCOL_VERSION,
  type: "hello",
  guestId: "guest-visit-0001",
  animal: "bear",
  outfit: "patient",
  nickname: "엄마곰",
  withCat: false,
  ...over,
});

const role: VisitRole = { owner: "owner-a", bed: 4, session: "s-1", ownerNickname: "따뜻한 곰" };

const patient = (n: number): GuestRecord => ({
  id: `p${String(n).padStart(7, "0")}`,
  guestId: `guest-patient-${n}`,
  animal: "otter",
  outfit: "patient",
  nickname: "졸린 수달",
  withCat: false,
  x: 0,
  z: 0,
  bed: null,
  address: "",
  lyingSince: null,
  lastAction: {},
});

test("문병객은 정원이 차도 들어오고, 평상복으로 침대 곁에서 시작해요", () => {
  const full = Array.from({ length: WARD_CAPACITY }, (_, i) => patient(i));
  assert.equal(admit(full, 0, hello(), WARD_CAPACITY, "newguest").kind, "full");
  const spot = visitorSpot(4, 0);
  const admitted = admit(full, 0, hello(), WARD_CAPACITY, "visitor1", null, { role, spot });
  assert.equal(admitted.kind, "admitted");
  if (admitted.kind !== "admitted") return;
  assert.equal(admitted.record.outfit, "visitor");
  assert.deepEqual(admitted.record.visit, role);
  assert.equal(admitted.record.x, spot.x);
  assert.equal(admitted.record.z, spot.z);
});

test("문병객은 정원에 세지 않아요", () => {
  const visitor = { ...patient(99), visit: role, outfit: "visitor" as const };
  const others = [...Array.from({ length: WARD_CAPACITY - 1 }, (_, i) => patient(i)), visitor];
  assert.equal(admit(others, 0, hello(), WARD_CAPACITY, "newguest").kind, "admitted");
});

test("문병객은 침대를 차지하지 못하고, 옷을 바꿔도 평상복이에요", () => {
  const visitor: GuestRecord = { ...patient(1), visit: role, outfit: "visitor" };
  assert.equal(claimBed([], visitor, 4).granted, false);
  // 화면에서 환자복을 보내도 서버가 문병객 옷으로 둬요.
  const sneaky: GuestRecord = { ...visitor, outfit: "patient" };
  assert.equal(claimBed([], sneaky, 4).granted, false);
  const updated = updateProfile(visitor, hello({ outfit: "patient" }));
  assert.equal(updated.kind, "updated");
  if (updated.kind === "updated") assert.equal(updated.record.outfit, "visitor");
});

test("30초 안에 돌아온 문병객은 같은 역할을 이어받아요", () => {
  const before: GuestRecord = { ...patient(1), visit: role, outfit: "visitor", x: 1, z: 2 };
  const back = admit([], 0, hello({ outfit: "patient" }), WARD_CAPACITY, "other", before);
  assert.equal(back.kind, "admitted");
  if (back.kind !== "admitted") return;
  assert.equal(back.restored, true);
  assert.deepEqual(back.record.visit, role);
  assert.equal(back.record.outfit, "visitor");
});

test("hello는 visitToken을 선택적으로 받고, 버전은 7이에요", () => {
  assert.equal(PROTOCOL_VERSION, 7);
  const withToken = JSON.stringify(hello({ visitToken: TOKEN }));
  assert.equal(parseMessage(clientMessageSchema, withToken)?.type, "hello");
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify(hello())));
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify(hello({ visitToken: "bad" }))), null);
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ ...hello(), v: 1 })), null);
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v: 7, type: "guestbook", action: "create" })));
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ v: 7, type: "guestbook", action: "on" })), null);
  // 예전 문병 링크 메시지는 더 받지 않아요.
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ v: 7, type: "visit-link", action: "create" })), null);
  assert.ok(
    parseMessage(serverMessageSchema, JSON.stringify({ v: 7, type: "guestbook", token: TOKEN, active: true, count: 0, apples: [] })),
  );
  assert.ok(parseMessage(serverMessageSchema, JSON.stringify({ v: 7, type: "visit-denied", reason: "busy" })));
});

test("v4의 새 메시지도 zod로 검사해요", () => {
  const read = (value: unknown) => parseMessage(clientMessageSchema, JSON.stringify(value));
  assert.ok(read({ v: 7, type: "hug-request", targetId: "abcd1234" }));
  assert.ok(read({ v: 7, type: "hug-answer", requestId: "abcdefabcdef", accept: true }));
  assert.ok(read({ v: 7, type: "discharge", closeLink: false }));
  assert.ok(read({ v: 7, type: "sleep", sleeping: true }));
  assert.ok(read({ v: 7, type: "bow", phrase: 5 }));
  assert.equal(read({ v: 7, type: "hug-request", targetId: "guest-raw-id" }), null);
  assert.equal(read({ v: 7, type: "hug-answer", requestId: "short", accept: true }), null);
  assert.equal(read({ v: 7, type: "discharge" }), null);
  assert.equal(read({ v: 5, type: "hug-request", targetId: "abcd1234" }), null);
  const server = (value: unknown) => parseMessage(serverMessageSchema, JSON.stringify(value));
  assert.ok(server({ v: 7, type: "hug-offer", requestId: "abcdefabcdef", fromId: "abcd1234" }));
  assert.ok(server({ v: 7, type: "farewell-count", count: 4 }));
  assert.ok(server({ v: 7, type: "event", event: { kind: "planter", room: 2, total: 1234 } }));
  assert.ok(server({ v: 7, type: "event", event: { kind: "window-open", room: 0 } }));
  assert.ok(server({ v: 7, type: "event", event: { kind: "hug", a: "abcd1234", b: "efgh5678", bed: null } }));
  assert.equal(server({ v: 7, type: "event", event: { kind: "planter", room: 2, total: -1 } }), null);
});

test("문병객도 안아 주기는 보낼 수 있지만 퇴원은 할 수 없어요", () => {
  assert.ok(visitorMay("hug-request"));
  assert.ok(visitorMay("hug-answer"));
  assert.ok(!visitorMay("discharge"));
  assert.ok(!visitorMay("sleep"));
});
