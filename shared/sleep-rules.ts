/**
 * 잠들기(수면 모드)의 판단이에요. 서버(Durable Object)가 이 결과만 따르고, 화면은 서버가 알려 준 대로 그려요.
 *
 * - 침대에 누워 있을 때만 잠들 수 있어요. 일어나거나 침대를 옮기거나 퇴원하면 서버가 깨워요.
 * - 잠든 사람에게 온 평안과 선물은 바로 띄우지 않고 쌓아 뒀다가, 깨어날 때 한 번에 숫자로만 알려요.
 * - 목례와 한마디는 잠든 사람에게 보내지 않아요.
 * - 잠든 지 8시간이 지나면 서버가 연결을 닫아요. 그 뒤로는 끊긴 사람과 같은 규칙(30초 뒤 침대 반납)이에요.
 */
import type { WardEvent } from "./protocol.ts";
import { isLying } from "./bed-rules.ts";
import type { GuestRecord } from "./ward-rules.ts";

/** 잠든 채 연결을 이어 두는 가장 긴 시간이에요. */
export const SLEEP_LIMIT_MS = 8 * 60 * 60_000;
/** 쌓아 둔 평안을 서버에 두는 기간이에요. 깨어나지 못하고 나갔어도 다음에 들어오면 전해요. */
export const KEPT_KEEP_MS = 24 * 60 * 60_000;
/** 보낸 사람은 이만큼까지만 따로 세요. 넘으면 숫자만 더해요. */
export const KEPT_SENDER_MAX = 60;

/** 보낸 사람에게 보여 주는 문구예요. */
export const KEPT_QUIET_TEXT = "깨지 않게 살며시 두었어요";
/** 잠든 분 메뉴에 붙는 안내예요. */
export const SLEEPING_PERSON_TEXT = "잠들어 계세요. 평안과 선물은 깨지 않게 살며시 둘 수 있어요.";
/** 8시간이 지나 서버가 연결을 닫았을 때의 안내예요. */
export const SLEPT_LONG_TEXT = "오래 주무셔서 연결을 잠시 쉬었어요. 화면을 누르면 다시 병실로 돌아가요";

type SleepFields = Pick<GuestRecord, "bed" | "lyingSince" | "visit" | "discharge" | "sleeping" | "sleptAt">;

/** 지금 잠들 수 있는지예요. 내 침대에 누워 있어야 하고, 문병객이나 퇴원하는 사람은 아니어야 해요. */
export function canSleep(record: SleepFields): boolean {
  return isLying(record) && !record.visit && !record.discharge;
}

function awake<T extends SleepFields>(record: T): T {
  const { sleptAt: _sleptAt, ...rest } = record;
  return { ...rest, sleeping: false } as T;
}

/**
 * 잠들기·깨어나기 요청이에요. 바뀌는 것이 없거나 잠들 수 없으면 null이에요.
 * 같은 값이 다시 와도(다시 이어졌을 때) null이라 아무에게도 알리지 않아요.
 */
export function sleepChange<T extends SleepFields>(record: T, sleeping: boolean, nowMs: number): T | null {
  if (Boolean(record.sleeping) === sleeping) return null;
  if (!sleeping) return awake(record);
  if (!canSleep(record)) return null;
  return { ...record, sleeping: true, sleptAt: nowMs };
}

/** 저장하기 전에 불러요. 누워 있지 않은데 잠든 채로 남아 있으면 깨운 기록을 돌려줘요. */
export function settleSleep<T extends SleepFields>(record: T): T {
  return record.sleeping && !canSleep(record) ? awake(record) : record;
}

/** 잠든 지 8시간이 지났는지예요. */
export function sleptTooLong(record: Pick<GuestRecord, "sleeping" | "sleptAt">, nowMs: number): boolean {
  return Boolean(record.sleeping) && record.sleptAt !== undefined && nowMs - record.sleptAt >= SLEEP_LIMIT_MS;
}

/** 잠든 사람 가운데 가장 먼저 8시간이 되는 시각이에요. 없으면 null이에요. */
export function nextSleepDeadline(records: readonly Pick<GuestRecord, "sleeping" | "sleptAt">[]): number | null {
  let next: number | null = null;
  for (const record of records) {
    if (!record.sleeping || record.sleptAt === undefined) continue;
    const due = record.sleptAt + SLEEP_LIMIT_MS;
    if (next === null || due < next) next = due;
  }
  return next;
}

/** 잠든 사람 몫으로 쌓아 둔 것이에요. senders는 보낸 사람의 guestId 해시예요. 남에게 보내지 않아요. */
export interface SleepKept {
  senders: string[];
  /** KEPT_SENDER_MAX를 넘어 따로 세지 못한 사람 수예요. */
  overflow: number;
  gifts: number;
}

export const EMPTY_KEPT: SleepKept = { senders: [], overflow: 0, gifts: 0 };

/** 평안이나 선물 하나를 쌓아요. 같은 사람이 여러 번 보내도 사람 수는 한 번만 세요. */
export function keepForSleeper(kept: SleepKept, sender: string, kind: "bless" | "gift"): SleepKept {
  const gifts = kept.gifts + (kind === "gift" ? 1 : 0);
  if (kept.senders.includes(sender)) return { ...kept, gifts };
  if (kept.senders.length >= KEPT_SENDER_MAX) return { ...kept, overflow: kept.overflow + 1, gifts };
  return { senders: [...kept.senders, sender], overflow: kept.overflow, gifts };
}

/** 저장소에서 읽은 값을 확인해요. 모양이 맞지 않으면 빈 것으로 봐요. */
export function readKept(raw: string | null | undefined): SleepKept {
  if (!raw) return EMPTY_KEPT;
  try {
    const value = JSON.parse(raw) as Partial<SleepKept>;
    const senders = Array.isArray(value.senders) ? value.senders.filter((item): item is string => typeof item === "string") : [];
    const count = (n: unknown): number => (typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0);
    return { senders: senders.slice(0, KEPT_SENDER_MAX), overflow: count(value.overflow), gifts: count(value.gifts) };
  } catch {
    return EMPTY_KEPT;
  }
}

/** 깨어날 때 보여 줄 숫자예요. 아무도 없었으면 null이라 보내지 않아요. */
export function wakeSummary(kept: SleepKept): { people: number; gifts: number } | null {
  const people = kept.senders.length + kept.overflow;
  if (people === 0) return null;
  return { people, gifts: kept.gifts };
}

export function sleptSummaryText(people: number, gifts: number): string {
  const base = `자는 동안 ${people}분이 평안을 빌어 주셨어요`;
  return gifts > 0 ? `${base}. 머리맡에 선물이 ${gifts}개 놓여 있어요` : base;
}

/** 이 사람이 잠든 채 받으면 안 되는 event인지예요. 평안은 쌓아 두고, 목례와 한마디는 보내지 않아요. */
export function withheldFromSleeper(event: WardEvent, recipient: Pick<GuestRecord, "id" | "bed" | "sleeping">): boolean {
  if (!recipient.sleeping) return false;
  if (event.kind === "bow") return event.id !== recipient.id;
  if (event.kind === "bless") {
    return event.targetId === recipient.id || (event.bedId !== null && event.bedId === recipient.bed);
  }
  return false;
}

/** 평안이나 선물을 받을 잠든 사람이에요. 사람이나 그 사람 침대를 골랐을 때예요. 보낸 사람 자신은 빼요. */
export function sleeperFor<T extends Pick<GuestRecord, "id" | "bed" | "sleeping">>(
  everyone: readonly T[],
  target: { bedId: number | null; targetId: string | null },
  senderId: string,
): T | null {
  const found = everyone.find((guest) =>
    target.targetId !== null ? guest.id === target.targetId : target.bedId !== null && guest.bed === target.bedId,
  );
  if (!found || !found.sleeping || found.id === senderId) return null;
  return found;
}
