/**
 * 앞마당 벤치로 걸어가서 앉고 일어나는 흐름이에요. 화면과 상관없는 순수 함수예요.
 * 자리는 BENCH_SEATS 번호로 가리키고, 누가 앉을지는 서버(혼자일 때는 이 화면)가 정해요.
 * 침대 흐름(bed-flow)과 따로 두지만, 앉아 있을 때는 침대 흐름이 늘 free예요.
 */

export type SeatFlow =
  | { kind: "none" }
  /** 벤치 앞자리로 걸어가는 중이에요. */
  | { kind: "heading"; seat: number }
  | { kind: "sitting-down"; seat: number; elapsed: number }
  | { kind: "sitting"; seat: number }
  /** remaining은 선 자세로 돌아갈 때까지 남은 시간이에요. 앉다가 멈췄다면 앉은 만큼만 되돌아요. */
  | { kind: "rising"; seat: number; remaining: number };

export const NO_SEAT: SeatFlow = { kind: "none" };

/** 앉기 시작해서 다 일어날 때까지예요. 이때는 걷지 않고 벤치 쪽으로 몸이 옮겨 가요. */
export function isSeated(flow: SeatFlow): boolean {
  return flow.kind === "sitting-down" || flow.kind === "sitting" || flow.kind === "rising";
}

/** 쓰고 있거나 앉으러 가는 자리예요. 일어나는 중이면 이미 비운 자리라 null이에요. */
export function seatInUse(flow: SeatFlow): number | null {
  return flow.kind === "heading" || flow.kind === "sitting-down" || flow.kind === "sitting" ? flow.seat : null;
}

export function headToSeat(seat: number): SeatFlow {
  return { kind: "heading", seat };
}

/** 벤치 앞자리에 닿았을 때예요. */
export function arrivedAtSeat(flow: SeatFlow): SeatFlow {
  return flow.kind === "heading" ? { kind: "sitting-down", seat: flow.seat, elapsed: 0 } : flow;
}

/** 일어나요. 앉으러 가던 중이면 그냥 그만둬요. */
export function rise(flow: SeatFlow, duration: number): SeatFlow {
  switch (flow.kind) {
    case "heading":
      return NO_SEAT;
    case "sitting-down":
      return { kind: "rising", seat: flow.seat, remaining: flow.elapsed };
    case "sitting":
      return { kind: "rising", seat: flow.seat, remaining: duration };
    default:
      return flow;
  }
}

/** 시간이 흐를 때예요. stood는 이번에 다 일어났다는 뜻이에요. */
export function tickSeat(flow: SeatFlow, dt: number, duration: number): { flow: SeatFlow; stood: boolean } {
  if (flow.kind === "sitting-down") {
    const elapsed = flow.elapsed + dt;
    return { flow: elapsed >= duration ? { kind: "sitting", seat: flow.seat } : { ...flow, elapsed }, stood: false };
  }
  if (flow.kind === "rising") {
    const remaining = flow.remaining - dt;
    return remaining > 0 ? { flow: { ...flow, remaining }, stood: false } : { flow: NO_SEAT, stood: true };
  }
  return { flow, stood: false };
}

/** 앉기 진행 정도예요. 0은 선 자세, 1은 다 앉은 자세예요. */
export function seatProgress(flow: SeatFlow, duration: number): number {
  switch (flow.kind) {
    case "sitting-down":
      return Math.min(1, flow.elapsed / duration);
    case "sitting":
      return 1;
    case "rising":
      return Math.max(0, flow.remaining / duration);
    default:
      return 0;
  }
}

/** 손 모으기나 목례를 할 수 있는지예요. 다 앉았거나 벤치와 상관없을 때만이에요. */
export function seatAllowsGesture(flow: SeatFlow): boolean {
  return flow.kind === "none" || flow.kind === "heading" || flow.kind === "sitting";
}
