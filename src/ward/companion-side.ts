/**
 * 데리고 다니는 고양이가 주인 옆에서 나란히 걷는 계산이에요. 화면과 상관없는 순수 함수예요.
 * 주인이 바라보는 방향의 옆자리를 목표로 삼고, 옆자리가 막혔으면 반대쪽, 둘 다 막혔으면 발자국을 따라가요.
 */
import { OBSTACLES, WALK_AREAS } from "../../shared/ward-layout";
import type { Rect } from "../../shared/ward-layout";

export interface SidePoint {
  x: number;
  z: number;
}

/** 주인 중심에서 고양이 중심까지의 옆 거리예요. */
export const SIDE_GAP = 0.55;
/** 이만큼 움직여야 걷는 방향이 바뀐 것으로 봐요. 제자리 흔들림으로 방향이 돌지 않게 해요. */
const HEADING_MIN_STEP = 0.004;
/** 길이 막혔는지 살필 때 이 간격으로 점을 찍어 봐요. */
const SAMPLE_STEP = 0.1;
/** 고양이 몸의 반지름이에요. 가구에서 이만큼 떨어져요. */
const CAT_CLEARANCE = 0.14;

/** 오른쪽(1)이나 왼쪽(-1)이에요. */
export type Side = 1 | -1;

/** 주인이 움직였으면 그 방향, 아니면 하던 방향 그대로예요. 0은 +z 쪽이에요. */
export function nextHeading(previous: SidePoint, current: SidePoint, heading: number): number {
  const dx = current.x - previous.x;
  const dz = current.z - previous.z;
  if (Math.hypot(dx, dz) < HEADING_MIN_STEP) return heading;
  return Math.atan2(dx, dz);
}

/** 주인이 heading을 바라볼 때 side쪽 옆자리예요. 오른쪽은 바라보는 방향에서 시계 방향으로 90도예요. */
export function sideSpot(owner: SidePoint, heading: number, side: Side): SidePoint {
  // 바라보는 방향이 (sin h, cos h)이면 오른쪽은 (-cos h, sin h)예요.
  return {
    x: owner.x - Math.cos(heading) * SIDE_GAP * side,
    z: owner.z + Math.sin(heading) * SIDE_GAP * side,
  };
}

/** 고양이가 서 있을 수 있는 곳인지예요. */
export type Walkable = (point: SidePoint) => boolean;

/** a에서 b까지 곧게 걸어도 막히지 않는지예요. */
export function clearLine(a: SidePoint, b: SidePoint, walkable: Walkable): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
  for (let index = 1; index <= steps; index++) {
    const t = index / steps;
    if (!walkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

/**
 * 고양이가 갈 옆자리예요. 지난번 쪽을 먼저 살피고, 막혔으면 반대쪽을 봐요.
 * 주인에게서 옆자리까지 곧게 갈 수 있어야 해요. 둘 다 막혔으면 null이에요.
 */
export function chooseSideSpot(
  owner: SidePoint,
  heading: number,
  preferred: Side,
  walkable: Walkable,
): { spot: SidePoint; side: Side } | null {
  for (const side of [preferred, -preferred as Side]) {
    const spot = sideSpot(owner, heading, side);
    if (clearLine(owner, spot, walkable)) return { spot, side };
  }
  return null;
}

const inside = (rect: Rect, point: SidePoint, margin: number): boolean =>
  point.x >= rect.minX - margin &&
  point.x <= rect.maxX + margin &&
  point.z >= rect.minZ - margin &&
  point.z <= rect.maxZ + margin;

/** 병동 바닥 위이고 가구에 걸리지 않는 곳이에요. */
export const wardWalkable: Walkable = (point) =>
  WALK_AREAS.some((area) => inside(area, point, 0)) &&
  !OBSTACLES.some((obstacle) => inside(obstacle, point, CAT_CLEARANCE));

/** 목표까지 가는 한 걸음이에요. 멀면 조금 서둘러 따라붙어요. 걸은 거리도 돌려줘요. */
export function stepToward(
  from: SidePoint,
  goal: SidePoint,
  dt: number,
  speed: number,
  catchUpSpeed: number,
): { position: SidePoint; walked: number } {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.02) return { position: from, walked: 0 };
  const pace = distance > 0.8 ? catchUpSpeed : speed;
  const walked = Math.min(distance, pace * dt);
  return { position: { x: from.x + (dx / distance) * walked, z: from.z + (dz / distance) * walked }, walked };
}
