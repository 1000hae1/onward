import assert from "node:assert/strict";
import { test } from "vitest";
import { BUILDING, PLAYER_START, ROOMS } from "../shared/ward-layout";
import {
  fadeLook,
  isOutdoors,
  lanternBob,
  lanternWanted,
  pickRealLights,
  stepFade,
} from "../src/ward/lantern-rules";

test("앞마당은 밖이고 병실과 로비는 건물 안이에요", () => {
  assert.equal(isOutdoors(PLAYER_START.x, PLAYER_START.z), true);
  assert.equal(isOutdoors(ROOMS[0].x, ROOMS[0].z), false);
  assert.equal(isOutdoors(0, BUILDING.maxZ - 0.5), false);
  assert.equal(isOutdoors(0, BUILDING.maxZ + 0.5), true);
});

test("밖에서는 저녁과 밤에, 건물 안에서는 소등 뒤에만 켜져요", () => {
  assert.equal(lanternWanted("day", true), false);
  assert.equal(lanternWanted("evening", true), true);
  assert.equal(lanternWanted("night", true), true);
  assert.equal(lanternWanted("day", false), false);
  assert.equal(lanternWanted("evening", false), false);
  assert.equal(lanternWanted("night", false), true);
});

test("켜지고 꺼지는 데 1초가 걸려요", () => {
  let fade = 0;
  for (let i = 0; i < 5; i++) fade = stepFade(fade, true, 0.1);
  assert.ok(Math.abs(fade - 0.5) < 1e-9);
  for (let i = 0; i < 10; i++) fade = stepFade(fade, true, 0.1);
  assert.equal(fade, 1);
  fade = stepFade(fade, false, 0.25);
  assert.equal(fade, 0.75);
  assert.equal(stepFade(0.1, false, 1), 0);
});

test("밝기는 처음과 끝이 부드러워요", () => {
  assert.equal(fadeLook(0), 0);
  assert.equal(fadeLook(1), 1);
  assert.equal(fadeLook(0.5), 0.5);
  assert.ok(fadeLook(0.1) < 0.1);
  assert.equal(fadeLook(2), 1);
});

test("진짜 조명은 화면 안의 켜진 등불 중 가까운 4개까지만 받아요", () => {
  const candidates = [
    { distance: 9, inView: true, strength: 1 },
    { distance: 2, inView: true, strength: 1 },
    { distance: 1, inView: false, strength: 1 },
    { distance: 3, inView: true, strength: 0 },
    { distance: 4, inView: true, strength: 0.5 },
    { distance: 5, inView: true, strength: 1 },
    { distance: 6, inView: true, strength: 1 },
  ];
  assert.deepEqual(pickRealLights(candidates), [1, 4, 5, 6]);
  assert.deepEqual(pickRealLights(candidates, 2), [1, 4]);
  assert.deepEqual(pickRealLights(candidates, 4, false), []);
  assert.deepEqual(pickRealLights([]), []);
});

test("움직임 줄이기면 등불이 떠다니지 않아요", () => {
  assert.equal(lanternBob(1.3, 0.4, true), 0);
  assert.ok(Math.abs(lanternBob(1.3, 0.4, false)) <= 0.015);
});
