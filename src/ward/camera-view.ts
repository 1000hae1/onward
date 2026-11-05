import type { WallBox } from "./layout";

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 선분 a→b가 상자에 처음 닿는 지점을 0~1 비율로 돌려줘요. 닿지 않으면 null이에요. */
function firstHit(a: Point3, b: Point3, box: WallBox): number | null {
  let enter = 0;
  let exit = 1;
  const axes = [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.y, b.y - a.y, box.minY, box.maxY],
    [a.z, b.z - a.z, box.minZ, box.maxZ],
  ] as const;
  for (const [start, delta, min, max] of axes) {
    if (delta === 0) {
      if (start < min || start > max) return null;
      continue;
    }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return null;
  }
  return enter;
}

/** a에서 b까지 가는 동안 벽에 처음 닿는 비율을 돌려줘요. 막히지 않으면 1이에요. */
export function firstBlocked(a: Point3, b: Point3, boxes: readonly WallBox[]): number {
  let nearest = 1;
  for (const box of boxes) {
    const hit = firstHit(a, b, box);
    if (hit !== null && hit < nearest) nearest = hit;
  }
  return nearest;
}

/** a에서 b로 가는 시선에 가장 먼저 닿는 상자 번호를 돌려줘요. 벽에 먼저 막히면 null이에요. */
export function pickBox(
  a: Point3,
  b: Point3,
  targets: readonly WallBox[],
  walls: readonly WallBox[],
): number | null {
  let best: number | null = null;
  let nearest = firstBlocked(a, b, walls);
  targets.forEach((box, index) => {
    const hit = firstHit(a, b, box);
    if (hit !== null && hit < nearest) {
      nearest = hit;
      best = index;
    }
  });
  return best;
}

/**
 * 카메라와 캐릭터 사이에 벽이 있으면 카메라를 벽 앞으로 당겨요.
 * clearance는 벽에서 띄울 거리이고, 벽이 없으면 바라던 자리를 그대로 돌려줘요.
 */
export function pullCamera(
  target: Point3,
  desired: Point3,
  boxes: readonly WallBox[],
  clearance: number,
): Point3 {
  const blocked = firstBlocked(target, desired, boxes);
  if (blocked >= 1) return { x: desired.x, y: desired.y, z: desired.z };
  const length = Math.hypot(desired.x - target.x, desired.y - target.y, desired.z - target.z);
  const t = Math.max(0, blocked - clearance / length);
  return {
    x: target.x + (desired.x - target.x) * t,
    y: target.y + (desired.y - target.y) * t,
    z: target.z + (desired.z - target.z) * t,
  };
}

/** 각도를 목표 쪽으로 amount(0~1) 비율만큼 돌려요. 더 가까운 방향으로 돌아요. */
export function turnToward(current: number, goal: number, amount: number): number {
  const difference = Math.atan2(Math.sin(goal - current), Math.cos(goal - current));
  return current + difference * amount;
}

/**
 * 화면에 보이는 카메라 거리를 다음 프레임 값으로 옮겨요.
 * 벽에 막히면 벽을 뚫지 않게 바로 당기고, 벽에서 벗어나면 천천히 물러나서 저절로 축소되는 것처럼 튀지 않아요.
 */
export function easeDistance(current: number, allowed: number, dt: number, rate: number): number {
  if (allowed <= current) return allowed;
  return current + (allowed - current) * (1 - Math.exp(-dt * rate));
}

/** 현관에서 로비로 들어서는 순간인지 알려 줘요. 로비에서 나갈 때나 안에서 걸을 때는 아니에요. */
export function enteredThroughFront(previousZ: number, nextZ: number, frontZ: number): boolean {
  return previousZ >= frontZ && nextZ < frontZ;
}

export type GlancePhase = "look" | "return" | "done";

/** 간호사실을 비추는 동안의 단계를 시간으로 알려 줘요. */
export function glancePhase(elapsed: number, lookSeconds: number, returnSeconds: number): GlancePhase {
  if (elapsed < lookSeconds) return "look";
  if (elapsed < lookSeconds + returnSeconds) return "return";
  return "done";
}

/** 카메라가 캐릭터 너머로 대상을 보려면 있어야 할 방향이에요. x와 z의 각도예요. */
export function cameraAngleToSee(
  target: { x: number; z: number },
  subject: { x: number; z: number },
): number {
  return Math.atan2(target.x - subject.x, target.z - subject.z);
}
