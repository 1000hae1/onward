/**
 * 데리고 다니는 고양이가 내가 지나온 길을 따라오는 계산이에요. 화면과 상관없는 순수 함수예요.
 * 내가 걸은 길은 이미 장애물을 피한 길이라, 고양이는 길찾기 없이 그대로 밟아 와요.
 */

export interface TrailPoint {
  x: number;
  z: number;
}

/** 이만큼 걸을 때마다 발자국을 하나 남겨요. */
const CRUMB_SPACING = 0.15;

/** 주인이 움직였으면 발자국을 남겨요. 멀리 가지 않았으면 받은 목록을 그대로 돌려줘요. */
export function addCrumb(trail: readonly TrailPoint[], owner: TrailPoint): readonly TrailPoint[] {
  const last = trail[trail.length - 1];
  if (last && Math.hypot(owner.x - last.x, owner.z - last.z) < CRUMB_SPACING) return trail;
  return [...trail, { x: owner.x, z: owner.z }];
}

/** 고양이부터 발자국을 따라 끝까지 잰 길이예요. */
export function trailLength(from: TrailPoint, trail: readonly TrailPoint[]): number {
  let length = 0;
  let previous = from;
  for (const point of trail) {
    length += Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return length;
}

/**
 * 발자국을 따라 distance만큼 걸어요. 다만 끝에서 lag만큼 뒤에 남아요.
 * 지나간 발자국은 지우고, 걸은 거리도 함께 돌려줘요.
 */
export function followTrail(
  from: TrailPoint,
  trail: readonly TrailPoint[],
  distance: number,
  lag: number,
): { position: TrailPoint; trail: readonly TrailPoint[]; walked: number } {
  const allowed = Math.min(distance, trailLength(from, trail) - lag);
  if (allowed <= 0) return { position: from, trail, walked: 0 };

  let current = from;
  let remaining = allowed;
  let cursor = 0;
  while (cursor < trail.length) {
    const point = trail[cursor];
    const gap = Math.hypot(point.x - current.x, point.z - current.z);
    if (gap > remaining) {
      const t = remaining / gap;
      return {
        position: {
          x: current.x + (point.x - current.x) * t,
          z: current.z + (point.z - current.z) * t,
        },
        trail: cursor === 0 ? trail : trail.slice(cursor),
        walked: allowed,
      };
    }
    remaining -= gap;
    current = point;
    cursor++;
  }
  return { position: current, trail: [], walked: allowed };
}
