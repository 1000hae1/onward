import assert from "node:assert/strict";
import { test } from "node:test";
import { BLESSINGS, blessingText, GIFTS, giftName } from "../shared/gestures.ts";
import {
  autoNickname,
  checkNickname,
  nicknameMessage,
  NICKNAME_MAX,
  swapNicknameAnimal,
} from "../shared/nickname.ts";

const problem = (raw: string) => {
  const result = checkNickname(raw);
  return result.ok ? null : result.problem;
};

test("닉네임은 2~10자만 받아요", () => {
  assert.equal(problem("곰"), "short");
  assert.equal(problem("  곰  "), "short");
  assert.equal(problem(""), "short");
  assert.equal(problem("가나"), null);
  assert.equal(problem("가나다라마바사아자차"), null);
  assert.equal(problem("가나다라마바사아자차카"), "long");
});

test("이모지 하나는 한 글자로 세어요", () => {
  assert.equal(problem("🐻🐻"), null);
  assert.equal(problem("🐻"), "short");
});

test("앞뒤 공백과 겹친 공백을 정리해요", () => {
  assert.deepEqual(checkNickname("  졸린   수달 "), { ok: true, value: "졸린 수달" });
});

test("숫자가 4개 이상 이어지면 거절하고, 3개까지는 받아요", () => {
  assert.equal(problem("곰0101"), "digits");
  assert.equal(problem("0101곰"), "digits");
  assert.equal(problem("곰010"), null);
  assert.equal(problem("곰1호"), null);
});

test("이메일처럼 보이면 거절해요", () => {
  assert.equal(problem("a@b"), "email");
  assert.equal(problem("곰＠곰"), "email");
});

test("주소처럼 보이면 거절해요", () => {
  for (const raw of ["a.co", "www.a", "http:곰", "곰닷컴", "x.kr"]) assert.equal(problem(raw), "url", raw);
  assert.equal(problem("곰.곰"), null);
});

test("금칙어는 띄어 쓰거나 기호를 끼워도 거절해요", () => {
  for (const raw of ["병신", "병 신", "병-신", "FUCK", "관리자", "운영 자", "Admin", "운영진곰"]) {
    assert.equal(problem(raw), "banned", raw);
  }
});

test("흔한 낱말 안에 든 말은 잘못 거르지 않아요", () => {
  for (const raw of ["새끼 고양이", "의사소통", "간호사 곰"]) assert.equal(problem(raw), null, raw);
});

test("태그처럼 보이는 글자는 막지 않아요. 화면에는 textContent로만 넣어요", () => {
  assert.equal(problem("<b>곰</b>"), null);
});

test("안내 문구는 모두 해요체예요", () => {
  for (const code of ["short", "long", "digits", "url", "email", "banned"] as const) {
    assert.match(nicknameMessage(code), /요\.$/);
  }
});

test("자동 닉네임은 어떤 동물이어도 규칙 안에 들어요", () => {
  for (const animal of ["토끼", "곰", "펭귄", "수달", "사슴"]) {
    for (let index = 0; index < 100; index++) {
      const name = autoNickname(animal, index / 100);
      assert.ok(checkNickname(name).ok, name);
      assert.ok(Array.from(name).length <= NICKNAME_MAX);
      assert.ok(name.endsWith(` ${animal}`));
    }
  }
});

test("자동 닉네임은 동물을 바꿔도 형용사가 그대로예요", () => {
  assert.equal(swapNicknameAnimal("졸린 수달", "곰"), "졸린 곰");
});

test("한마디와 선물은 요청한 다섯 가지씩이고 번호로 찾아요", () => {
  assert.deepEqual(
    [...BLESSINGS],
    ["평안하시길", "편히 쉬시길", "좋은 밤 되시길", "행복하시길", "건강하시길"],
  );
  assert.deepEqual([...GIFTS], ["네잎클로버", "오잎클로버", "귤", "홍시", "호빵"]);
  assert.equal(blessingText(0), "평안하시길");
  assert.equal(blessingText(9), null);
  assert.equal(giftName(4), "호빵");
  assert.equal(giftName(-1), null);
});
