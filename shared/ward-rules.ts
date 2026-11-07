/**
 * 병동 서버의 판단이에요. Durable Object는 이 순수 함수만 부르고 결과를 보내요.
 * 하이버네이션 뒤에도 연결마다 붙은 정보만으로 다시 판단할 수 있게, 상태를 함수 밖에 두지 않아요.
 */
import { checkNickname } from "./nickname.ts";
import type { NicknameProblem } from "./nickname.ts";
import { chooseGiftSlot, GIFT_SLOTS_PER_STAND, LAMPS_PER_WINDOW } from "./offering-rules.ts";
import type { Guest, HelloMessage } from "./protocol.ts";
import { PLAYER_START, roomAt, WALK_AREAS } from "./ward-layout.ts";

/** 연결 하나에 붙여 두는 정보예요. 하이버네이션 뒤에 이것으로 병실을 다시 만들어요. */
export interface GuestRecord {
  id: string;
  guestId: string;
  animal: Guest["animal"];
  outfit: Guest["outfit"];
  nickname: string;
  withCat: boolean;
  x: number;
  z: number;
  bed: number | null;
  /** 동작별로 마지막에 받아 준 시각이에요. 밀리초예요. */
  lastAction: Partial<Record<"bless" | "bow" | "gift" | "lamp", number>>;
}

/** 같은 동작은 이만큼 간격을 둬요. */
export const ACTION_GAP_MS = 1000;
/** 한 사람이 하루에 놓을 수 있는 선물 수예요. */
export const GIFTS_PER_DAY = 10;
/** 귤·홍시·호빵의 번호예요. 겨울에만 놓을 수 있어요. */
const SEASONAL_ITEMS = new Set([2, 3, 4]);
const SEASONAL_MONTHS = new Set([11, 12, 1, 2]);

export function toPublic(record: GuestRecord): Guest {
  return {
    id: record.id,
    animal: record.animal,
    outfit: record.outfit,
    nickname: record.nickname,
    withCat: record.withCat,
    x: record.x,
    z: record.z,
    bed: record.bed,
  };
}

export type Admission =
  | { kind: "rejected"; problem: NicknameProblem }
  | { kind: "full" }
  /** 같은 guestId로 먼저 들어와 있던 연결이 있으면 그 연결을 내보내요. */
  | { kind: "admitted"; record: GuestRecord; replaces: string | null };

/** 들어오려는 사람을 받을지 정해요. others에는 이미 들어온 사람만 넣어요. */
export function admit(
  others: readonly GuestRecord[],
  hello: HelloMessage,
  capacity: number,
  newId: string,
): Admission {
  const nickname = checkNickname(hello.nickname);
  if (!nickname.ok) return { kind: "rejected", problem: nickname.problem };
  const same = others.find((record) => record.guestId === hello.guestId) ?? null;
  const count = others.length - (same ? 1 : 0);
  if (count >= capacity) return { kind: "full" };
  return {
    kind: "admitted",
    replaces: same?.id ?? null,
    record: {
      id: newId,
      guestId: hello.guestId,
      animal: hello.animal,
      outfit: hello.outfit,
      nickname: nickname.value,
      withCat: hello.withCat,
      x: PLAYER_START.x,
      z: PLAYER_START.z,
      bed: null,
      lastAction: {},
    },
  };
}

/** 들어와 있는 사람이 모습을 바꿀 때예요. 닉네임이 맞지 않으면 바꾸지 않아요. */
export function updateProfile(
  record: GuestRecord,
  hello: HelloMessage,
): { kind: "rejected"; problem: NicknameProblem } | { kind: "updated"; record: GuestRecord } {
  const nickname = checkNickname(hello.nickname);
  if (!nickname.ok) return { kind: "rejected", problem: nickname.problem };
  // 문병객으로 바꾸면 누워 있던 침대를 비워요.
  const bed = hello.outfit === "visitor" ? null : record.bed;
  return {
    kind: "updated",
    record: {
      ...record,
      animal: hello.animal,
      outfit: hello.outfit,
      nickname: nickname.value,
      withCat: hello.withCat,
      bed,
    },
  };
}

/** 점에서 가장 가까운, 걸을 수 있는 자리예요. 이미 걸을 수 있는 곳이면 그대로예요. */
export function clampToWalkable(x: number, z: number): { x: number; z: number } {
  let best = { x, z };
  let bestDistance = Infinity;
  for (const area of WALK_AREAS) {
    const cx = Math.min(area.maxX, Math.max(area.minX, x));
    const cz = Math.min(area.maxZ, Math.max(area.minZ, z));
    const distance = (cx - x) ** 2 + (cz - z) ** 2;
    if (distance === 0) return { x, z };
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: cx, z: cz };
    }
  }
  return best;
}

/**
 * 침대를 달라는 요청이에요. 메시지는 하나씩 차례로 처리되니, 먼저 처리된 사람이 가져가요.
 * 이미 다른 침대에 있었다면 그 침대는 비워요.
 */
export function claimBed(
  guests: readonly GuestRecord[],
  record: GuestRecord,
  bed: number,
): { granted: boolean; record: GuestRecord } {
  if (record.outfit !== "patient") return { granted: false, record };
  const taken = guests.some((other) => other.id !== record.id && other.bed === bed);
  if (taken) return { granted: false, record };
  return { granted: true, record: { ...record, bed } };
}

/** 한국 시간으로 몇 월인지예요. */
export function koreanMonth(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric" }).format(now));
}

/** 한국 시간의 날짜예요. 선물과 불빛을 하루 단위로 정리할 때 써요. */
export function koreanDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function seasonalGiftsAllowed(now: Date): boolean {
  return SEASONAL_MONTHS.has(koreanMonth(now));
}

export function giftAllowedNow(item: number, now: Date): boolean {
  return !SEASONAL_ITEMS.has(item) || seasonalGiftsAllowed(now);
}

/** 같은 동작을 너무 빨리 반복하지 않았는지예요. */
export function actionReady(record: GuestRecord, action: keyof GuestRecord["lastAction"], nowMs: number): boolean {
  const last = record.lastAction[action];
  return last === undefined || nowMs - last >= ACTION_GAP_MS;
}

/** 평안이나 선물을 보낼 침대예요. 사람을 고르면 그 사람이 누운 침대예요. */
export function resolveTarget(
  guests: readonly GuestRecord[],
  target: { bedId?: number; targetId?: string },
): { bedId: number | null; targetId: string | null } | null {
  if (target.bedId !== undefined) return { bedId: target.bedId, targetId: null };
  const person = guests.find((guest) => guest.id === target.targetId);
  if (!person) return null;
  return { bedId: person.bed, targetId: person.id };
}

/** 선물을 놓을 칸이에요. 차 있으면 가장 오래된 칸이에요. */
export function giftSlot(placed: readonly { slot: number; order: number; item: number }[]): number {
  const slots = Array.from({ length: GIFT_SLOTS_PER_STAND }, (_, slot) => {
    const found = placed.find((gift) => gift.slot === slot);
    return found ? { order: found.order, gift: found.item } : null;
  });
  return chooseGiftSlot(slots);
}

/** 불빛을 놓을 병실이에요. 병실 밖이거나 창이 가득 차면 이유를 돌려줘요. */
export function lampRoom(
  record: GuestRecord,
  counts: readonly number[],
): { room: number } | { denied: "not-in-room" | "lamp-full" } {
  const room = roomAt(record.x, record.z);
  if (!room) return { denied: "not-in-room" };
  if ((counts[room.index] ?? 0) >= LAMPS_PER_WINDOW) return { denied: "lamp-full" };
  return { room: room.index };
}
