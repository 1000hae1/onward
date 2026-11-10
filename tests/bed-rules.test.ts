import assert from "node:assert/strict";
import { test } from "vitest";
import {
  bedGuide,
  bedGuideText,
  bedOwner,
  claimBed,
  isLying,
  lieDown,
  releaseBed,
  seatOnEntry,
  standUp,
} from "../shared/bed-rules.ts";
import { startDischarge } from "../shared/discharge-rules.ts";
import { clientMessageSchema, parseMessage, PROTOCOL_VERSION, serverMessageSchema } from "../shared/protocol.ts";
import { BEDS, PLAYER_START, ROOMS } from "../shared/ward-layout.ts";
import { admit, expireAway, GRACE_MS, toAway, toPublic, updateProfile } from "../shared/ward-rules.ts";
import type { GuestRecord, VerifiedHello } from "../shared/ward-rules.ts";

const record = (id: string, over: Partial<GuestRecord> = {}): GuestRecord => ({
  id,
  guestId: `guest-${id}`,
  animal: "bear",
  outfit: "patient",
  nickname: "따뜻한 곰",
  withCat: false,
  x: PLAYER_START.x,
  z: PLAYER_START.z,
  bed: null,
  address: "A".repeat(22),
  lyingSince: null,
  lastAction: {},
  ...over,
});

const hello = (over: Partial<VerifiedHello> = {}): VerifiedHello => ({
  v: PROTOCOL_VERSION,
  type: "hello",
  guestId: "guest-aaaaaaaa",
  animal: "bear",
  outfit: "patient",
  nickname: "따뜻한 곰",
  withCat: false,
  ...over,
});

/* ───────── 동시에 고르기 ───────── */

test("두 사람이 같은 침대를 동시에 고르면 먼저 처리된 사람만 받아요", () => {
  const a = record("aaaaaaaa");
  const b = record("bbbbbbbb");
  // 메시지는 하나씩 차례로 처리돼요. a의 claim-bed가 먼저예요.
  const first = claimBed([a, b], a, 5);
  assert.equal(first.granted, true);
  assert.equal(first.record.bed, 5);
  // b가 볼 때는 이미 a의 침대예요.
  const second = claimBed([first.record, b], b, 5);
  assert.deepEqual(second.granted, false);
  assert.equal(!second.granted && second.reason, "taken");
  assert.equal(second.record.bed, null);
  // 받은 사람이 다시 눌러도 그대로 허락해요.
  assert.equal(claimBed([first.record, b], first.record, 5).granted, true);
});

test("침대를 받기만 하고 아직 눕지는 않아요. 눕기는 내 침대에만 돼요", () => {
  const a = claimBed([], record("aaaaaaaa"), 3).record;
  assert.equal(a.lyingSince, null);
  assert.equal(isLying(a), false);
  assert.equal(lieDown(a, 4, 1000).granted, false);
  const lying = lieDown(a, 3, 1000);
  assert.equal(lying.granted, true);
  assert.equal(lying.record.lyingSince, 1000);
  assert.equal(isLying(lying.record), true);
  // 이미 누워 있으면 누운 시각은 그대로라 고양이 시각도 바뀌지 않아요.
  assert.equal(lieDown(lying.record, 3, 9999).record.lyingSince, 1000);
  // 다른 사람의 침대에도 눕지 못해요.
  assert.equal(lieDown(record("bbbbbbbb"), 3, 1000).granted, false);
});

test("문병객과 퇴원하는 사람은 침대를 받지 못해요", () => {
  assert.equal(claimBed([], record("aaaaaaaa", { outfit: "visitor" }), 2).granted, false);
  const discharging = startDischarge(record("aaaaaaaa", { bed: 2, lyingSince: 1 }), 1000);
  assert.equal(claimBed([], discharging, 2).granted, false);
  assert.equal(claimBed([], record("aaaaaaaa"), BEDS.length).granted, false);
});

/* ───────── 내려와도 유지 ───────── */

test("침대에서 내려와 걸어 다녀도 침대는 계속 내 것이에요", () => {
  const owned = lieDown(claimBed([], record("aaaaaaaa"), 7).record, 7, 1000).record;
  const up = standUp(owned);
  assert.ok(up);
  assert.equal(up.bed, 7);
  assert.equal(up.lyingSince, null);
  // 이미 서 있으면 바꿀 것이 없어요.
  assert.equal(standUp(up), null);
  // 다른 사람이 그 침대를 달라고 해도 받지 못해요.
  const b = record("bbbbbbbb");
  assert.equal(claimBed([up, b], b, 7).granted, false);
  // 다른 사람 화면에도 침대(이름표)는 그대로이고, 눕지 않은 것만 보여요.
  const shown = toPublic(up);
  assert.equal(shown.bed, 7);
  assert.equal(shown.lying, false);
  assert.equal(toPublic(owned).lying, true);
});

test("다른 빈 침대로 옮기면 원래 침대는 바로 비고, 옮기는 사이 뺏기면 원래 침대를 지켜요", () => {
  const a = record("aaaaaaaa", { bed: 1, lyingSince: 500 });
  const b = record("bbbbbbbb", { bed: 2 });
  const lost = claimBed([a, b], a, 2);
  assert.equal(lost.granted, false);
  assert.equal(lost.record.bed, 1);
  assert.equal(lost.record.lyingSince, 500);
  const moved = claimBed([a, b], a, 3);
  assert.equal(moved.granted, true);
  assert.equal(moved.granted && moved.released, 1);
  assert.equal(moved.record.bed, 3);
  // 옮기면 새 침대로 걸어가서 눕기 전까지는 서 있어요.
  assert.equal(moved.record.lyingSince, null);
  const c = record("cccccccc");
  assert.equal(claimBed([moved.record, b, c], c, 1).granted, true);
});

/* ───────── 풀리는 때 ───────── */

test("퇴원하면 침대를 바로 반납해요", () => {
  const a = record("aaaaaaaa", { bed: 4, lyingSince: 100 });
  const left = startDischarge(a, 1000);
  assert.equal(left.bed, null);
  const b = record("bbbbbbbb");
  assert.equal(claimBed([left, b], b, 4).granted, true);
});

test("release-bed와 문병객으로 바꾸기도 침대를 비워요", () => {
  const a = record("aaaaaaaa", { bed: 4, lyingSince: 100 });
  const released = releaseBed(a);
  assert.equal(released.released, 4);
  assert.equal(released.record.bed, null);
  assert.equal(released.record.lyingSince, null);
  const changed = updateProfile(a, hello({ outfit: "visitor" }));
  assert.equal(changed.kind === "updated" && changed.record.bed, null);
});

test("연결이 끊기면 30초 동안은 내 침대이고, 그 뒤에 반납돼요", () => {
  const a = record("aaaaaaaa", { bed: 9 });
  const b = record("bbbbbbbb");
  const away = toAway(a, "hash-a", 10_000);
  // 잠시 끊긴 사람의 기록도 병실에 있는 사람으로 넣어서 판단해요.
  assert.equal(claimBed([away.record, b], b, 9).granted, false);
  assert.equal(bedOwner([away.record, b], 9)?.id, "aaaaaaaa");
  const early = expireAway([away], 10_000 + GRACE_MS - 1);
  assert.equal(early.kept.length, 1);
  assert.equal(claimBed([...early.kept.map((guest) => guest.record), b], b, 9).granted, false);
  // 30초가 지나면 기록이 빠지고 침대가 비어요.
  const late = expireAway([away], 10_000 + GRACE_MS);
  assert.equal(late.kept.length, 0);
  assert.equal(claimBed([...late.kept.map((guest) => guest.record), b], b, 9).granted, true);
});

test("30초 안에 다시 이으면 같은 침대와 누운 자세를 그대로 돌려받아요", () => {
  const a = record("aaaaaaaa", { guestId: "guest-aaaaaaaa", bed: 9, lyingSince: 500 });
  const away = toAway(a, "hash-a", 0);
  const back = admit([], 0, hello(), 30, "x0000000", away.record);
  assert.equal(back.kind, "admitted");
  assert.equal(back.kind === "admitted" && back.record.bed, 9);
  assert.equal(back.kind === "admitted" && back.record.lyingSince, 500);
});

/* ───────── 다시 들어올 때 ───────── */

test("다시 들어왔을 때 예전 침대가 비어 있으면 같은 침대를 먼저 받아요", () => {
  const fresh = record("aaaaaaaa");
  const seated = seatOnEntry([], fresh, 12);
  assert.equal(seated.bed, 12);
  // 서 있는 채로 받아요. 누우려면 침대를 눌러요.
  assert.equal(seated.lyingSince, null);
});

test("예전 침대를 다른 분이 쓰고 있으면 침대 없이 들어오고, 다른 침대를 고를 수 있어요", () => {
  const other = record("bbbbbbbb", { bed: 12 });
  const fresh = record("aaaaaaaa");
  assert.equal(seatOnEntry([other], fresh, 12).bed, null);
  assert.equal(seatOnEntry([], fresh, undefined).bed, null);
  // 문병객에게는 자리를 돌려주지 않아요.
  assert.equal(seatOnEntry([], record("aaaaaaaa", { outfit: "visitor" }), 12).bed, null);
  // 이미 침대가 있으면 그대로예요.
  assert.equal(seatOnEntry([], record("aaaaaaaa", { bed: 3 }), 12).bed, 3);
});

/* ───────── 침대가 다 찼을 때의 안내 ───────── */

test("내 침대가 없으면 침대 고르는 법을 안내하고, 지금 병실이 다 찼으면 빈 병실을 알려 줘요", () => {
  const room0 = new Set(BEDS.flatMap((bed, index) => (bed.roomIndex === 0 ? [index] : [])));
  const nobody = (): boolean => false;
  assert.deepEqual(bedGuide({ canLie: true, ownedBed: null, myRoom: 0 }, nobody), { kind: "pick-here" });
  // 0번 병실이 다 찼어요. 1번 병실(호실 번호)을 알려 줘요.
  const guide = bedGuide({ canLie: true, ownedBed: null, myRoom: 0 }, (bed) => room0.has(bed));
  assert.deepEqual(guide, { kind: "pick-other", roomNumber: ROOMS[1].number });
  assert.equal(guide && bedGuideText(guide), `이 병실은 침대가 다 찼어요. ${ROOMS[1].number}호실에 빈 침대가 있어요.`);
  // 침대가 하나도 없어도 병동에는 머물 수 있다고 알려요.
  const none = bedGuide({ canLie: true, ownedBed: null, myRoom: 0 }, () => true);
  assert.deepEqual(none, { kind: "none-free" });
  assert.match(bedGuideText({ kind: "none-free" }), /둘러보시다가/);
  // 내 침대가 있거나 문병객이면 안내하지 않아요.
  assert.equal(bedGuide({ canLie: true, ownedBed: 3, myRoom: 0 }, nobody), null);
  assert.equal(bedGuide({ canLie: false, ownedBed: null, myRoom: 0 }, nobody), null);
});

test("안내 문구는 해요체이고 '괜찮아요?', '힘내요'를 쓰지 않아요", () => {
  for (const guide of [{ kind: "pick-here" }, { kind: "pick-other", roomNumber: 102 }, { kind: "none-free" }] as const) {
    const text = bedGuideText(guide);
    assert.match(text, /요\.$/);
    assert.doesNotMatch(text, /괜찮아요\?|힘내요/);
  }
});

/* ───────── 메시지 ───────── */

test("claim-bed와 release-bed, 새 event는 zod로 검사하고 v가 있어야 해요", () => {
  const v = PROTOCOL_VERSION;
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v, type: "claim-bed", bedId: 3 })));
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ v, type: "release-bed" })));
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ type: "claim-bed", bedId: 3 })), null);
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ v, type: "claim-bed", bedId: 36 })), null);
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ v, type: "claim-bed", bedId: "3" })), null);
  // hello의 기억된 자리도 침대 번호 범위를 지켜요.
  const base = { v, type: "hello", animal: "bear", outfit: "patient", nickname: "따뜻한 곰", withCat: false };
  assert.ok(parseMessage(clientMessageSchema, JSON.stringify({ ...base, seat: 35 })));
  assert.equal(parseMessage(clientMessageSchema, JSON.stringify({ ...base, seat: 36 })), null);
  for (const event of [
    { kind: "bed-claimed", id: "abcd1234", bedId: 3 },
    { kind: "bed-released", id: "abcd1234" },
  ]) {
    assert.ok(parseMessage(serverMessageSchema, JSON.stringify({ v, type: "event", event })));
  }
});
