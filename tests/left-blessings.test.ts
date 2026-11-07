import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addLatest,
  ADDRESS_PATTERN,
  bedCardText,
  DAY_MS,
  dailyKey,
  encodeAddress,
  fiveLeafAllowed,
  fresh,
  inboxCardText,
  INBOX_PER_GUEST,
  KEEP_MS,
  LEFT_PER_BED,
  takeForTaker,
  timeAgo,
  toCard,
} from "../shared/left-blessings.ts";
import type { StoredBlessing } from "../shared/left-blessings.ts";
import { giftAllowedNow, koreanDay } from "../shared/ward-rules.ts";
import { parseMetList, rememberPerson } from "../src/net/met-list.ts";

const NOW = Date.UTC(2026, 10, 7, 6, 0, 0);
const left = (at: number, sender = "s1", over: Partial<StoredBlessing> = {}): StoredBlessing => ({
  nickname: "졸린 수달",
  animal: "otter",
  kind: "bless",
  item: null,
  at,
  sender,
  ...over,
});

test("침대마다 최근 5개까지만 남겨요", () => {
  let list: StoredBlessing[] = [];
  for (let k = 0; k < 8; k++) list = addLatest(list, left(NOW + k * 1000), LEFT_PER_BED, NOW + k * 1000);
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((entry) => entry.at), [7, 6, 5, 4, 3].map((k) => NOW + k * 1000));
});

test("받는 사람마다 최근 10개까지만 남겨요", () => {
  let list: StoredBlessing[] = [];
  for (let k = 0; k < 15; k++) list = addLatest(list, left(NOW + k), INBOX_PER_GUEST, NOW + k);
  assert.equal(list.length, 10);
});

test("7일이 지나면 지워요", () => {
  const list = [left(NOW - KEEP_MS - 1), left(NOW - KEEP_MS + 1000), left(NOW)];
  assert.deepEqual(fresh(list, NOW).map((entry) => entry.at), [NOW - KEEP_MS + 1000, NOW]);
  // 새로 더할 때도 오래된 것은 함께 정리돼요.
  assert.equal(addLatest([left(NOW - 8 * DAY_MS)], left(NOW), 5, NOW).length, 1);
});

test("침대를 받으면 오래된 것부터 전하고, 내가 남긴 것과 만료된 것은 빼요", () => {
  const list = [left(NOW - 1000, "other"), left(NOW - 5000, "me"), left(NOW - 3000, "other2"), left(NOW - 8 * DAY_MS, "other3")];
  const cards = takeForTaker(list, "me", NOW);
  assert.deepEqual(cards.map((card) => card.at), [NOW - 3000, NOW - 1000]);
  // 화면에 가는 카드에는 남긴 사람의 해시가 없어요.
  for (const card of cards) assert.equal("sender" in card, false);
  assert.equal("sender" in toCard(list[0]), false);
});

test("같은 사람에게는 하루 한 번만 남겨요. 날짜는 한국 시간으로 나눠요", () => {
  const today = koreanDay(new Date("2026-11-07T14:59:00Z"));
  const tomorrow = koreanDay(new Date("2026-11-07T15:00:00Z"));
  assert.notEqual(today, tomorrow);
  const sent = new Set([dailyKey("a", "b", today)]);
  assert.equal(sent.has(dailyKey("a", "b", today)), true);
  assert.equal(sent.has(dailyKey("a", "b", tomorrow)), false);
  assert.equal(sent.has(dailyKey("a", "c", today)), false);
  assert.equal(sent.has(dailyKey("b", "a", today)), false);
});

test("오잎클로버는 한국 시간으로 하루 한 번이에요", () => {
  const before = koreanDay(new Date("2026-11-07T14:59:59Z"));
  const after = koreanDay(new Date("2026-11-07T15:00:00Z"));
  assert.equal(fiveLeafAllowed(null, before), true);
  assert.equal(fiveLeafAllowed(before, before), false);
  assert.equal(fiveLeafAllowed(before, after), true);
});

test("귤·홍시·호빵은 11월부터 2월까지만이에요", () => {
  for (const item of [2, 3, 4]) {
    assert.equal(giftAllowedNow(item, new Date("2026-11-07T00:00:00Z")), true);
    assert.equal(giftAllowedNow(item, new Date("2026-06-07T00:00:00Z")), false);
  }
  assert.equal(giftAllowedNow(1, new Date("2026-06-07T00:00:00Z")), true);
});

test("지난 시간을 부드럽게 말해요", () => {
  assert.equal(timeAgo(NOW, NOW), "방금");
  assert.equal(timeAgo(NOW - 5 * 60_000, NOW), "5분 전");
  assert.equal(timeAgo(NOW - 3 * 3_600_000, NOW), "3시간 전");
  assert.equal(timeAgo(NOW - 30 * 3_600_000, NOW), "어제");
  assert.equal(timeAgo(NOW - 3 * DAY_MS, NOW), "3일 전");
  assert.equal(timeAgo(NOW + 5000, NOW), "방금");
});

test("카드 문구는 해요체이고 받침에 맞게 을/를을 붙여요", () => {
  const at = NOW - 3 * 3_600_000;
  assert.equal(bedCardText(toCard(left(at)), NOW), "3시간 전, 졸린 수달님이 이 침대에 평안을 남겨두었어요");
  assert.equal(bedCardText({ ...toCard(left(at)), kind: "gift", item: 2 }, NOW), "3시간 전, 졸린 수달님이 이 침대에 귤을 남겨두었어요");
  assert.equal(bedCardText({ ...toCard(left(at)), kind: "gift", item: 3 }, NOW), "3시간 전, 졸린 수달님이 이 침대에 홍시를 남겨두었어요");
  assert.equal(inboxCardText({ ...toCard(left(at)), kind: "gift", item: 0 }, NOW), "3시간 전, 졸린 수달님이 네잎클로버를 남겨두었어요");
  assert.equal(inboxCardText({ ...toCard(left(at)), kind: "gift", item: 4 }, NOW), "3시간 전, 졸린 수달님이 호빵을 남겨두었어요");
  assert.equal(inboxCardText(toCard(left(at)), NOW), "3시간 전, 졸린 수달님이 평안을 남겨두었어요");
});

test("평안 주소는 128비트 무작위 값을 22자로 적어요", () => {
  const seen = new Set<string>();
  for (let k = 0; k < 200; k++) {
    const address = encodeAddress(crypto.getRandomValues(new Uint8Array(16)));
    assert.match(address, ADDRESS_PATTERN);
    seen.add(address);
  }
  assert.equal(seen.size, 200);
});

test("오늘 만난 사람 목록은 날짜가 바뀌면 비워요", () => {
  const person = { address: "A".repeat(22), nickname: "졸린 수달", animal: "otter" };
  const list = rememberPerson({ day: "2026-11-07", people: [] }, person, "2026-11-07");
  const raw = JSON.stringify(list);
  assert.deepEqual(parseMetList(raw, "2026-11-07").people, [person]);
  assert.deepEqual(parseMetList(raw, "2026-11-08").people, []);
  assert.deepEqual(parseMetList("{", "2026-11-07").people, []);
  // 주소 형식이 아니면 버려요.
  assert.deepEqual(parseMetList(JSON.stringify({ day: "2026-11-07", people: [{ ...person, address: "x" }] }), "2026-11-07").people, []);
});

test("같은 사람을 다시 만나면 새 주소로 바꿔 앞에 둬요", () => {
  const first = { address: "A".repeat(22), nickname: "졸린 수달", animal: "otter" };
  const other = { address: "B".repeat(22), nickname: "따뜻한 곰", animal: "bear" };
  const again = { address: "C".repeat(22), nickname: "졸린 수달", animal: "otter" };
  let list = rememberPerson({ day: "d", people: [] }, first, "d");
  list = rememberPerson(list, other, "d");
  list = rememberPerson(list, again, "d");
  assert.deepEqual(list.people.map((person) => person.address), ["C".repeat(22), "B".repeat(22)]);
});
