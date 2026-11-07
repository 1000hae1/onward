/**
 * 병동 서버의 판단이에요. Durable Object는 이 순수 함수만 부르고 결과를 보내요.
 * 하이버네이션 뒤에도 연결마다 붙은 정보만으로 다시 판단할 수 있게, 상태를 함수 밖에 두지 않아요.
 */
import { checkNickname } from "./nickname.ts";
import type { NicknameProblem } from "./nickname.ts";
import { chooseGiftSlot, GIFT_SLOTS_PER_STAND, LAMPS_PER_WINDOW } from "./offering-rules.ts";
import type { Guest, HelloMessage } from "./protocol.ts";
import { BEDS, PLAYER_START, ROOMS, roomAt, WALK_AREAS } from "./ward-layout.ts";

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
  /** 이번 입장에서 받은 평안 주소예요. 다른 사람에게 보여도 되는 값이에요. 서버는 연결 정보에만 들고 있어요. */
  address: string;
  /** 침대를 받은 시각이에요. 밀리초예요. 병동 고양이가 찾아올 때를 정해요. */
  lyingSince: number | null;
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
    address: record.address,
  };
}

export type Admission =
  | { kind: "rejected"; problem: NicknameProblem }
  | { kind: "full" }
  /** 같은 guestId로 먼저 들어와 있던 연결이 있으면 그 연결을 내보내요. */
  | { kind: "admitted"; record: GuestRecord; replaces: string | null; restored: boolean };

/**
 * 들어오려는 사람을 받을지 정해요. others에는 연결된 사람, awayCount에는 잠시 끊긴 사람 수를 넣어요.
 * returning은 30초 안에 돌아온 같은 사람의 기록이에요. 자리가 이미 맡아져 있으니 정원을 다시 세지 않아요.
 */
export function admit(
  others: readonly GuestRecord[],
  awayCount: number,
  hello: HelloMessage,
  capacity: number,
  newId: string,
  returning: GuestRecord | null = null,
): Admission {
  const nickname = checkNickname(hello.nickname);
  if (!nickname.ok) return { kind: "rejected", problem: nickname.problem };
  const same = others.find((record) => record.guestId === hello.guestId) ?? null;
  if (returning) {
    const bed = hello.outfit === "visitor" ? null : returning.bed;
    return {
      kind: "admitted",
      replaces: same?.id ?? null,
      restored: true,
      record: {
        ...returning,
        guestId: hello.guestId,
        animal: hello.animal,
        outfit: hello.outfit,
        nickname: nickname.value,
        withCat: hello.withCat,
        bed,
        lyingSince: bed === null ? null : returning.lyingSince,
      },
    };
  }
  const count = others.length + awayCount - (same ? 1 : 0);
  if (count >= capacity) return { kind: "full" };
  return {
    kind: "admitted",
    replaces: same?.id ?? null,
    restored: false,
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
      address: "",
      lyingSince: null,
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
  const lyingSince = bed === null ? null : record.lyingSince;
  return {
    kind: "updated",
    record: {
      ...record,
      animal: hello.animal,
      outfit: hello.outfit,
      nickname: nickname.value,
      withCat: hello.withCat,
      bed,
      lyingSince,
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
  nowMs: number,
): { granted: boolean; record: GuestRecord } {
  if (record.outfit !== "patient") return { granted: false, record };
  const taken = guests.some((other) => other.id !== record.id && other.bed === bed);
  if (taken) return { granted: false, record };
  // 같은 침대를 다시 받으면 누운 시각은 그대로예요.
  const lyingSince = record.bed === bed && record.lyingSince !== null ? record.lyingSince : nowMs;
  return { granted: true, record: { ...record, bed, lyingSince } };
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

/** 연결이 끊긴 뒤 이 시간 안에 돌아오면 침대와 자리를 그대로 돌려줘요. */
export const GRACE_MS = 30_000;

/** 잠시 끊긴 사람이에요. guestId는 해시로만 두고, 기록 안의 guestId는 비워 둬요. */
export interface AwayGuest {
  key: string;
  record: GuestRecord;
  until: number;
}

export function toAway(record: GuestRecord, key: string, nowMs: number): AwayGuest {
  return { key, record: { ...record, guestId: "" }, until: nowMs + GRACE_MS };
}

/** 유예가 끝난 사람과 남은 사람을 나누고, 다음 alarm 시각을 알려 줘요. 남은 사람이 없으면 null이에요. */
export function expireAway(
  away: readonly AwayGuest[],
  nowMs: number,
): { expired: AwayGuest[]; kept: AwayGuest[]; nextAlarm: number | null } {
  const expired = away.filter((guest) => guest.until <= nowMs);
  const kept = away.filter((guest) => guest.until > nowMs);
  return { expired, kept, nextAlarm: nextAlarmAt(kept) };
}

export function nextAlarmAt(away: readonly { until: number }[]): number | null {
  return away.length === 0 ? null : Math.min(...away.map((guest) => guest.until));
}

/** 이미 맞춰 둔 alarm이 있으면 더 이른 경우에만 바꿔요. 바꿀 필요가 없으면 null이에요. */
export function alarmToSet(current: number | null, wanted: number | null): number | null {
  if (wanted === null) return null;
  if (current !== null && current <= wanted) return null;
  return wanted;
}

/** 정원이 차면 가 볼 다음 병실이에요. 끝 번호 다음은 1번이에요. */
export function nextInstance(instance: number, max: number): number {
  return instance >= max ? 1 : instance + 1;
}

/** 메시지의 v만 느슨하게 읽어요. 버전이 다른지 알아볼 때 써요. JSON이 아니거나 v가 없으면 null이에요. */
export function readVersion(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && typeof (value as { v?: unknown }).v === "number") {
      return (value as { v: number }).v;
    }
  } catch {
    return null;
  }
  return null;
}

/** 오래 혼자 누워 있으면 병동 고양이가 찾아와요. */
export const CAT_VISIT_AFTER_MS = 120_000;

export interface CatVisit {
  room: number;
  bed: number;
  /** 서버 시각으로 고양이가 출발하는 때예요. */
  at: number;
}

/**
 * 병실마다 고양이가 찾아갈 침대와 시각이에요. 이 병실에 그 사람 말고 아무도 없을 때만 찾아가고,
 * 여럿이 혼자 누워 있을 수는 없으니 병실마다 많아야 하나예요.
 * 입장·퇴장·눕기·일어나기·병실 이동 때만 다시 계산해요. 그래서 시간이 흘러도 방송할 일이 없어요.
 */
export function catVisits(guests: readonly GuestRecord[]): CatVisit[] {
  const visits: CatVisit[] = [];
  for (const room of ROOMS) {
    const inRoom = guests.filter((guest) => roomAt(guest.x, guest.z)?.index === room.index);
    if (inRoom.length !== 1) continue;
    const [only] = inRoom;
    if (only.bed === null || only.lyingSince === null) continue;
    if (BEDS[only.bed]?.roomIndex !== room.index) continue;
    visits.push({ room: room.index, bed: only.bed, at: only.lyingSince + CAT_VISIT_AFTER_MS });
  }
  return visits;
}

/** 바뀐 병실만 골라요. 사라진 병실은 null이에요. */
export function changedVisits(
  before: readonly CatVisit[],
  after: readonly CatVisit[],
): { room: number; visit: CatVisit | null }[] {
  const changes: { room: number; visit: CatVisit | null }[] = [];
  for (const room of ROOMS) {
    const a = before.find((visit) => visit.room === room.index) ?? null;
    const b = after.find((visit) => visit.room === room.index) ?? null;
    if (a?.bed === b?.bed && a?.at === b?.at) continue;
    changes.push({ room: room.index, visit: b });
  }
  return changes;
}
