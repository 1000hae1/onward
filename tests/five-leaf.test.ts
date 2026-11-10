import assert from "node:assert/strict";
import { test } from "vitest";
import { createFiveLeafMemory } from "../src/net/five-leaf.ts";
import { GIFTS } from "../shared/gestures.ts";
import { FIVE_LEAF_ITEM } from "../shared/left-blessings.ts";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test("오잎클로버의 번호는 선물 표의 오잎클로버예요", () => {
  assert.equal(GIFTS[FIVE_LEAF_ITEM], "오잎클로버");
});

test("오잎클로버를 놓은 날에만 썼다고 기억하고, 다음 날이면 다시 놓을 수 있어요", () => {
  const memory = createFiveLeafMemory(memoryStorage());
  assert.equal(memory.used("2026-11-10"), false);
  memory.mark("2026-11-10");
  assert.equal(memory.used("2026-11-10"), true);
  assert.equal(memory.used("2026-11-11"), false);
});

test("새로고침해도 기억하고, 서버가 아직이라고 하면 지워요", () => {
  const storage = memoryStorage();
  createFiveLeafMemory(storage).mark("2026-11-10");
  const again = createFiveLeafMemory(storage);
  assert.equal(again.used("2026-11-10"), true);
  again.clear();
  assert.equal(createFiveLeafMemory(storage).used("2026-11-10"), false);
});

test("저장소를 쓸 수 없어도 이 화면에서는 기억해요", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const memory = createFiveLeafMemory(broken);
  memory.mark("2026-11-10");
  assert.equal(memory.used("2026-11-10"), true);
  assert.equal(createFiveLeafMemory(null).used("2026-11-10"), false);
});
