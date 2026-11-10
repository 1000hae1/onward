import assert from "node:assert/strict";
import { test } from "vitest";
import {
  arrivedAtBed,
  becomeVisitor,
  bedProgress,
  canStartGesture,
  createLocalBedGate,
  FREE,
  needsMoveConfirm,
  tapBed,
  tapFloor,
  tickFlow,
} from "../src/ward/bed-flow.ts";
import type { BedFlow } from "../src/ward/bed-flow.ts";

const D = 1;
const patient = { canLie: true, isFree: true };
const visitor = { canLie: false, isFree: true };
const point = { x: 1, z: 2 };
const lying = (bed: number): BedFlow => ({ kind: "lying", bed });

test("빈 침대를 누르면 걸어가고, 닿으면 눕기 시작해요", () => {
  const go = tapBed(FREE, 3, patient, D);
  assert.deepEqual(go.flow, { kind: "heading", bed: 3, lie: true });
  assert.deepEqual(go.walk, { kind: "bed", bed: 3, lie: true });
  assert.deepEqual(arrivedAtBed(go.flow, true).flow, { kind: "entering", bed: 3, elapsed: 0 });
});

test("걸어가는 사이 누가 먼저 누우면 그 자리에 서 있어요", () => {
  const go = tapBed(FREE, 3, patient, D);
  assert.deepEqual(arrivedAtBed(go.flow, false).flow, FREE);
});

test("다른 사람이 있는 침대는 환자가 눌러도 움직이지 않아요", () => {
  const step = tapBed(FREE, 3, { canLie: true, isFree: false }, D);
  assert.deepEqual(step.flow, FREE);
  assert.equal(step.walk, undefined);
});

test("눕기는 정해진 시간 뒤에 끝나요", () => {
  let flow: BedFlow = { kind: "entering", bed: 1, elapsed: 0 };
  flow = tickFlow(flow, 0.5, D).flow;
  assert.equal(bedProgress(flow, D), 0.5);
  flow = tickFlow(flow, 0.5, D).flow;
  assert.deepEqual(flow, lying(1));
  assert.equal(bedProgress(flow, D), 1);
});

test("누운 침대를 다시 누르면 일어나고 침대를 내놓아요", () => {
  const step = tapBed(lying(2), 2, patient, D);
  assert.equal(step.flow.kind, "leaving");
  assert.equal(step.release, 2);
  assert.equal(step.walk, undefined);
  const after = tickFlow(step.flow, D, D);
  assert.deepEqual(after.flow, FREE);
  assert.equal(after.walk, undefined);
});

test("누운 채 바닥을 누르면 일어난 뒤에 걸어가요", () => {
  const step = tapFloor(lying(2), point, D);
  assert.equal(step.flow.kind, "leaving");
  assert.equal(step.release, 2);
  assert.equal(step.walk, undefined);
  const after = tickFlow(step.flow, D, D);
  assert.deepEqual(after.flow, FREE);
  assert.deepEqual(after.walk, { kind: "spot", point });
});

test("누운 채 다른 침대를 누르면 일어나서 그 침대로 가요", () => {
  const step = tapBed(lying(2), 5, patient, D);
  assert.equal(step.release, 2);
  const after = tickFlow(step.flow, D, D);
  assert.deepEqual(after.flow, { kind: "heading", bed: 5, lie: true });
  assert.deepEqual(after.walk, { kind: "bed", bed: 5, lie: true });
});

test("누운 채 다른 사람이 있는 침대를 누르면 그대로 누워 있어요", () => {
  const step = tapBed(lying(2), 5, { canLie: true, isFree: false }, D);
  assert.deepEqual(step.flow, lying(2));
  assert.equal(step.release, undefined);
});

test("침대로 가는 중 바닥을 누르면 눕기를 취소해요", () => {
  const step = tapFloor({ kind: "heading", bed: 2, lie: true }, point, D);
  assert.deepEqual(step.flow, FREE);
  assert.deepEqual(step.walk, { kind: "spot", point });
});

test("가고 있는 침대를 또 눌러도 길을 다시 찾지 않아요", () => {
  const flow: BedFlow = { kind: "heading", bed: 2, lie: true };
  const step = tapBed(flow, 2, patient, D);
  assert.deepEqual(step.flow, flow);
  assert.equal(step.walk, undefined);
});

test("눕던 중에 일어나면 누운 만큼만 되돌아요", () => {
  const entering: BedFlow = { kind: "entering", bed: 1, elapsed: 0.3 };
  const step = tapFloor(entering, point, D);
  assert.equal(bedProgress(step.flow, D), 0.3);
  assert.equal(step.release, 1);
  // 자세가 튀지 않고 줄어들기만 해요.
  const later = tickFlow(step.flow, 0.1, D).flow;
  assert.ok(Math.abs(bedProgress(later, D) - 0.2) < 1e-9);
  assert.deepEqual(tickFlow(later, 0.5, D).flow, FREE);
});

test("일어나는 중에는 마지막으로 누른 곳으로 가요", () => {
  const leaving: BedFlow = { kind: "leaving", bed: 1, remaining: 0.5, next: null };
  const first = tapFloor(leaving, point, D);
  const second = tapBed(first.flow, 4, patient, D);
  assert.deepEqual(tickFlow(second.flow, 1, D).walk, { kind: "bed", bed: 4, lie: true });
});

test("문병객은 침대에 눕지 않고 곁에서 목례해요", () => {
  const go = tapBed(FREE, 3, visitor, D);
  assert.deepEqual(go.flow, { kind: "heading", bed: 3, lie: false });
  const arrived = arrivedAtBed(go.flow, false);
  assert.deepEqual(arrived.flow, FREE);
  assert.equal(arrived.bowAtBed, 3);
});

test("문병객은 누가 있는 침대에도 찾아가요", () => {
  const go = tapBed(FREE, 3, { canLie: false, isFree: false }, D);
  assert.equal(go.flow.kind, "heading");
});

test("누운 채 문병객으로 바꾸면 일어나요", () => {
  const step = becomeVisitor(lying(2), D);
  assert.equal(step.flow.kind, "leaving");
  assert.equal(step.release, 2);
  const heading = becomeVisitor({ kind: "heading", bed: 1, lie: true }, D);
  assert.deepEqual(heading.flow, { kind: "heading", bed: 1, lie: false });
  const pending = becomeVisitor(
    { kind: "leaving", bed: 1, remaining: 0.5, next: { kind: "bed", bed: 4, lie: true } },
    D,
  );
  assert.deepEqual(tickFlow(pending.flow, 1, D).flow, { kind: "heading", bed: 4, lie: false });
});

test("한 침대에는 한 명만 누워요", () => {
  const gate = createLocalBedGate();
  assert.equal(gate.request(7), true);
  assert.equal(gate.isFree(7), false);
  assert.equal(gate.request(7), false);
  gate.release(7);
  assert.equal(gate.request(7), true);
});

test("침대에 오르내리거나 누운 동안에는 동작을 시작하지 않아요", () => {
  assert.equal(canStartGesture(FREE), true);
  assert.equal(canStartGesture({ kind: "heading", bed: 1, lie: true }), true);
  assert.equal(canStartGesture({ kind: "entering", bed: 1, elapsed: 0 }), false);
  assert.equal(canStartGesture(lying(1)), false);
  assert.equal(canStartGesture({ kind: "leaving", bed: 1, remaining: 1, next: null }), false);
});

test("누운 채로 다른 침대를 누를 때만 옮길지 물어요", () => {
  assert.equal(needsMoveConfirm(lying(2), 4, true), true);
  assert.equal(needsMoveConfirm({ kind: "entering", bed: 2, elapsed: 0.3 }, 4, true), true);
  // 내 침대를 다시 누르면 일어나는 것이니 묻지 않아요.
  assert.equal(needsMoveConfirm(lying(2), 2, true), false);
  // 서 있거나 걸어가는 중이면 바로 가요.
  assert.equal(needsMoveConfirm(FREE, 4, true), false);
  assert.equal(needsMoveConfirm({ kind: "heading", bed: 2, lie: true }, 4, true), false);
  assert.equal(needsMoveConfirm({ kind: "leaving", bed: 2, remaining: 0.5, next: null }, 4, true), false);
  // 문병객은 눕지 않아요.
  assert.equal(needsMoveConfirm(lying(2), 4, false), false);
});
