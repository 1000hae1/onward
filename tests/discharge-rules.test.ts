import assert from "node:assert/strict";
import { test } from "vitest";
import {
  canDischarge,
  countFarewell,
  dischargeNoticeText,
  FAREWELL_MS,
  farewellCardText,
  farewellCount,
  startDischarge,
} from "../shared/discharge-rules.ts";
import { countVisitDay } from "../shared/return-rules.ts";
import { hugAvailable } from "../shared/ward-rules.ts";
import type { GuestRecord } from "../shared/ward-rules.ts";

const patient = (over: Partial<GuestRecord> = {}): GuestRecord => ({
  id: "aaaaaaaa",
  guestId: "guest-a",
  key: "key-a",
  animal: "otter",
  outfit: "patient",
  nickname: "졸린 수달",
  withCat: false,
  x: 0,
  z: 0,
  bed: 4,
  address: "A".repeat(22),
  lyingSince: 100,
  lastAction: {},
  linked: true,
  ...over,
});

const NOW = 5_000_000;

test("내 침대에 있는 환자만 퇴원할 수 있어요", () => {
  assert.equal(canDischarge(patient()), "ok");
  assert.equal(canDischarge(patient({ bed: null })), "no-bed");
  assert.equal(
    canDischarge(patient({ visit: { owner: "k", bed: 1, session: "s", ownerNickname: "곰" } })),
    "visitor",
  );
  assert.equal(canDischarge(startDischarge(patient(), NOW)), "already");
});

test("퇴원하면 침대를 비우고 문병객 모습으로 바뀌어요", () => {
  const out = startDischarge(patient(), NOW);
  assert.equal(out.bed, null);
  assert.equal(out.lyingSince, null);
  assert.equal(out.outfit, "visitor");
  assert.deepEqual(out.discharge, { at: NOW, from: [] });
  // 퇴원하는 사람에게는 안아 주기 요청이 가지 않아요.
  assert.equal(hugAvailable(out), false);
});

test("문병 링크는 고른 때만 꺼요. 기본은 그대로예요", () => {
  assert.equal(startDischarge(patient(), NOW).linked, true);
  assert.equal(startDischarge(patient(), NOW, true).linked, false);
});

test("1분 동안 받은 배웅을 사람마다 한 번씩 세요", () => {
  let record = startDischarge(patient(), NOW);
  for (const [key, at] of [
    ["key-b", NOW + 1000],
    ["key-c", NOW + 2000],
    ["key-b", NOW + 3000],
    ["key-a", NOW + 4000],
    ["key-d", NOW + FAREWELL_MS + 1],
  ] as const) {
    record = countFarewell(record, key, at).record;
  }
  assert.equal(farewellCount(record), 2);
});

test("퇴원하지 않은 사람에게 온 평안은 배웅으로 세지 않아요", () => {
  const result = countFarewell(patient(), "key-b", NOW);
  assert.equal(result.counted, false);
  assert.equal(farewellCount(result.record), 0);
});

test("안내와 카드 문구예요", () => {
  assert.equal(dischargeNoticeText("졸린 수달"), "졸린 수달님이 퇴원해요");
  assert.equal(farewellCardText(4), "4분이 배웅해 주셨어요");
  assert.ok(farewellCardText(0).length > 0);
});

test("퇴원했다가 다시 와도 다녀간 날은 그대로 이어져요", () => {
  const before = countVisitDay(countVisitDay(null, "2026-11-01"), "2026-11-02");
  assert.equal(countVisitDay(before, "2026-11-03").days, 3);
});
