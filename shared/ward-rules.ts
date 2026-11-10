/**
 * 병동 서버의 판단이에요. Durable Object는 이 순수 함수만 부르고 결과를 보내요.
 * 하이버네이션 뒤에도 연결마다 붙은 정보만으로 다시 판단할 수 있게, 상태를 함수 밖에 두지 않아요.
 */
import { checkNickname } from "./nickname.ts";
import type { NicknameProblem } from "./nickname.ts";
import { chooseGiftSlot, GIFT_SLOTS_PER_STAND, LAMPS_PER_WINDOW } from "./offering-rules.ts";
import type { Guest, HelloMessage } from "./protocol.ts";
import { publicNickname } from "./safety-rules.ts";
import { isLying } from "./bed-rules.ts";
import { BEDS, PLAYER_START, ROOMS, roomAt, WALK_AREAS } from "./ward-layout.ts";

/** 방명록 링크로 들어온 사람의 역할이에요. 연결 정보와 잠시 끊긴 기록에만 두고 남에게 보내지 않아요. */
export interface VisitRole {
  /** 주인의 guestId 해시예요. */
  owner: string;
  /** 문병 온 침대예요. 주인이 지금 누운 침대, 없으면 마지막에 있던 침대예요. */
  bed: number;
  /** directory에서 동시 3명을 세는 번호예요. 나갈 때 돌려줘요. */
  session: string;
  ownerNickname: string;
}

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
  /** 배정받은 내 침대예요. 걸어 다녀도 그대로이고, 퇴원·반납·30초 넘게 끊기면 비어요. */
  bed: number | null;
  /** 이번 입장에서 받은 평안 주소예요. 다른 사람에게 보여도 되는 값이에요. 서버는 연결 정보에만 들고 있어요. */
  address: string;
  /** 내 침대에 누운 시각이에요. 밀리초예요. 서 있으면 null이에요. 병동 고양이가 찾아올 때를 정해요. */
  lyingSince: number | null;
  /** 지금 앉아 있는 앞마당 벤치 자리예요. 서 있으면 비어 있어요. 침대 배정과 따로예요. */
  bench?: number | null;
  /** 동작별로 마지막에 받아 준 시각이에요. 밀리초예요. */
  lastAction: Partial<Record<"bless" | "bow" | "gift" | "lamp" | "link" | "hug" | "discharge", number>>;
  /** guestId 해시예요. 문병 온 주인을 찾을 때 써요. */
  key?: string;
  /** 방명록 링크로 들어왔으면 그 역할이에요. 침대를 차지하지 않고 정원에도 세지 않아요. */
  visit?: VisitRole;
  /** 켜진 방명록 링크가 있는 주인이에요. 이때만 directory에 병실 위치를 알려요. */
  linked?: boolean;
  /** 서로 다른 세 사람이 신고해서 닉네임을 가리고 운영자 확인을 기다려요. */
  hidden?: boolean;
  /** 운영자가 되돌린 닉네임이에요. 이 닉네임으로 다시 바꾸면 서버가 자동 닉네임으로 바꿔요. */
  bannedNickname?: string;
  /** IP 해시예요. 신고에 함께 적어 IP 차단을 할 수 있게 해요. 남에게 보내지 않아요. */
  ip?: string;
  /** 수면 모드예요. 잠든 사람에게는 안아 주기 요청이 가지 않아요. */
  sleeping?: boolean;
  /** 설정의 "안아 주기 요청 받지 않기"예요. */
  hugsOff?: boolean;
  /** 다녀간 날 수(한국 날짜)예요. 서버 판단에만 쓰고 남에게도, 화면에도 숫자로 보내지 않아요. */
  visitDays?: number;
  /** 퇴원하는 중이면 시작한 시각과 배웅해 준 사람(guestId 해시)이에요. */
  discharge?: { at: number; from: string[] };
  /** 이번에 들어온 시각이에요. 30초 안에 다시 이어지면 그대로예요. 나갈 때 머문 시간만 숫자로 집계해요. */
  joinedAt?: number;
  /** 이번에 들어와서 평안을 빈 횟수예요. 나갈 때 숫자로만 집계해요. */
  blessings?: number;
}

/** 서명을 확인한 뒤의 hello예요. guestId는 토큰에서 꺼낸 값이에요. */
export type VerifiedHello = HelloMessage & { guestId: string };

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
    // 가려진 사람은 다른 사람 화면에 '조용한 토끼'처럼 보여요. 원래 닉네임은 보내지 않아요.
    nickname: publicNickname(record),
    withCat: record.withCat,
    x: record.x,
    z: record.z,
    bed: record.bed,
    lying: isLying(record),
    bench: record.bench ?? null,
    address: record.address,
    hugOk: hugAvailable(record),
  };
}

/** 지금 안아 주기 요청을 받을 수 있는지예요. 잠들었거나, 설정으로 껐거나, 퇴원하는 중이면 받지 않아요. */
export function hugAvailable(record: GuestRecord): boolean {
  return !record.sleeping && !record.hugsOff && !record.discharge;
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
  hello: VerifiedHello,
  capacity: number,
  newId: string,
  returning: GuestRecord | null = null,
  visit: { role: VisitRole; spot: { x: number; z: number } } | null = null,
): Admission {
  const nickname = checkNickname(hello.nickname);
  if (!nickname.ok) return { kind: "rejected", problem: nickname.problem };
  const same = others.find((record) => record.guestId === hello.guestId) ?? null;
  const role = visit?.role ?? returning?.visit ?? null;
  // 문병객은 평상복에 꽃다발을 들어요. 화면에서 무엇을 골랐든 서버가 정해요.
  const outfit = role ? "visitor" : hello.outfit;
  if (returning) {
    const bed = outfit === "visitor" ? null : returning.bed;
    return {
      kind: "admitted",
      replaces: same?.id ?? null,
      restored: true,
      record: {
        ...returning,
        ...(role ? { visit: role } : {}),
        guestId: hello.guestId,
        animal: hello.animal,
        outfit,
        nickname: nickname.value,
        withCat: hello.withCat,
        hugsOff: hello.hugsOff ?? false,
        bed,
        lyingSince: bed === null ? null : returning.lyingSince,
      },
    };
  }
  // 문병객은 정원에 세지 않아요. 남은 자리도 문병객을 빼고 세요.
  if (!visit) {
    const patients = others.filter((record) => !record.visit);
    const count = patients.length + awayCount - (same && !same.visit ? 1 : 0);
    if (count >= capacity) return { kind: "full" };
  }
  const start = visit?.spot ?? PLAYER_START;
  return {
    kind: "admitted",
    replaces: same?.id ?? null,
    restored: false,
    record: {
      id: newId,
      guestId: hello.guestId,
      animal: hello.animal,
      outfit,
      nickname: nickname.value,
      withCat: hello.withCat,
      x: start.x,
      z: start.z,
      ...(visit ? { visit: visit.role } : {}),
      bed: null,
      address: "",
      lyingSince: null,
      lastAction: {},
      hugsOff: hello.hugsOff ?? false,
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
  // 링크로 온 문병객은 옷을 바꿀 수 없어요.
  const outfit = record.visit ? "visitor" : hello.outfit;
  // 문병객으로 바꾸면 누워 있던 침대를 비워요.
  const bed = outfit === "visitor" ? null : record.bed;
  const lyingSince = bed === null ? null : record.lyingSince;
  return {
    kind: "updated",
    record: {
      ...record,
      animal: hello.animal,
      outfit,
      nickname: nickname.value,
      withCat: hello.withCat,
      hugsOff: hello.hugsOff ?? false,
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
export function readVersion(raw: unknown, maxChars = 4096): number | null {
  if (typeof raw !== "string" || raw.length > maxChars) return null;
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
 * 병실마다 고양이가 찾아갈 침대와 시각이에요. 병실에 서 있는 사람 없이 누워 있는 사람만 있을 때 찾아가요.
 * 오래 누워 있던 사람이 먼저이고, 같으면 자주 온 사람이에요. 병실마다 많아야 하나예요.
 * 입장·퇴장·눕기·일어나기·병실 이동 때만 다시 계산해요. 그래서 시간이 흘러도 방송할 일이 없어요.
 */
export function catVisits(guests: readonly GuestRecord[]): CatVisit[] {
  const visits: CatVisit[] = [];
  for (const room of ROOMS) {
    const inRoom = guests.filter((guest) => roomAt(guest.x, guest.z)?.index === room.index);
    if (inRoom.length === 0) continue;
    const lying = inRoom.filter(
      (guest) => guest.bed !== null && guest.lyingSince !== null && BEDS[guest.bed]?.roomIndex === room.index,
    );
    // 서 있는 사람이 하나라도 있으면 그 사람이 곁에 있으니 찾아가지 않아요.
    if (lying.length !== inRoom.length) continue;
    const [first] = rankCatCandidates(lying);
    visits.push({ room: room.index, bed: first.bed as number, at: (first.lyingSince as number) + CAT_VISIT_AFTER_MS });
  }
  return visits;
}

/** 고양이가 찾아갈 차례예요. 오래 누워 있던 사람, 다녀간 날이 많은 사람, 침대 번호가 작은 사람 순이에요. */
export function rankCatCandidates<T extends Pick<GuestRecord, "lyingSince" | "visitDays" | "bed">>(guests: readonly T[]): T[] {
  return [...guests].sort(
    (a, b) =>
      (a.lyingSince ?? Infinity) - (b.lyingSince ?? Infinity) ||
      (b.visitDays ?? 0) - (a.visitDays ?? 0) ||
      (a.bed ?? 0) - (b.bed ?? 0),
  );
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
