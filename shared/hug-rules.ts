/**
 * 안아 주기의 판단이에요. 서버가 이 순수 함수로 거리·횟수·설정을 살피고, Durable Object는 결과대로 저장하고 보내요.
 * 답을 기다리는 타이머는 두지 않아요. 답이 오면 그때 시각을 견줘요.
 */
import type { GuestRecord } from "./ward-rules.ts";
import { clampToWalkable, hugAvailable } from "./ward-rules.ts";
import { bedApproach, BEDS } from "./ward-layout.ts";

/** 이만큼 가까이 있어야 안아 줄 수 있어요. 미터예요. */
export const HUG_DISTANCE = 2;
/** 같은 분께는 이만큼 지나야 다시 요청할 수 있어요. */
export const HUG_REPEAT_MS = 10 * 60_000;
/** 받은 사람이 답할 수 있는 시간이에요. 화면은 이만큼 지나면 조용히 닫아요. */
export const HUG_ANSWER_MS = 10_000;
/** 화면과 서버 사이 지연을 생각해 서버는 조금 더 기다려 줘요. */
const ANSWER_GRACE_MS = 2_000;
/** 꼭 안고 있는 시간이에요. */
export const HUG_SECONDS = 3;

export type HugDenied = "no-target" | "too-far" | "too-soon" | "unavailable";
export type HugCheck = { ok: true } | { ok: false; reason: HugDenied };

/** 서버가 기억하는 기다리는 요청이에요. */
export interface PendingHug {
  id: string;
  fromId: string;
  fromKey: string;
  toId: string;
  at: number;
}

/**
 * 안아 주기 요청을 받아도 되는지예요. lastSentAt은 같은 사람이 같은 상대(guestId 해시 기준)에게 마지막으로 보낸 시각이에요.
 * 문병객은 문병 온 주인만 안아 줄 수 있어요.
 */
export function checkHugRequest(
  from: GuestRecord,
  to: GuestRecord | null,
  lastSentAt: number | null,
  nowMs: number,
): HugCheck {
  if (!to || to.id === from.id || from.discharge) return { ok: false, reason: "no-target" };
  if (from.key !== undefined && to.key === from.key) return { ok: false, reason: "no-target" };
  if (from.visit && to.key !== from.visit.owner) return { ok: false, reason: "no-target" };
  if (!hugAvailable(to)) return { ok: false, reason: "unavailable" };
  if (Math.hypot(from.x - to.x, from.z - to.z) > HUG_DISTANCE) return { ok: false, reason: "too-far" };
  if (lastSentAt !== null && nowMs - lastSentAt < HUG_REPEAT_MS) return { ok: false, reason: "too-soon" };
  return { ok: true };
}

export type HugAnswerCheck = "ok" | "unknown" | "expired";

/** 받은 답이 아직 유효한지예요. 받는 사람 본인의 답만 받아요. 시간이 지났으면 아무 말 없이 버려요. */
export function checkHugAnswer(pending: PendingHug | null, answererId: string, nowMs: number): HugAnswerCheck {
  if (!pending || pending.toId !== answererId) return "unknown";
  if (nowMs - pending.at > HUG_ANSWER_MS + ANSWER_GRACE_MS) return "expired";
  return "ok";
}

/**
 * 수락했을 때 정말 안을 수 있는지 다시 봐요. 그사이 멀어졌거나 잠들었으면 조용히 그만둬요.
 * 받는 사람은 이미 답했으니 잠들었는지만 봐요.
 */
export function hugStillPossible(from: GuestRecord | null, to: GuestRecord | null): boolean {
  if (!from || !to || from.discharge || to.discharge) return false;
  return Math.hypot(from.x - to.x, from.z - to.z) <= HUG_DISTANCE + 0.5;
}

/** 안아 주는 사람이 설 자리예요. 상대가 누워 있으면 침대 곁, 서 있으면 상대 앞 0.6m예요. 화면과 서버가 함께 써요. */
export function hugSpot(
  from: { x: number; z: number },
  to: { x: number; z: number; bed: number | null },
): { x: number; z: number } {
  if (to.bed !== null && BEDS[to.bed]) {
    const approach = bedApproach(BEDS[to.bed]);
    return clampToWalkable(approach.x, approach.z);
  }
  const dx = from.x - to.x;
  const dz = from.z - to.z;
  const length = Math.hypot(dx, dz);
  const unitX = length > 0.01 ? dx / length : 0;
  const unitZ = length > 0.01 ? dz / length : 1;
  return clampToWalkable(to.x + unitX * HUG_GAP, to.z + unitZ * HUG_GAP);
}

/** 서서 안을 때 두 사람 사이 거리예요. */
export const HUG_GAP = 0.6;

/** 받는 사람에게 보여 줄 문장이에요. */
export function hugOfferText(nickname: string): string {
  return `${nickname}님이 안아 주려고 해요`;
}

export const HUG_DECLINED_TEXT = "지금은 쉬고 싶은가 봐요. 다음에 또 안아 주세요.";

export const HUG_DENIED_TEXT: Record<HugDenied, string> = {
  "no-target": "지금은 안아 줄 수 없어요.",
  "too-far": "조금 더 가까이 다가가 주세요.",
  "too-soon": "조금 뒤에 다시 안아 줄 수 있어요.",
  unavailable: "지금은 쉬고 있어요. 다음에 안아 주세요.",
};

/** 다른 동물 메뉴의 [안아 주기] 상태예요. 할 수 없으면 버튼을 끄고 이유를 보여 줘요. 마지막 판단은 서버가 해요. */
export type HugMenuState = { enabled: true } | { enabled: false; reason: string };

export const HUG_OFFLINE_TEXT = "병동 서버에 닿으면 안아 줄 수 있어요.";
export const HUG_LEAVING_TEXT = "퇴원하는 중에는 안아 줄 수 없어요.";

export function hugMenuState(input: {
  online: boolean;
  /** 내가 퇴원하는 중인지예요. */
  leaving: boolean;
  me: { x: number; z: number };
  /** 상대의 자리와, 지금 요청을 받을 수 있는지(잠들었거나 받지 않기면 false)예요. */
  target: { x: number; z: number; hugOk: boolean };
  /** 이 화면에서 같은 분께 마지막으로 요청한 시각이에요. */
  lastSentAt: number | null;
  nowMs: number;
}): HugMenuState {
  if (!input.online) return { enabled: false, reason: HUG_OFFLINE_TEXT };
  if (input.leaving) return { enabled: false, reason: HUG_LEAVING_TEXT };
  if (!input.target.hugOk) return { enabled: false, reason: HUG_DENIED_TEXT.unavailable };
  if (input.lastSentAt !== null && input.nowMs - input.lastSentAt < HUG_REPEAT_MS) {
    return { enabled: false, reason: HUG_DENIED_TEXT["too-soon"] };
  }
  if (Math.hypot(input.me.x - input.target.x, input.me.z - input.target.z) > HUG_DISTANCE) {
    return { enabled: false, reason: HUG_DENIED_TEXT["too-far"] };
  }
  return { enabled: true };
}
