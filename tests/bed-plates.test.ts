import assert from "node:assert/strict";
import { test } from "vitest";
import { bedPlates, plateVisible } from "../src/ward/bed-plates.ts";
import { BEDS, bedApproach, bedFootSpot, ROOMS } from "../shared/ward-layout.ts";

const guest = (nickname: string, bed: number | null, outfit: "patient" | "visitor" = "patient") => ({ nickname, bed, outfit });

test("침대에 누운 환자만 발치에 이름표가 달려요", () => {
  const plates = bedPlates([guest("포근한 곰", 2), guest("서 있는 토끼", null), guest("문병 온 사슴", 4, "visitor")], null);
  assert.deepEqual([...plates], [[2, "포근한 곰"]]);
});

test("내 침대에도 달리고, 일어나면 사라져요", () => {
  assert.equal(bedPlates([], { nickname: "나", bed: 5 }).get(5), "나");
  assert.equal(bedPlates([], { nickname: "나", bed: null }).size, 0);
});

test("옮기면 이름표도 새 침대로 옮겨져요", () => {
  const before = bedPlates([guest("곰", 1)], null);
  const after = bedPlates([guest("곰", 3)], null);
  assert.equal(before.get(1), "곰");
  assert.equal(after.has(1), false);
  assert.equal(after.get(3), "곰");
});

test("서버가 아는 다른 분과 겹치면 서버 쪽을 따라요", () => {
  assert.equal(bedPlates([guest("곰", 1)], { nickname: "나", bed: 1 }).get(1), "곰");
});

test("이름표는 같은 병실에서만 보여요", () => {
  const bed = 0;
  assert.equal(plateVisible(bed, bedApproach(BEDS[bed]), 9), true);
  const otherRoom = BEDS.findIndex((candidate) => candidate.roomIndex !== BEDS[bed].roomIndex);
  assert.equal(plateVisible(otherRoom, bedApproach(BEDS[bed]), 9), false);
  assert.equal(plateVisible(bed, { x: ROOMS[0].x, z: 999 }, 9), false);
});

test("발치는 머리맡 반대쪽 끝이에요", () => {
  const bed = BEDS[0];
  const foot = bedFootSpot(bed);
  assert.ok(Math.hypot(foot.x - bed.x, foot.z - bed.z) > 1);
});
