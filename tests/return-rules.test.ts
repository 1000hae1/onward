import assert from "node:assert/strict";
import { test } from "vitest";
import { countVisitDay, shouldGreet } from "../shared/return-rules.ts";
import { catVisits, CAT_VISIT_AFTER_MS, rankCatCandidates } from "../shared/ward-rules.ts";
import type { GuestRecord } from "../shared/ward-rules.ts";
import { bedApproach, BEDS, ROOMS } from "../shared/ward-layout.ts";

test("처음 오면 1일이에요", () => {
  assert.deepEqual(countVisitDay(null, "2026-11-08"), { days: 1, lastDay: "2026-11-08", counted: true });
});

test("같은 날 여러 번 와도 한 번만 세요", () => {
  const first = countVisitDay(null, "2026-11-08");
  const again = countVisitDay(first, "2026-11-08");
  assert.equal(again.days, 1);
  assert.equal(again.counted, false);
});

test("다른 날에 오면 하루 더해요. 날짜가 떨어져 있어도 누적이에요", () => {
  let days = countVisitDay(null, "2026-11-01");
  days = countVisitDay(days, "2026-11-02");
  days = countVisitDay(days, "2026-11-20");
  assert.equal(days.days, 3);
  assert.equal(days.lastDay, "2026-11-20");
  // 시계가 거꾸로 가도 세지 않아요.
  assert.equal(countVisitDay(days, "2026-11-19").days, 3);
});

test("3일 이상 다녀가면 고양이가 반겨요", () => {
  assert.equal(shouldGreet(2), false);
  assert.equal(shouldGreet(3), true);
  assert.equal(shouldGreet(40), true);
});

const lying = (id: string, bed: number, lyingSince: number, visitDays = 0): GuestRecord => {
  const spot = bedApproach(BEDS[bed]);
  return {
    id,
    guestId: `guest-${id}`,
    animal: "otter",
    outfit: "patient",
    nickname: "졸린 수달",
    withCat: false,
    x: spot.x,
    z: spot.z,
    bed,
    address: "A".repeat(22),
    lyingSince,
    lastAction: {},
    visitDays,
  };
};

test("고양이는 오래 누워 있던 사람에게 먼저 가고, 같으면 자주 온 사람이에요", () => {
  const beds = BEDS.map((bed, index) => ({ bed, index })).filter((entry) => entry.bed.roomIndex === 1).map((entry) => entry.index);
  const early = lying("aaaaaaaa", beds[0], 1000, 1);
  const late = lying("bbbbbbbb", beds[1], 5000, 30);
  assert.deepEqual(catVisits([late, early]), [{ room: 1, bed: beds[0], at: 1000 + CAT_VISIT_AFTER_MS }]);
  const tieFew = lying("cccccccc", beds[0], 2000, 2);
  const tieMany = lying("dddddddd", beds[1], 2000, 9);
  assert.equal(rankCatCandidates([tieFew, tieMany])[0].id, "dddddddd");
  assert.deepEqual(catVisits([tieFew, tieMany]), [{ room: 1, bed: beds[1], at: 2000 + CAT_VISIT_AFTER_MS }]);
});

test("병실에 서 있는 사람이 있으면 고양이는 찾아가지 않아요", () => {
  const bed = BEDS.findIndex((candidate) => candidate.roomIndex === 1);
  const standing = { ...lying("bbbbbbbb", bed, 0), bed: null, lyingSince: null, x: ROOMS[1].x, z: ROOMS[1].z };
  assert.deepEqual(catVisits([lying("aaaaaaaa", bed, 1000), standing]), []);
});
