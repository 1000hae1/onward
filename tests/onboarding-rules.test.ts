import assert from "node:assert/strict";
import { test } from "vitest";
import { BEDS } from "../shared/ward-layout";
import {
  bubbleContent,
  firstStep,
  guideSpot,
  nextOnboarding,
  OFF,
  onboardingStart,
  ONBOARDING_TEXT,
  othersInMyRoom,
  parseOnboardingRecord,
} from "../src/ui/onboarding-rules";
import type { OnboardingState } from "../src/ui/onboarding-rules";

const step = (n: 1 | 2 | 3): OnboardingState => ({ kind: "step", step: n });

test("기록은 done과 skipped만 읽어요", () => {
  assert.equal(parseOnboardingRecord("done"), "done");
  assert.equal(parseOnboardingRecord("skipped"), "skipped");
  assert.equal(parseOnboardingRecord(null), null);
  assert.equal(parseOnboardingRecord("yes"), null);
});

test("처음 들어온 분에게만 안내를 시작해요", () => {
  assert.equal(onboardingStart({ record: null, returning: false, viaLink: false }), "start");
  // 끝냈거나 건너뛰었으면 다시 나오지 않아요.
  assert.equal(onboardingStart({ record: "done", returning: false, viaLink: false }), "none");
  assert.equal(onboardingStart({ record: "skipped", returning: false, viaLink: false }), "none");
  // 방명록·문병 링크로 왔으면 안 나와요.
  assert.equal(onboardingStart({ record: null, returning: false, viaLink: true }), "none");
  assert.equal(onboardingStart({ record: null, returning: true, viaLink: true }), "none");
  // 이 기능 전부터 오던 분은 보여 주지 않고 끝낸 것으로 적어요.
  assert.equal(onboardingStart({ record: null, returning: true, viaLink: false }), "mark-done");
});

test("문병객이거나 이미 침대가 있으면 2단계부터예요", () => {
  assert.equal(firstStep({ canLie: true, ownsBed: false }), 1);
  assert.equal(firstStep({ canLie: false, ownsBed: false }), 2);
  assert.equal(firstStep({ canLie: true, ownsBed: true }), 2);
});

test("사용자가 직접 해야 다음 단계로 가요", () => {
  assert.deepEqual(nextOnboarding(step(1), "bed-owned"), { state: step(2), record: null });
  assert.deepEqual(nextOnboarding(step(2), "blessed"), { state: step(3), record: null });
  assert.deepEqual(nextOnboarding(step(3), "link-shared"), { state: { kind: "farewell" }, record: "done" });
  assert.deepEqual(nextOnboarding(step(3), "later"), { state: { kind: "farewell" }, record: "done" });
  // 순서에 맞지 않는 행동은 단계를 건너뛰게 하지 않아요.
  assert.deepEqual(nextOnboarding(step(1), "blessed"), { state: step(1), record: null });
  assert.deepEqual(nextOnboarding(step(2), "link-shared"), { state: step(2), record: null });
  assert.deepEqual(nextOnboarding(step(2), "later"), { state: step(2), record: null });
});

test("건너뛰면 이 단계만 넘기고 다음 단계로 가요. 3단계를 넘기면 마지막 한마디예요", () => {
  assert.deepEqual(nextOnboarding(step(1), "skip"), { state: step(2), record: null });
  assert.deepEqual(nextOnboarding(step(2), "skip"), { state: step(3), record: null });
  assert.deepEqual(nextOnboarding(step(3), "skip"), { state: { kind: "farewell" }, record: "done" });
  assert.deepEqual(nextOnboarding(OFF, "skip"), { state: OFF, record: null });
  assert.deepEqual(nextOnboarding({ kind: "farewell" }, "skip"), { state: { kind: "farewell" }, record: null });
});

test("어느 단계에서든 [안내 그만 보기]면 바로 꺼지고 skipped로 적어요", () => {
  for (const n of [1, 2, 3] as const) assert.deepEqual(nextOnboarding(step(n), "quit"), { state: OFF, record: "skipped" });
  assert.deepEqual(nextOnboarding({ kind: "farewell" }, "quit"), { state: { kind: "farewell" }, record: null });
});

test("같은 병실의 다른 침대에 누가 있는지 봐요", () => {
  const mine = 0;
  const room = BEDS[mine].roomIndex;
  const neighbor = BEDS.findIndex((bed, index) => index !== mine && bed.roomIndex === room);
  const elsewhere = BEDS.findIndex((bed) => bed.roomIndex !== room);
  assert.equal(othersInMyRoom(mine, (bed) => bed === neighbor), true);
  assert.equal(othersInMyRoom(mine, (bed) => bed === elsewhere), false);
  assert.equal(othersInMyRoom(mine, () => false), false);
  assert.equal(othersInMyRoom(null, () => true), false);
});

test("말풍선 글은 단계와 병실 상황에 맞춰요", () => {
  const room = { inRoom: true, othersInRoom: false };
  assert.equal(bubbleContent(OFF, room), null);
  assert.deepEqual(bubbleContent(step(1), room), { text: ONBOARDING_TEXT.step1, sub: null, actions: false, skip: true });
  assert.equal(bubbleContent(step(1), { inRoom: false, othersInRoom: false })?.sub, ONBOARDING_TEXT.step1Lobby);
  assert.equal(bubbleContent(step(2), { inRoom: true, othersInRoom: true })?.text, "옆 침대 분께 평안을 빌어 보세요");
  assert.equal(bubbleContent(step(2), room)?.text, "빈 침대에도 평안을 남길 수 있어요. 다음에 눕는 분께 닿아요");
  assert.deepEqual(bubbleContent(step(3), room), { text: ONBOARDING_TEXT.step3, sub: null, actions: true, skip: true });
  assert.deepEqual(bubbleContent({ kind: "farewell" }, room), { text: "편히 쉬다 가세요", sub: null, actions: false, skip: false });
});

test("쓰지 않기로 한 말은 없어요", () => {
  const all = Object.values(ONBOARDING_TEXT).join(" ");
  assert.ok(!all.includes("괜찮아요?"));
  assert.ok(!all.includes("힘내요"));
});

test("간호사는 화면에서 내 오른쪽 옆에 서요", () => {
  const spot = guideSpot({ x: 2, z: 3 }, { x: 0, z: -5 }, 1.1);
  assert.ok(Math.abs(spot.x - 2) < 1e-9 && Math.abs(spot.z - (3 - 1.1)) < 1e-9);
  // 방향을 알 수 없으면 +x 쪽에 서요.
  assert.deepEqual(guideSpot({ x: 0, z: 0 }, { x: 0, z: 0 }, 1), { x: 1, z: 0 });
});
