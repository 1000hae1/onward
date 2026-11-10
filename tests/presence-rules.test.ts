import assert from "node:assert/strict";
import { test } from "vitest";
import {
  headcount,
  MAX_ROOM_HEADCOUNT,
  PRESENCE_REFRESH_MS,
  PRESENCE_STALE_MS,
  presenceChange,
  shouldReport,
  statsTimestamp,
  tally,
} from "../shared/presence-rules.ts";
import type { PresenceRow } from "../shared/presence-rules.ts";

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const visit = { owner: "o", bed: 1, session: "s", ownerNickname: "n" };

test("환자와 문병객을 따로 세요", () => {
  assert.deepEqual(headcount([{}, {}, { visit }, {}]), { patients: 3, visitors: 1 });
  assert.deepEqual(headcount([]), { patients: 0, visitors: 0 });
});

test("처음 보고는 사람이 있을 때만 해요", () => {
  assert.equal(shouldReport(null, { patients: 0, visitors: 0 }, NOW), false);
  assert.equal(shouldReport(null, { patients: 1, visitors: 0 }, NOW), true);
  assert.equal(shouldReport(null, { patients: 0, visitors: 1 }, NOW), true);
});

test("값이 바뀌면 알리고, 같으면 알리지 않아요", () => {
  const last = { patients: 2, visitors: 1, at: NOW };
  assert.equal(shouldReport(last, { patients: 2, visitors: 1 }, NOW + 1000), false);
  assert.equal(shouldReport(last, { patients: 3, visitors: 1 }, NOW + 1000), true);
  assert.equal(shouldReport(last, { patients: 2, visitors: 0 }, NOW + 1000), true);
  // 모두 나가서 0이 되면 알려서 directory가 지우게 해요.
  assert.equal(shouldReport(last, { patients: 0, visitors: 0 }, NOW + 1000), true);
});

test("값이 같아도 마지막 보고가 오래됐으면 이벤트 때 다시 알려요. 빈 병실은 다시 알리지 않아요", () => {
  const last = { patients: 2, visitors: 0, at: NOW };
  assert.equal(shouldReport(last, { patients: 2, visitors: 0 }, NOW + PRESENCE_REFRESH_MS - 1), false);
  assert.equal(shouldReport(last, { patients: 2, visitors: 0 }, NOW + PRESENCE_REFRESH_MS), true);
  const empty = { patients: 0, visitors: 0, at: NOW };
  assert.equal(shouldReport(empty, { patients: 0, visitors: 0 }, NOW + PRESENCE_STALE_MS), false);
});

test("아무도 없는 병실은 지워요", () => {
  assert.deepEqual(presenceChange("ward-1-1", { patients: 0, visitors: 0 }, NOW), { kind: "delete", room: "ward-1-1" });
});

test("현재값을 그대로 적어서 같은 보고가 두 번 와도 숫자가 늘지 않아요", () => {
  const first = presenceChange("ward-1-1", { patients: 3, visitors: 1 }, NOW);
  const again = presenceChange("ward-1-1", { patients: 3, visitors: 1 }, NOW + 5);
  assert.equal(first.kind, "upsert");
  assert.equal(again.kind, "upsert");
  if (first.kind !== "upsert" || again.kind !== "upsert") return;
  // 같은 병실 이름으로 덮어쓰니 표에는 한 줄만 남아요.
  const table = new Map<string, PresenceRow>();
  table.set(first.row.room, first.row);
  table.set(again.row.room, again.row);
  assert.equal(tally([...table.values()], NOW + 10).online, 4);
});

test("이상한 병실 이름이나 숫자는 받지 않아요", () => {
  assert.equal(presenceChange("health", { patients: 1, visitors: 0 }, NOW).kind, "ignore");
  assert.equal(presenceChange("ward-1-1", { patients: -1, visitors: 0 }, NOW).kind, "ignore");
  assert.equal(presenceChange("ward-1-1", { patients: 1.5, visitors: 0 }, NOW).kind, "ignore");
  assert.equal(presenceChange("ward-1-1", { patients: MAX_ROOM_HEADCOUNT + 1, visitors: 0 }, NOW).kind, "ignore");
  assert.equal(presenceChange("ward-1-1", { patients: Number.NaN, visitors: 0 }, NOW).kind, "ignore");
});

test("문병객도 접속자에 넣고, 사람이 있는 병실만 세요", () => {
  const rows: PresenceRow[] = [
    { room: "ward-1-1", patients: 5, visitors: 2, at: NOW },
    { room: "ward-1-2", patients: 0, visitors: 3, at: NOW },
    { room: "ward-2-1", patients: 0, visitors: 0, at: NOW },
  ];
  assert.deepEqual(tally(rows, NOW), { online: 10, wards: 2, stale: [] });
});

test("오래 소식이 없는 병실은 세지 않고 지울 목록에 넣어요", () => {
  const rows: PresenceRow[] = [
    { room: "ward-1-1", patients: 4, visitors: 0, at: NOW - PRESENCE_STALE_MS - 1 },
    { room: "ward-1-2", patients: 2, visitors: 0, at: NOW - PRESENCE_STALE_MS },
  ];
  assert.deepEqual(tally(rows, NOW), { online: 2, wards: 1, stale: ["ward-1-1"] });
});

test("아무도 없으면 0이에요", () => {
  assert.deepEqual(tally([], NOW), { online: 0, wards: 0, stale: [] });
});

test("시각은 밀리초 없이 UTC로 적어요", () => {
  assert.equal(statsTimestamp(NOW + 789), "2026-11-09T12:00:00Z");
});
