import assert from "node:assert/strict";
import { test } from "vitest";
import { defaultProfile, parseProfile } from "../src/ui/profile.ts";

const good = { species: "otter", outfit: "visitor", nickname: "졸린 수달", nicknameAuto: true, withCat: true };

test("기본값은 혼자 들어가는 환자이고 자동 닉네임이 채워져요", () => {
  const profile = defaultProfile(0.5);
  assert.equal(profile.withCat, false);
  assert.equal(profile.outfit, "patient");
  assert.equal(profile.nicknameAuto, true);
  // 안아 주기 요청은 기본으로 받아요.
  assert.equal(profile.hugsOff, false);
  assert.ok(profile.nickname.endsWith("토끼"));
});

test("저장된 값은 형식이 맞을 때만 읽어요", () => {
  assert.deepEqual(parseProfile(JSON.stringify(good)), { ...good, hugsOff: false });
  assert.equal(parseProfile(JSON.stringify({ ...good, hugsOff: true }))?.hugsOff, true);
  assert.equal(parseProfile(null), null);
  assert.equal(parseProfile("{"), null);
  assert.equal(parseProfile("null"), null);
  for (const broken of [
    { ...good, species: "dragon" },
    { ...good, outfit: "nurse" },
    { ...good, withCat: "yes" },
    { ...good, nicknameAuto: 1 },
    { ...good, nickname: 3 },
  ]) {
    assert.equal(parseProfile(JSON.stringify(broken)), null);
  }
});

test("저장소를 고쳐 규칙에 어긋난 닉네임을 넣어도 받지 않아요", () => {
  for (const nickname of ["곰", "가나다라마바사아자차카", "www.a", "0101곰", "병신", "a@b"]) {
    assert.equal(parseProfile(JSON.stringify({ ...good, nickname })), null, nickname);
  }
});
