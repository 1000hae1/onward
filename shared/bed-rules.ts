/**
 * 침대 고정 배정의 판단이에요. 서버(Durable Object)와 혼자 머무는 화면이 함께 써요.
 *
 * - record.bed는 "내게 배정된 침대"예요. 걸어 다녀도 그대로 내 것이에요.
 * - 누워 있는지는 record.lyingSince로 알아요. null이면 서 있어요.
 * - 배정이 풀리는 때는 퇴원, 문병객으로 바꾸기, 반납(release-bed), 연결이 끊기고 30초가 지났을 때예요.
 *
 * 메시지는 하나씩 차례로 처리되니, 같은 침대를 두 사람이 동시에 달라고 하면 먼저 처리된 사람이 가져가요.
 */
import type { GuestRecord } from "./ward-rules.ts";
import { BEDS, ROOMS } from "./ward-layout.ts";

type BedHolder = Pick<GuestRecord, "id" | "bed">;
type Claimant = Pick<GuestRecord, "id" | "bed" | "lyingSince" | "outfit" | "visit" | "discharge">;

/** 이 침대를 배정받은 사람이에요. 잠시 끊긴 사람도 넣어서 불러요. */
export function bedOwner<T extends BedHolder>(guests: readonly T[], bed: number): T | null {
  return guests.find((guest) => guest.bed === bed) ?? null;
}

/** 침대를 배정받을 수 있는 사람인지예요. 환자복을 입은 사람만이고, 문병객과 퇴원하는 사람은 아니에요. */
export function canHoldBed(record: Pick<GuestRecord, "outfit" | "visit" | "discharge">): boolean {
  return record.outfit === "patient" && !record.visit && !record.discharge;
}

export type ClaimResult<T> =
  | { granted: true; record: T; /** 전에 배정받았던 침대예요. 옮겼을 때만 있어요. */ released: number | null }
  | { granted: false; reason: "taken" | "not-allowed" | "no-bed"; record: T };

/**
 * 침대를 달라는 요청(claim-bed)이에요. 처음 고르기와 옮기기를 함께 다뤄요.
 * 옮기면 원래 침대는 바로 비우고, 새 침대에는 아직 눕지 않은 채로 둬요(눕기는 lie-down으로 따로 해요).
 * 이미 내 침대면 그대로 허락해요.
 */
export function claimBed<T extends Claimant>(guests: readonly BedHolder[], record: T, bed: number): ClaimResult<T> {
  if (!BEDS[bed]) return { granted: false, reason: "no-bed", record };
  if (!canHoldBed(record)) return { granted: false, reason: "not-allowed", record };
  if (record.bed === bed) return { granted: true, record, released: null };
  const owner = bedOwner(guests, bed);
  if (owner && owner.id !== record.id) return { granted: false, reason: "taken", record };
  return {
    granted: true,
    record: { ...record, bed, lyingSince: null },
    released: record.bed,
  };
}

/** 침대를 내놓아요(release-bed). 누워 있었으면 일어나요. */
export function releaseBed<T extends Pick<GuestRecord, "bed" | "lyingSince">>(record: T): { record: T; released: number | null } {
  return { record: { ...record, bed: null, lyingSince: null }, released: record.bed };
}

/** 내 침대에 누워요(lie-down). 다른 침대에는 누울 수 없어요. 이미 누워 있으면 누운 시각은 그대로예요. */
export function lieDown<T extends Claimant>(record: T, bed: number, nowMs: number): { granted: boolean; record: T } {
  if (!canHoldBed(record) || record.bed !== bed) return { granted: false, record };
  if (record.lyingSince !== null) return { granted: true, record };
  return { granted: true, record: { ...record, lyingSince: nowMs } };
}

/** 침대에서 내려와요(get-up, walk-to). 배정은 그대로예요. 이미 서 있으면 null이에요. */
export function standUp<T extends Pick<GuestRecord, "lyingSince">>(record: T): T | null {
  if (record.lyingSince === null) return null;
  return { ...record, lyingSince: null };
}

/** 지금 누워 있는지예요. */
export function isLying(record: Pick<GuestRecord, "bed" | "lyingSince">): boolean {
  return record.bed !== null && record.lyingSince !== null;
}

/**
 * 새로 들어올 때 예전 침대(seat)를 먼저 돌려줘요. 비어 있을 때만이고, 서 있는 채로 배정해요.
 * 30초 안에 돌아온 사람은 이미 침대를 갖고 있으니 그대로예요.
 */
export function seatOnEntry<T extends Claimant>(guests: readonly BedHolder[], record: T, seat: number | null | undefined): T {
  if (seat === null || seat === undefined || record.bed !== null) return record;
  const result = claimBed(guests, record, seat);
  return result.granted ? result.record : record;
}

/** 내 침대가 없는 환자에게 보여 줄 안내예요. 침대가 다 차도 병동에 머물 수 있고, 침대만 받지 못해요. */
export type BedGuide =
  /** 지금 병실에 빈 침대가 있어요. */
  | { kind: "pick-here" }
  /** 지금 병실은 다 찼고, 다른 병실(호실 번호)에 빈 침대가 있어요. */
  | { kind: "pick-other"; roomNumber: number }
  /** 병동에 빈 침대가 하나도 없어요. */
  | { kind: "none-free" };

/**
 * 침대를 고르도록 안내할지와 무엇을 안내할지예요. 문병객이거나 이미 내 침대가 있으면 null이에요.
 * myRoom이 null(복도·로비)이면 병동 전체에서 빈 침대가 있는지만 봐요.
 * 다른 병실은 가까운 순서가 아니라 호실 번호 순서로 하나만 알려 줘요.
 */
export function bedGuide(
  me: { canLie: boolean; ownedBed: number | null; myRoom: number | null },
  isTaken: (bed: number) => boolean,
): BedGuide | null {
  if (!me.canLie || me.ownedBed !== null) return null;
  const freeIn = (room: number): boolean =>
    BEDS.some((bed, index) => bed.roomIndex === room && !isTaken(index));
  if (me.myRoom !== null && freeIn(me.myRoom)) return { kind: "pick-here" };
  const other = ROOMS.find((room) => room.index !== me.myRoom && freeIn(room.index));
  if (other) return me.myRoom === null ? { kind: "pick-here" } : { kind: "pick-other", roomNumber: other.number };
  return { kind: "none-free" };
}

export function bedGuideText(guide: BedGuide): string {
  if (guide.kind === "pick-here") return "빈 침대를 누르면 내 침대로 고를 수 있어요.";
  if (guide.kind === "pick-other") return `이 병실은 침대가 다 찼어요. ${guide.roomNumber}호실에 빈 침대가 있어요.`;
  return "지금은 빈 침대가 없어요. 편히 둘러보시다가 침대가 비면 골라 주세요.";
}
