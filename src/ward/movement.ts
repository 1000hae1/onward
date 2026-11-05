import type { Rect } from "./layout";

export interface Point {
  x: number;
  z: number;
}

export interface NavOptions {
  /** 캐릭터 중심이 머물 수 있는 영역들이에요. */
  areas: readonly Rect[];
  obstacles: readonly Rect[];
  /** 장애물에서 떨어져야 하는 거리예요. */
  radius: number;
  cellSize: number;
}

export interface NavGrid {
  isFree(point: Point): boolean;
  /** 비어 있는 가장 가까운 지점을 돌려줘요. 비어 있으면 그 자리를 그대로 돌려줘요. */
  nearestFree(point: Point): Point | null;
  /** 시작점을 뺀 경유지 목록을 돌려줘요. 갈 수 없으면 빈 목록이에요. */
  findPath(from: Point, to: Point): Point[];
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

function contains(rect: Rect, point: Point, margin = 0): boolean {
  return (
    point.x >= rect.minX - margin &&
    point.x <= rect.maxX + margin &&
    point.z >= rect.minZ - margin &&
    point.z <= rect.maxZ + margin
  );
}

/** 선분 a→b가 사각형을 지나는 구간을 0~1 비율로 돌려줘요. 지나지 않으면 null이에요. */
function clipSegment(
  a: Point,
  b: Point,
  rect: Rect,
  margin: number,
): { enter: number; exit: number } | null {
  let enter = 0;
  let exit = 1;
  const axes = [
    [a.x, b.x - a.x, rect.minX - margin, rect.maxX + margin],
    [a.z, b.z - a.z, rect.minZ - margin, rect.maxZ + margin],
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
  return { enter, exit };
}

/** 바닥을 격자로 나눠 길을 찾아요. 눌렀을 때만 계산해서 매 프레임 비용이 없어요. */
export function createNavGrid(options: NavOptions): NavGrid {
  const { areas, obstacles, radius, cellSize } = options;
  const minX = Math.min(...areas.map((area) => area.minX));
  const maxX = Math.max(...areas.map((area) => area.maxX));
  const minZ = Math.min(...areas.map((area) => area.minZ));
  const maxZ = Math.max(...areas.map((area) => area.maxZ));
  const columns = Math.floor((maxX - minX) / cellSize) + 1;
  const rows = Math.floor((maxZ - minZ) / cellSize) + 1;

  const isFree = (point: Point): boolean =>
    areas.some((area) => contains(area, point)) &&
    !obstacles.some((obstacle) => contains(obstacle, point, radius));

  const cellPoint = (column: number, row: number): Point => ({
    x: minX + column * cellSize,
    z: minZ + row * cellSize,
  });

  const free = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      free[row * columns + column] = isFree(cellPoint(column, row)) ? 1 : 0;
    }
  }

  const nearestFreeCell = (point: Point): number => {
    let best = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < free.length; index++) {
      if (!free[index]) continue;
      const cell = cellPoint(index % columns, Math.floor(index / columns));
      const distance = (cell.x - point.x) ** 2 + (cell.z - point.z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  };

  const indexPoint = (index: number): Point =>
    cellPoint(index % columns, Math.floor(index / columns));

  /** 선분 전체가 빈 곳인지 점을 찍지 않고 정확히 계산해요. 모서리를 스치는 경로도 걸러 내요. */
  const segmentClear = (a: Point, b: Point): boolean => {
    if (obstacles.some((obstacle) => clipSegment(a, b, obstacle, radius) !== null)) return false;

    // 영역에서 나가는 지점마다 그 지점을 품은 다른 영역으로 이어지는지 확인해요.
    let t = 0;
    while (t < 1) {
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      let exit = -1;
      for (const area of areas) {
        if (!contains(area, point)) continue;
        const clip = clipSegment(a, b, area, 0);
        if (clip && clip.exit > exit) exit = clip.exit;
      }
      if (exit <= t) return false;
      t = exit;
    }
    return true;
  };

  const searchCells = (start: number, goal: number): number[] => {
    const cameFrom = new Int32Array(free.length).fill(-1);
    const cost = new Float64Array(free.length).fill(Infinity);
    const goalColumn = goal % columns;
    const goalRow = Math.floor(goal / columns);
    const estimate = (index: number): number =>
      Math.hypot(index % columns - goalColumn, Math.floor(index / columns) - goalRow);

    cost[start] = 0;
    const open = [start];
    while (open.length > 0) {
      let bestSlot = 0;
      for (let slot = 1; slot < open.length; slot++) {
        if (cost[open[slot]] + estimate(open[slot]) < cost[open[bestSlot]] + estimate(open[bestSlot])) {
          bestSlot = slot;
        }
      }
      const current = open[bestSlot];
      open[bestSlot] = open[open.length - 1];
      open.pop();

      if (current === goal) {
        const cells = [current];
        while (cameFrom[cells[cells.length - 1]] !== -1) cells.push(cameFrom[cells[cells.length - 1]]);
        return cells.reverse();
      }

      const column = current % columns;
      const row = Math.floor(current / columns);
      for (const [dx, dz] of NEIGHBORS) {
        const nextColumn = column + dx;
        const nextRow = row + dz;
        if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
        const next = nextRow * columns + nextColumn;
        if (!free[next]) continue;
        // 대각선으로 장애물 모서리를 가로지르지 않아요.
        if (dx !== 0 && dz !== 0) {
          if (!free[row * columns + nextColumn] || !free[nextRow * columns + column]) continue;
        }
        const nextCost = cost[current] + Math.hypot(dx, dz);
        if (nextCost < cost[next]) {
          if (cost[next] === Infinity) open.push(next);
          cost[next] = nextCost;
          cameFrom[next] = current;
        }
      }
    }
    return [];
  };

  return {
    isFree,
    nearestFree(point) {
      if (isFree(point)) return { x: point.x, z: point.z };
      const cell = nearestFreeCell(point);
      return cell === -1 ? null : indexPoint(cell);
    },
    findPath(from, to) {
      const start = nearestFreeCell(from);
      const goal = nearestFreeCell(to);
      if (start === -1 || goal === -1) return [];
      if (isFree(from) && isFree(to) && segmentClear(from, to)) return [{ x: to.x, z: to.z }];

      const cells = searchCells(start, goal);
      if (cells.length === 0) return [];

      const points = cells.map(indexPoint);
      if (isFree(to)) points.push({ x: to.x, z: to.z });

      // 곧게 갈 수 있는 구간은 경유지를 줄여서 지그재그로 걷지 않게 해요.
      const path: Point[] = [];
      let anchor = from;
      let cursor = 0;
      while (cursor < points.length) {
        let farthest = cursor;
        for (let probe = points.length - 1; probe > cursor; probe--) {
          if (segmentClear(anchor, points[probe])) {
            farthest = probe;
            break;
          }
        }
        path.push(points[farthest]);
        anchor = points[farthest];
        cursor = farthest + 1;
      }
      return path;
    },
  };
}

/** 경로를 따라 distance만큼 걸은 뒤의 위치와 남은 경유지를 돌려줘요. */
export function stepAlong(
  position: Point,
  path: readonly Point[],
  distance: number,
): { position: Point; path: Point[] } {
  let current = position;
  let remaining = distance;
  let cursor = 0;
  while (cursor < path.length) {
    const waypoint = path[cursor];
    const gap = Math.hypot(waypoint.x - current.x, waypoint.z - current.z);
    if (gap > remaining) {
      const t = remaining / gap;
      return {
        position: {
          x: current.x + (waypoint.x - current.x) * t,
          z: current.z + (waypoint.z - current.z) * t,
        },
        path: path.slice(cursor),
      };
    }
    remaining -= gap;
    current = waypoint;
    cursor++;
  }
  return { position: current, path: [] };
}
