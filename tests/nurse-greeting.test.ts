import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createNurseGreeter,
  NURSE_BOW_ANGLE,
  NURSE_BOW_SECONDS,
  NURSE_MET_KEY,
  NURSE_WELCOME_BACK_TEXT,
  NURSE_WELCOME_TEXT,
  nurseBowAngle,
} from "../src/ward/nurse-greeting.ts";

const memoryStore = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map };
};

test("처음 들어오면 반기고, 다시 들어오면 \"다시 오셨네요\"예요", () => {
  const store = memoryStore();
  const greet = createNurseGreeter(store);
  assert.equal(greet(), NURSE_WELCOME_TEXT);
  assert.equal(greet(), NURSE_WELCOME_BACK_TEXT);
  assert.equal(store.map.get(NURSE_MET_KEY), "1");
  // 다른 날 다시 와도 이 기기에서 만난 적이 있으면 "다시 오셨네요"예요.
  assert.equal(createNurseGreeter(store)(), NURSE_WELCOME_BACK_TEXT);
});

test("저장할 수 없어도 이번 방문 안에서는 두 번째부터 \"다시 오셨네요\"예요", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const greet = createNurseGreeter(broken);
  assert.equal(greet(), NURSE_WELCOME_TEXT);
  assert.equal(greet(), NURSE_WELCOME_BACK_TEXT);
  assert.equal(createNurseGreeter(null)(), NURSE_WELCOME_TEXT);
});

test("인사 문구는 해요체이고 금지된 말을 쓰지 않아요", () => {
  for (const text of [NURSE_WELCOME_TEXT, NURSE_WELCOME_BACK_TEXT]) {
    assert.ok(!text.includes("괜찮아요") && !text.includes("힘내요"));
  }
});

test("고개는 천천히 숙였다가 다시 들어요", () => {
  assert.equal(nurseBowAngle(0), 0);
  assert.equal(nurseBowAngle(NURSE_BOW_SECONDS), 0);
  assert.equal(nurseBowAngle(NURSE_BOW_SECONDS * 0.5), NURSE_BOW_ANGLE);
  assert.ok(nurseBowAngle(NURSE_BOW_SECONDS * 0.1) < nurseBowAngle(NURSE_BOW_SECONDS * 0.3));
});
