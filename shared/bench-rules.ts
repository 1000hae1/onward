/**
 * 앞마당 벤치에 앉는 판단이에요. 서버(Durable Object)와 혼자 머무는 화면이 함께 써요.
 *
 * - record.bench는 지금 앉아 있는 벤치 자리 번호예요. 서 있으면 비어 있어요.
 * - 침대와 달리 앉아 있는 동안만 내 자리예요. 걸어가거나 일어나거나 눕거나, 안아 주기를 하거나, 퇴원하면 비워요.
 * - 잠시 끊긴 사람은 30초 동안 자리를 지켜요. 기록이 지워지면 자리도 비어요.
 * - 앉아도 침대 배정은 그대로예요. 누워 있었다면 일어나서 앉아요.
 *
 * 메시지는 하나씩 차례로 처리되니, 같은 자리를 두 사람이 동시에 달라고 하면 먼저 처리된 사람이 앉아요.
 */
import type { GuestRecord } from "./ward-rules.ts";
import { BENCH_SEAT_COUNT, SEATS_PER_BENCH, seatApproach } from "./ward-layout.ts";

type SeatHolder = Pick<GuestRecord, "id" | "bench">;
type Sitter = Pick<GuestRecord, "id" | "bench" | "lyingSince" | "x" | "z" | "discharge">;

/** 지금 앉아 있는 자리예요. 앉아 있지 않으면 null이에요. */
export function seatOf(record: Pick<GuestRecord, "bench">): number | null {
  return record.bench ?? null;
}

/** 이 자리에 앉은 사람이에요. 잠시 끊긴 사람도 넣어서 불러요. */
export function seatOwner<T extends SeatHolder>(guests: readonly T[], seat: number): T | null {
  return guests.find((guest) => seatOf(guest) === seat) ?? null;
}

export function isSeat(seat: number): boolean {
  return Number.isInteger(seat) && seat >= 0 && seat < BENCH_SEAT_COUNT;
}

export type SitResult<T> =
  | { granted: true; record: T; /** 전에 앉아 있던 자리예요. 옮겼을 때만 있어요. */ moved: number | null; wasLying: boolean }
  | { granted: false; reason: "taken" | "not-allowed" | "no-seat"; record: T };

/**
 * 벤치 자리에 앉아요(sit). 문병객도 앉을 수 있고, 퇴원하는 사람은 앉지 않아요.
 * 앉으면 누워 있던 침대에서 일어나고, 걸어 다니는 자리는 벤치 앞자리가 돼요. 침대 배정은 그대로예요.
 * 이미 그 자리에 앉아 있으면 그대로 허락해요.
 */
export function takeSeat<T extends Sitter>(guests: readonly SeatHolder[], record: T, seat: number): SitResult<T> {
  if (!isSeat(seat)) return { granted: false, reason: "no-seat", record };
  if (record.discharge) return { granted: false, reason: "not-allowed", record };
  const current = seatOf(record);
  if (current === seat) return { granted: true, record, moved: null, wasLying: false };
  const owner = seatOwner(guests, seat);
  if (owner && owner.id !== record.id) return { granted: false, reason: "taken", record };
  const spot = seatApproach(seat);
  return {
    granted: true,
    record: { ...record, bench: seat, lyingSince: null, x: spot.x, z: spot.z },
    moved: current,
    wasLying: record.lyingSince !== null,
  };
}

/** 벤치에서 일어나요(stand, walk-to, lie-down, 안아 주기, 퇴원). 앉아 있지 않았으면 null이에요. */
export function leaveSeat<T extends Pick<GuestRecord, "bench">>(record: T): T | null {
  if (seatOf(record) === null) return null;
  return { ...record, bench: null };
}

/** 벤치를 눌렀을 때 무엇을 할지예요. */
export type BenchTap =
  /** 이미 이 벤치에 앉아 있거나 앉으러 가는 중이에요. 일어나요. */
  | { kind: "stand" }
  | { kind: "sit"; seat: number }
  /** 두 자리 모두 다른 분이 앉아 있어요. */
  | { kind: "full" };

/**
 * 벤치를 눌렀을 때예요. 내가 쓰는 자리가 이 벤치에 있으면 일어나고,
 * 아니면 비어 있는 자리 가운데 지금 선 곳에서 가까운 자리로 가요.
 */
export function benchTap(
  bench: number,
  me: { seat: number | null; x: number; z: number },
  isTaken: (seat: number) => boolean,
): BenchTap {
  const first = bench * SEATS_PER_BENCH;
  if (me.seat !== null && me.seat >= first && me.seat < first + SEATS_PER_BENCH) return { kind: "stand" };
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let seat = first; seat < first + SEATS_PER_BENCH; seat++) {
    if (isTaken(seat)) continue;
    const spot = seatApproach(seat);
    const distance = Math.hypot(spot.x - me.x, spot.z - me.z);
    if (distance < bestDistance) {
      best = seat;
      bestDistance = distance;
    }
  }
  return best === null ? { kind: "full" } : { kind: "sit", seat: best };
}

export const BENCH_FULL_TEXT = "벤치에 빈자리가 없어요. 다른 벤치에 앉아 보세요.";
export const SEAT_TAKEN_TEXT = "다른 분이 먼저 앉으셨어요. 다른 자리에 앉아 보세요.";
