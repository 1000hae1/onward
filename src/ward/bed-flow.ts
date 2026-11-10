/**
 * 침대로 걸어가서 눕고 일어나는 흐름이에요. 화면과 상관없는 순수 함수예요.
 * 침대는 BEDS 목록의 번호로 가리키고, 누구의 침대인지는 서버(혼자일 때는 이 화면)가 정해요.
 */

export interface FlowPoint {
  x: number;
  z: number;
}

/** 탭한 뒤나 일어난 뒤에 가야 할 곳이에요. lie가 false이면 눕지 않고 곁에서 목례만 해요. */
export type WalkOrder =
  | { kind: "spot"; point: FlowPoint }
  | { kind: "bed"; bed: number; lie: boolean };

export type BedFlow =
  | { kind: "free" }
  | { kind: "heading"; bed: number; lie: boolean }
  | { kind: "entering"; bed: number; elapsed: number }
  | { kind: "lying"; bed: number }
  /** remaining은 선 자세로 돌아갈 때까지 남은 시간이에요. 눕다가 멈췄다면 누운 만큼만 되돌아요. */
  | { kind: "leaving"; bed: number; remaining: number; next: WalkOrder | null };

export interface FlowStep {
  flow: BedFlow;
  /** 이 침대를 내놓으라는 뜻이에요. */
  release?: number;
  walk?: WalkOrder;
  /** 문병객이 침대 곁에 닿으면 그 침대를 보고 목례해요. */
  bowAtBed?: number;
}

export const FREE: BedFlow = { kind: "free" };

export interface BedTapContext {
  /** 눕기를 시도해도 되는지예요. 문병객은 false예요. */
  canLie: boolean;
  isFree: boolean;
}

/** 침대를 탭했을 때예요. */
export function tapBed(
  flow: BedFlow,
  bed: number,
  context: BedTapContext,
  duration: number,
): FlowStep {
  const { canLie, isFree } = context;
  const bedOrder: WalkOrder = { kind: "bed", bed, lie: canLie };

  switch (flow.kind) {
    case "free":
    case "heading": {
      if (flow.kind === "heading" && flow.bed === bed) return { flow };
      // 환자에게 빈 침대가 아니면 움직이지 않아요. 문병객은 누가 있는 침대에도 찾아가요.
      if (canLie && !isFree) return { flow };
      return { flow: { kind: "heading", bed, lie: canLie }, walk: bedOrder };
    }
    case "entering":
      if (flow.bed === bed) return { flow };
      if (canLie && !isFree) return { flow };
      return startLeaving(flow.bed, flow.elapsed, bedOrder);
    case "lying":
      if (flow.bed === bed) return startLeaving(bed, duration, null);
      if (canLie && !isFree) return { flow };
      return startLeaving(flow.bed, duration, bedOrder);
    case "leaving":
      // 일어나는 중에 다시 누르면 일어난 뒤 그 침대로 가요.
      return { flow: { ...flow, next: bedOrder } };
  }
}

/**
 * 침대를 눌렀을 때 무엇을 할지예요. 침대는 한 번 고르면 퇴원할 때까지 내 것이에요.
 * - visit: 문병객이에요. 침대 곁으로 가서 목례만 해요.
 * - own: 내 침대예요. 묻지 않고 바로 가서 누워요(누워 있으면 일어나요).
 * - others: 다른 분의 침대예요. 눕지 않고 그분 메뉴(이름표·평안 빌기)를 보여 줘요.
 * - claim: 아직 내 침대가 없어요. "이 침대를 쓰시겠어요?"를 먼저 물어요.
 * - move: 내 침대가 따로 있어요. "이 침대로 옮길까요?"를 먼저 물어요.
 */
export type BedTapIntent = "visit" | "own" | "others" | "claim" | "move";

export function bedTapIntent(
  bed: number,
  context: { canLie: boolean; ownedBed: number | null; takenByOther: boolean },
): BedTapIntent {
  if (!context.canLie) return "visit";
  if (context.ownedBed === bed) return "own";
  if (context.takenByOther) return "others";
  return context.ownedBed === null ? "claim" : "move";
}

/** 빈 바닥을 탭했을 때예요. */
export function tapFloor(flow: BedFlow, point: FlowPoint, duration: number): FlowStep {
  const order: WalkOrder = { kind: "spot", point };
  switch (flow.kind) {
    case "free":
    case "heading":
      return { flow: FREE, walk: order };
    case "entering":
      return startLeaving(flow.bed, flow.elapsed, order);
    case "lying":
      return startLeaving(flow.bed, duration, order);
    case "leaving":
      return { flow: { ...flow, next: order } };
  }
}

function startLeaving(bed: number, remaining: number, next: WalkOrder | null): FlowStep {
  return { flow: { kind: "leaving", bed, remaining, next }, release: bed };
}

/** 침대 곁에 닿았을 때예요. granted는 그 침대가 지금도 내 침대인지예요. */
export function arrivedAtBed(flow: BedFlow, granted: boolean): FlowStep {
  if (flow.kind !== "heading") return { flow };
  if (!flow.lie) return { flow: FREE, bowAtBed: flow.bed };
  if (!granted) return { flow: FREE };
  return { flow: { kind: "entering", bed: flow.bed, elapsed: 0 } };
}

/** 시간이 흐를 때예요. duration은 눕거나 일어나는 데 걸리는 시간이에요. */
export function tickFlow(flow: BedFlow, dt: number, duration: number): FlowStep {
  if (flow.kind === "entering") {
    const elapsed = flow.elapsed + dt;
    return elapsed >= duration
      ? { flow: { kind: "lying", bed: flow.bed } }
      : { flow: { ...flow, elapsed } };
  }
  if (flow.kind === "leaving") {
    const remaining = flow.remaining - dt;
    if (remaining > 0) return { flow: { ...flow, remaining } };
    if (!flow.next) return { flow: FREE };
    return { flow: followUp(flow.next), walk: flow.next };
  }
  return { flow };
}

function followUp(next: WalkOrder): BedFlow {
  return next.kind === "bed" ? { kind: "heading", bed: next.bed, lie: next.lie } : FREE;
}

/** 눕기 진행 정도예요. 0은 선 자세, 1은 다 누운 자세예요. */
export function bedProgress(flow: BedFlow, duration: number): number {
  switch (flow.kind) {
    case "entering":
      return Math.min(1, flow.elapsed / duration);
    case "lying":
      return 1;
    case "leaving":
      return Math.max(0, flow.remaining / duration);
    default:
      return 0;
  }
}

/** 문병객으로 바꿀 때예요. 누워 있었다면 일어나고, 앞으로 가는 침대에는 눕지 않아요. */
export function becomeVisitor(flow: BedFlow, duration: number): FlowStep {
  switch (flow.kind) {
    case "heading":
      return { flow: { ...flow, lie: false } };
    case "entering":
      return startLeaving(flow.bed, flow.elapsed, null);
    case "lying":
      return startLeaving(flow.bed, duration, null);
    case "leaving":
      return flow.next?.kind === "bed"
        ? { flow: { ...flow, next: { ...flow.next, lie: false } } }
        : { flow };
    default:
      return { flow };
  }
}

/** 침대에서 일어나라는 뜻이에요. 눕던 중이면 누운 만큼만 되돌아요. */
export function getUp(flow: BedFlow, duration: number): FlowStep {
  if (flow.kind === "lying") return startLeaving(flow.bed, duration, null);
  if (flow.kind === "entering") return startLeaving(flow.bed, flow.elapsed, null);
  return { flow };
}

/** 지금 손 모으기나 목례를 시작할 수 있는지 알려 줘요. 침대에 오르내릴 때와 누운 동안은 안 돼요. */
export function canStartGesture(flow: BedFlow): boolean {
  return flow.kind === "free" || flow.kind === "heading";
}
