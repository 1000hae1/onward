/**
 * 병동 고양이의 자리를 (병실, 서버 시각)만으로 계산해요. 화면과 상관없는 순수 함수예요.
 * 브라우저마다 같은 시각을 넣으면 같은 자리가 나오니, 서버가 위치를 계속 보내지 않아도 모두에게 같게 보여요.
 *
 * 시간을 칸으로 나누고, 칸마다 (병실, 칸 번호) 시드로 갈 자리나 쉴 침대를 정해요.
 * 서버가 알려 준 방문이 있으면 그 시각부터 그 침대 발치로 가요.
 */
import {
  bedApproach,
  bedCatSeat,
  bedCatYaw,
  BED_SURFACE_Y,
  BEDS,
} from "../../shared/ward-layout.ts";

export interface CatPoint {
  x: number;
  z: number;
}

/** 한 칸의 길이예요. 병실 안 어디에서 어디로 가든 걷고 뛰어오를 만큼 넉넉해요. */
export const CAT_SLOT_MS = 24_000;
export const CAT_WALK_SPEED = 0.42;
export const CAT_HOP_MS = 700;
/** 칸마다 침대에서 쉴 확률이에요. */
const REST_CHANCE = 0.25;
const HOP_HEIGHT = 0.22;

/** 이만큼 가까워지면 코를 맞대요. */
export const CAT_GREET_DISTANCE = 0.8;
export const CAT_GREET_SECONDS = 1.8;
/** 코를 맞댄 뒤 다시 맞대기까지 기다리는 시간이에요. */
export const CAT_GREET_GAP_SECONDS = 45;

export interface CatRoom {
  roomIndex: number;
  /** 걸어 다니는 자리들이에요. */
  spots: readonly CatPoint[];
  /** 이 병실의 침대 번호예요. */
  beds: readonly number[];
  /** 두 자리 사이의 길이에요. 같은 입력이면 늘 같은 길을 돌려줘야 해요. */
  path(from: CatPoint, to: CatPoint): readonly CatPoint[];
}

export interface CatVisitPlan {
  bed: number;
  /** 서버 시각으로 찾아가기 시작하는 때예요. */
  at: number;
  /** 찾아가기를 그만둔 때예요. 아직이면 null이에요. */
  until: number | null;
}

export type CatPose = "walk" | "sit" | "curl" | "hop";

export interface CatFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: CatPose;
}

export type SlotGoal = { kind: "spot"; spot: number } | { kind: "rest"; bed: number };

/** 칸마다 같은 값을 내는 해시예요. 서버와 브라우저, 어느 기기에서나 같아요. */
function hash(room: number, slot: number, salt: number): number {
  let mixed = (Math.imul(room + 1, 0x9e3779b1) ^ Math.imul(slot, 0x85ebca6b) ^ Math.imul(salt + 7, 0xc2b2ae35)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b) >>> 0;
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

export function slotOf(time: number): number {
  return Math.floor(time / CAT_SLOT_MS);
}

/** 그 칸에 갈 곳이에요. 침대에서 쉴 때는 그 침대예요. */
export function slotGoal(room: CatRoom, slot: number): SlotGoal {
  if (hash(room.roomIndex, slot, 1) < REST_CHANCE && room.beds.length > 0) {
    return { kind: "rest", bed: room.beds[Math.floor(hash(room.roomIndex, slot, 2) * room.beds.length)] };
  }
  return { kind: "spot", spot: Math.floor(hash(room.roomIndex, slot, 3) * room.spots.length) };
}

/** 걸음이 끝나는 바닥 자리예요. 침대에서 쉬는 칸이면 그 침대 곁이에요. */
function goalPoint(room: CatRoom, goal: SlotGoal): CatPoint {
  return goal.kind === "spot" ? room.spots[goal.spot] : bedApproach(BEDS[goal.bed]);
}

interface Leg {
  start: number;
  from: CatPoint;
  /** 침대 위에서 시작하면 먼저 그 자리에서 내려와요. */
  fromSeat: CatPoint | null;
  to: CatPoint;
  /** 도착한 뒤 뛰어오를 자리예요. 없으면 바닥에 앉아요. */
  seat: { point: CatPoint; yaw: number; pose: CatPose } | null;
}

function along(path: readonly CatPoint[], from: CatPoint, distance: number): { point: CatPoint; yaw: number } {
  let current = from;
  let left = distance;
  let yaw = 0;
  for (const point of path) {
    const gap = Math.hypot(point.x - current.x, point.z - current.z);
    if (gap > 0) yaw = Math.atan2(point.x - current.x, point.z - current.z);
    if (gap >= left) {
      const t = gap === 0 ? 0 : left / gap;
      return { point: { x: current.x + (point.x - current.x) * t, z: current.z + (point.z - current.z) * t }, yaw };
    }
    left -= gap;
    current = point;
  }
  return { point: current, yaw };
}

function pathLength(path: readonly CatPoint[], from: CatPoint): number {
  let length = 0;
  let previous = from;
  for (const point of path) {
    length += Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return length;
}

function hopFrame(from: CatPoint, fromY: number, to: CatPoint, toY: number, t: number): CatFrame {
  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
    y: fromY + (toY - fromY) * t + Math.sin(t * Math.PI) * HOP_HEIGHT,
    yaw: Math.atan2(to.x - from.x, to.z - from.z),
    pose: "hop",
  };
}

/** 한 구간 안에서 time에 있을 자리예요. 내려오기 → 걷기 → 뛰어오르기 → 머물기 차례예요. */
function legFrame(room: CatRoom, leg: Leg, time: number): CatFrame {
  let elapsed = time - leg.start;
  if (leg.fromSeat) {
    if (elapsed < CAT_HOP_MS) return hopFrame(leg.fromSeat, BED_SURFACE_Y, leg.from, 0, elapsed / CAT_HOP_MS);
    elapsed -= CAT_HOP_MS;
  }
  const path = room.path(leg.from, leg.to);
  const walkMs = (pathLength(path, leg.from) / CAT_WALK_SPEED) * 1000;
  if (elapsed < walkMs) {
    const { point, yaw } = along(path, leg.from, (elapsed / 1000) * CAT_WALK_SPEED);
    return { x: point.x, y: 0, z: point.z, yaw, pose: "walk" };
  }
  elapsed -= walkMs;
  const arrivedYaw = along(path, leg.from, Infinity).yaw;
  if (!leg.seat) return { x: leg.to.x, y: 0, z: leg.to.z, yaw: arrivedYaw, pose: "sit" };
  if (elapsed < CAT_HOP_MS) return hopFrame(leg.to, 0, leg.seat.point, BED_SURFACE_Y, elapsed / CAT_HOP_MS);
  return { x: leg.seat.point.x, y: BED_SURFACE_Y, z: leg.seat.point.z, yaw: leg.seat.yaw, pose: leg.seat.pose };
}

/** 칸이 끝날 때의 모습이에요. 다음 칸은 여기서 시작해요. */
function slotEnd(room: CatRoom, slot: number, taken: (bed: number) => boolean): { point: CatPoint; seat: CatPoint | null } {
  const goal = slotGoal(room, slot);
  const point = goalPoint(room, goal);
  if (goal.kind === "rest" && !taken(goal.bed)) return { point, seat: bedCatSeat(BEDS[goal.bed], false) };
  return { point, seat: null };
}

function slotSeat(room: CatRoom, slot: number, taken: (bed: number) => boolean): Leg["seat"] {
  const goal = slotGoal(room, slot);
  // 쉬려던 침대에 누가 있으면 곁 바닥에 앉아요.
  if (goal.kind !== "rest" || taken(goal.bed)) return null;
  return { point: bedCatSeat(BEDS[goal.bed], false), yaw: bedCatYaw(BEDS[goal.bed]), pose: "curl" };
}

/** 칸 단위로 돌아다닐 때 time에 있을 자리예요. */
function wanderFrame(room: CatRoom, time: number, taken: (bed: number) => boolean): CatFrame {
  const slot = slotOf(time);
  const previous = slotEnd(room, slot - 1, taken);
  return legFrame(
    room,
    {
      start: slot * CAT_SLOT_MS,
      from: previous.point,
      fromSeat: previous.seat,
      to: goalPoint(room, slotGoal(room, slot)),
      seat: slotSeat(room, slot, taken),
    },
    time,
  );
}

/**
 * 서버 시각 time에 병동 고양이가 있을 자리예요.
 * taken은 누가 쓰는 침대인지 알려 주고, visit은 서버가 정한 찾아가기예요.
 */
export function catFrameAt(
  room: CatRoom,
  time: number,
  taken: (bed: number) => boolean,
  visit: CatVisitPlan | null,
): CatFrame {
  if (visit && time >= visit.at && (visit.until === null || time < visit.until)) {
    // 출발할 때의 자리에서 그 침대 발치로 가요.
    const startSlot = slotOf(visit.at);
    const started = wanderFrame(room, visit.at, taken);
    const resting = slotSeat(room, startSlot, taken);
    const onBed = started.y > 0 || started.pose === "hop";
    const floor = goalPoint(room, slotGoal(room, startSlot));
    const bed = BEDS[visit.bed];
    return legFrame(
      room,
      {
        start: visit.at,
        from: onBed ? floor : { x: started.x, z: started.z },
        fromSeat: onBed && resting ? resting.point : null,
        to: bedApproach(bed),
        seat: { point: bedCatSeat(bed, true), yaw: bedCatYaw(bed), pose: "sit" },
      },
      time,
    );
  }
  if (visit && visit.until !== null && time >= visit.until && visit.until >= visit.at && slotOf(time) === slotOf(visit.until)) {
    // 찾아가기를 그만둔 칸에서는 발치에서 내려와 그 칸의 자리로 가요.
    const bed = BEDS[visit.bed];
    const slot = slotOf(time);
    return legFrame(
      room,
      {
        start: visit.until,
        from: bedApproach(bed),
        fromSeat: bedCatSeat(bed, true),
        to: goalPoint(room, slotGoal(room, slot)),
        seat: slotSeat(room, slot, taken),
      },
      time,
    );
  }
  return wanderFrame(room, time, taken);
}

/** 코를 맞대도 되는지 알려 줘요. 바닥에 앉아 있을 때만이고, 너무 자주 하지 않아요. */
export function shouldGreet(distance: number, nowSeconds: number, lastGreet: number | null): boolean {
  if (distance > CAT_GREET_DISTANCE) return false;
  return lastGreet === null || nowSeconds - lastGreet >= CAT_GREET_GAP_SECONDS;
}
