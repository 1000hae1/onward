import { Vector3 } from "three";
import type { Object3D } from "three";
import type { LanternSink } from "../ward/lantern-rules";
import { pickBox, turnToward } from "../ward/camera-view";
import {
  BEDS,
  catSpots,
  doorSpots,
  OBSTACLES,
  roomAt,
  roomRect,
  ROOMS,
  WALL_BOXES,
} from "../../shared/ward-layout";
import type { WallBox, WardRoom } from "../../shared/ward-layout";
import { createNavGrid, stepAlong } from "../ward/movement";
import type { NavGrid } from "../ward/movement";
import { catNoseReach } from "./cat-kit";

/** 코를 맞댈 때 두 고양이 몸통 사이의 거리예요. */
const NOSE_GAP = catNoseReach("ward") + catNoseReach("companion");
import { catFrameAt, CAT_GREET_SECONDS, CAT_WALK_SPEED, shouldGreet } from "./cat-path";
import type { CatPoint, CatRoom, CatVisitPlan } from "./cat-path";
import { createCatPose } from "./cat-pose";
import { createCatView } from "./cat-view";
import { createCompanion, drawCat, ease, newMoves, STRIDE, TURN_RATE } from "./companion";
import type { Moves } from "./companion";

const CAT_RADIUS = 0.14;
const CAT_NAV_CELL = 0.2;
/** 이보다 가까운 병동 고양이만 그려요. */
const ACTIVE_DISTANCE = 12;
const CAT_TAP_HALF = 0.22;
const CAT_TAP_HEIGHT = 0.46;
/** 한 번에 이보다 멀리 옮겨지면 걸은 것이 아니라 자리를 맞춘 거예요. */
const SNAP_DISTANCE = 1;
/** 반기러 나올 때는 조금 서둘러 걸어요. */
const WELCOME_SPEED = CAT_WALK_SPEED * 1.6;
/** 문 앞에 앉아 반기는 시간이에요. 그동안 천천히 두 번 눈을 깜빡여요. */
const WELCOME_SECONDS = 5;
const SECOND_BLINK_AT = 2.6;
/** 반기러 오는 길이 너무 길면 문 앞에서 기다리던 것처럼 바로 그 자리에 둬요. */
const WELCOME_MAX_SECONDS = 9;

export interface CatOwner {
  /** 내가 걸어 다니는 자리예요. 누워 있어도 침대 곁 자리예요. */
  readonly walkX: number;
  readonly walkZ: number;
  /** 다 누운 침대예요. 오르내리는 중이면 null이에요. */
  readonly lyingBed: number | null;
}

/** 병동 고양이가 모두에게 같은 자리에 보이려고 함께 보는 것들이에요. */
export interface CatWorld {
  /** 서버 시계로 맞춘 지금 시각이에요. 밀리초예요. */
  serverNow(): number;
  /** 누가 쓰고 있는 침대인지예요. 고양이는 그 침대에서 쉬지 않아요. */
  isTaken(bed: number): boolean;
  /** 서버가 정한 찾아가기예요. */
  visitFor(roomIndex: number): CatVisitPlan | null;
}

export interface CatsHandle {
  update(dt: number, stillMotion: boolean): void;
  /** 누른 시선에 고양이가 있으면 반응하고 true를 돌려줘요. */
  tap(origin: Vector3, reach: Vector3): boolean;
  setCompanion(enabled: boolean): void;
  /** 자주 온 사람을 반겨요. 그 사람과 가까운 문의 병동 고양이가 문 앞으로 나와 천천히 눈을 깜빡여요. 이 화면에서만 보여요. */
  welcome(near: { x: number; z: number }): void;
  /** 보이는 고양이마다 머리 위 등불 자리를 알려 줘요. */
  lanterns(sink: LanternSink): void;
}

/** 병실마다 사는 고양이와, 입장 때 고른 경우 함께 다니는 고양이예요. */
export function createCats(
  parent: Object3D,
  owner: CatOwner,
  world: CatWorld,
  initialCompanion: boolean,
): CatsHandle {
  const pose = createCatPose();
  const lanternPoint = new Vector3();
  let seconds = 0;
  let lastGreet: number | null = null;
  let greetLeft = 0;

  const navs = new Map<number, NavGrid>();
  /** 병실 안에서만 다니는 길찾기예요. 그 병실 고양이가 처음 보일 때 만들어요. */
  const navOf = (room: WardRoom): NavGrid => {
    const existing = navs.get(room.index);
    if (existing) return existing;
    const rect = roomRect(room);
    const margin = CAT_RADIUS + 0.03;
    const nav = createNavGrid({
      areas: [{ minX: rect.minX + margin, maxX: rect.maxX - margin, minZ: rect.minZ + margin, maxZ: rect.maxZ - margin }],
      obstacles: OBSTACLES,
      radius: CAT_RADIUS,
      cellSize: CAT_NAV_CELL,
    });
    navs.set(room.index, nav);
    return nav;
  };

  /** 길은 같은 입력이면 늘 같아서, 한 번 찾은 길은 다시 써요. 고양이 자리는 몇 개뿐이라 많이 쌓이지 않아요. */
  const pathsOf = (room: WardRoom) => {
    const cache = new Map<string, readonly CatPoint[]>();
    return (from: CatPoint, to: CatPoint): readonly CatPoint[] => {
      const key = `${from.x.toFixed(3)},${from.z.toFixed(3)}>${to.x.toFixed(3)},${to.z.toFixed(3)}`;
      const saved = cache.get(key);
      if (saved) return saved;
      const found = navOf(room).findPath(from, to);
      const path = found.length > 0 ? [...found.slice(0, -1), to] : [to];
      cache.set(key, path);
      return path;
    };
  };

  const wardCats = ROOMS.map((room) => {
    const plan: CatRoom = {
      roomIndex: room.index,
      spots: catSpots(room),
      beds: BEDS.flatMap((bed, index) => (bed.roomIndex === room.index ? [index] : [])),
      path: pathsOf(room),
    };
    const view = createCatView("ward");
    view.root.visible = false;
    parent.add(view.root);
    return { room, plan, view, moves: newMoves(0, 0, 0), y: 0, active: false, placed: false, sitting: false };
  });
  type WardCat = (typeof wardCats)[number];

  /** 반기러 나온 고양이예요. 끝나면 서버 시계로 정해진 자리로 걸어 돌아가요. */
  let welcoming: {
    cat: WardCat;
    phase: "go" | "greet" | "back";
    path: { x: number; z: number }[];
    left: number;
    blinked: boolean;
  } | null = null;

  const updateWelcome = (dt: number, stillMotion: boolean): void => {
    if (!welcoming) return;
    const { cat } = welcoming;
    const moves = cat.moves;
    cat.active = true;
    cat.view.root.visible = true;
    cat.y = Math.max(0, cat.y - dt * 2);
    if (welcoming.phase === "greet") {
      welcoming.left -= dt;
      moves.yaw = turnToward(moves.yaw, Math.atan2(owner.walkX - moves.x, owner.walkZ - moves.z), 1 - Math.exp(-dt * TURN_RATE));
      moves.walkWeight = ease(moves.walkWeight, 0, dt);
      moves.sit = ease(moves.sit, 1, dt);
      moves.curl = ease(moves.curl, 0, dt);
      if (!welcoming.blinked && WELCOME_SECONDS - welcoming.left >= SECOND_BLINK_AT) {
        welcoming.blinked = true;
        moves.notice = 0;
      }
      if (welcoming.left <= 0) {
        // 돌아갈 자리는 지금 서버 시계로 정해진 자리예요.
        const frame = catFrameAt(cat.plan, world.serverNow(), world.isTaken, world.visitFor(cat.room.index));
        const inside = doorSpots(cat.room).inside;
        const back = navOf(cat.room).findPath(inside, { x: frame.x, z: frame.z });
        welcoming = { ...welcoming, phase: "back", path: [inside, ...back, { x: frame.x, z: frame.z }] };
      }
    } else {
      const step = stepAlong({ x: moves.x, z: moves.z }, welcoming.path, (stillMotion ? 50 : WELCOME_SPEED) * dt);
      const dx = step.position.x - moves.x;
      const dz = step.position.z - moves.z;
      const walked = Math.hypot(dx, dz);
      moves.x = step.position.x;
      moves.z = step.position.z;
      welcoming.path = step.path;
      if (walked > 0) {
        moves.walkPhase += (walked / STRIDE) * Math.PI * 2;
        moves.yaw = turnToward(moves.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * TURN_RATE));
      }
      moves.walkWeight = ease(moves.walkWeight, stillMotion ? 0 : 1, dt);
      moves.sit = ease(moves.sit, 0, dt);
      moves.curl = ease(moves.curl, 0, dt);
      if (step.path.length === 0) {
        if (welcoming.phase === "go") {
          welcoming = { ...welcoming, phase: "greet", left: WELCOME_SECONDS };
          // 고개를 들고 천천히 눈을 깜빡여요.
          moves.notice = 0;
        } else {
          welcoming = null;
        }
      }
    }
    drawCat(cat.view, moves, cat.y, dt, pose);
  };

  const companion = createCompanion(parent);
  const setCompanion = (enabled: boolean): void => companion.setEnabled(enabled, owner);

  const updateWardCat = (cat: WardCat, dt: number, stillMotion: boolean): void => {
    const { moves, room } = cat;
    const ownerRoom = roomAt(owner.walkX, owner.walkZ);
    const near = Math.hypot(moves.x - owner.walkX, moves.z - owner.walkZ) < ACTIVE_DISTANCE;
    cat.active = ownerRoom?.index === room.index || (ownerRoom === null && (near || !cat.placed));
    cat.view.root.visible = cat.active;
    if (!cat.active) return;

    // 자리는 서버 시각만으로 정해져요. 어느 화면에서 봐도 같은 자리예요.
    const frame = catFrameAt(cat.plan, world.serverNow(), world.isTaken, world.visitFor(room.index));
    const moved = Math.hypot(frame.x - moves.x, frame.z - moves.z);
    if (cat.placed && moved < SNAP_DISTANCE) moves.walkPhase += (moved / STRIDE) * Math.PI * 2;
    moves.x = frame.x;
    moves.z = frame.z;
    cat.y = frame.y;
    cat.placed = true;
    if (greetLeft <= 0) {
      moves.yaw = moved >= SNAP_DISTANCE ? frame.yaw : turnToward(moves.yaw, frame.yaw, 1 - Math.exp(-dt * TURN_RATE));
    }
    cat.sitting = frame.pose === "sit" && frame.y === 0;
    moves.walkWeight = ease(moves.walkWeight, frame.pose === "walk" && !stillMotion ? 1 : 0, dt);
    moves.sit = ease(moves.sit, frame.pose === "sit" ? 1 : 0, dt);
    moves.curl = ease(moves.curl, frame.pose === "curl" ? 1 : 0, dt);
    drawCat(cat.view, moves, cat.y, dt, pose);
  };

  /** 두 고양이가 가까워지면 서로 보고 코를 맞대요. 내 화면에서만 보이는 작은 동작이에요. */
  const updateGreeting = (dt: number): void => {
    if (!companion.enabled) return;
    const moves = companion.moves;
    const cat = wardCats.find((candidate) => candidate.active && roomAt(moves.x, moves.z)?.index === candidate.room.index);
    if (!cat) return;

    if (greetLeft > 0) {
      greetLeft -= dt;
      const amount = 1 - Math.exp(-dt * TURN_RATE);
      moves.yaw = turnToward(moves.yaw, Math.atan2(cat.moves.x - moves.x, cat.moves.z - moves.z), amount);
      cat.moves.yaw = turnToward(cat.moves.yaw, Math.atan2(moves.x - cat.moves.x, moves.z - cat.moves.z), amount);
      cat.moves.nose = ease(cat.moves.nose, 1, dt);
      // 병동 고양이는 정해진 자리에 있으니 데리고 온 고양이가 코끝이 닿는 거리까지 다가서요.
      const gapX = moves.x - cat.moves.x;
      const gapZ = moves.z - cat.moves.z;
      const gap = Math.hypot(gapX, gapZ) || 1;
      const next = gap + (NOSE_GAP - gap) * amount;
      moves.x = cat.moves.x + (gapX / gap) * next;
      moves.z = cat.moves.z + (gapZ / gap) * next;
      return;
    }
    cat.moves.nose = ease(cat.moves.nose, 0, dt);

    if (companion.curling || !cat.sitting) return;
    const distance = Math.hypot(moves.x - cat.moves.x, moves.z - cat.moves.z);
    if (shouldGreet(distance, seconds, lastGreet)) {
      lastGreet = seconds;
      greetLeft = CAT_GREET_SECONDS;
    }
  };

  setCompanion(initialCompanion);

  return {
    setCompanion,
    update(dt, stillMotion) {
      seconds += dt;
      for (const cat of wardCats) {
        if (welcoming?.cat === cat) continue;
        updateWardCat(cat, dt, stillMotion);
      }
      updateWelcome(dt, stillMotion);
      updateGreeting(dt);
      if (companion.enabled) companion.update(dt, owner, stillMotion, greetLeft > 0);
    },
    welcome(near) {
      if (welcoming) return;
      // 그 사람과 가장 가까운 문의 병실 고양이가 나와요.
      let best: WardCat | null = null;
      let bestDistance = Infinity;
      for (const cat of wardCats) {
        const door = doorSpots(cat.room).outside;
        const distance = Math.hypot(door.x - near.x, door.z - near.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = cat;
        }
      }
      if (!best) return;
      const cat = best;
      if (!cat.placed) {
        const frame = catFrameAt(cat.plan, world.serverNow(), world.isTaken, world.visitFor(cat.room.index));
        cat.moves.x = frame.x;
        cat.moves.z = frame.z;
        cat.placed = true;
      }
      const spots = doorSpots(cat.room);
      const toDoor = navOf(cat.room).findPath({ x: cat.moves.x, z: cat.moves.z }, spots.inside);
      const path = [...toDoor, spots.inside, spots.outside];
      let length = 0;
      let from = { x: cat.moves.x, z: cat.moves.z };
      for (const point of path) {
        length += Math.hypot(point.x - from.x, point.z - from.z);
        from = point;
      }
      if (length / WELCOME_SPEED > WELCOME_MAX_SECONDS) {
        // 멀리 있었으면 문 앞에서 기다리던 것처럼 시작해요.
        cat.moves.x = spots.inside.x;
        cat.moves.z = spots.inside.z;
        welcoming = { cat, phase: "go", path: [spots.outside], left: 0, blinked: false };
        return;
      }
      welcoming = { cat, phase: "go", path, left: 0, blinked: false };
    },
    lanterns(sink) {
      for (const cat of wardCats) {
        if (!cat.view.root.visible) continue;
        sink(cat, lanternPoint, cat.view.lanternWorld(lanternPoint));
      }
      if (companion.view.root.visible) sink(companion, lanternPoint, companion.view.lanternWorld(lanternPoint));
    },
    tap(origin, reach) {
      const candidates: { moves: Moves; y: number }[] = [
        ...wardCats.filter((cat) => cat.active).map((cat) => ({ moves: cat.moves, y: cat.y })),
        ...(companion.enabled ? [{ moves: companion.moves, y: 0 }] : []),
      ];
      const boxes: WallBox[] = candidates.map(({ moves, y }) => ({
        minX: moves.x - CAT_TAP_HALF,
        maxX: moves.x + CAT_TAP_HALF,
        minZ: moves.z - CAT_TAP_HALF,
        maxZ: moves.z + CAT_TAP_HALF,
        minY: y,
        maxY: y + CAT_TAP_HEIGHT,
      }));
      const picked = pickBox(origin, reach, boxes, WALL_BOXES);
      if (picked === null) return false;
      candidates[picked].moves.notice = 0;
      return true;
    },
  };
}
