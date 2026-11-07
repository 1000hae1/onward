import type { Object3D, Vector3 } from "three";
import {
  CAT_GREET_SECONDS,
  CAT_HOP_SECONDS,
  catCanGreet,
  createCatBrain,
  decideCat,
  shouldGreet,
  startGreet,
} from "../../shared/cat-brain";
import type { CatBrain, CatPlan } from "../../shared/cat-brain";
import { pickBox, turnToward } from "../ward/camera-view";
import {
  bedApproach,
  bedCatSeat,
  bedCatYaw,
  BED_SURFACE_Y,
  BEDS,
  catSpots,
  OBSTACLES,
  roomAt,
  roomRect,
  ROOMS,
  WALL_BOXES,
} from "../../shared/ward-layout";
import type { WallBox, WardRoom } from "../../shared/ward-layout";
import { createNavGrid, stepAlong } from "../ward/movement";
import type { NavGrid, Point } from "../ward/movement";
import { CAT_NOSE_REACH } from "./cat-kit";
import { createCatPose } from "./cat-pose";
import { createCompanion, drawCat, ease, newMoves, STRIDE, TURN_RATE } from "./companion";
import type { Moves } from "./companion";
import { createCatView } from "./cat-view";

const CAT_RADIUS = 0.14;
const CAT_NAV_CELL = 0.2;
const WARD_WALK_SPEED = 0.42;
/** 이보다 가까운 병동 고양이만 그려요. */
const ACTIVE_DISTANCE = 12;
/** 안 보이는 고양이는 이 간격으로만 판단해요. */
const HIDDEN_THINK_SECONDS = 1;
const HOP_HEIGHT = 0.22;
const CAT_TAP_HALF = 0.22;
const CAT_TAP_HEIGHT = 0.46;

export interface CatOwner {
  /** 내가 걸어 다니는 자리예요. 누워 있어도 침대 곁 자리예요. */
  readonly walkX: number;
  readonly walkZ: number;
  /** 다 누운 침대예요. 오르내리는 중이면 null이에요. */
  readonly lyingBed: number | null;
  /** 이 병실에 나 말고 다른 사람이 있는지 알려 줘요. 혼자 누워 있을 때만 병동 고양이가 찾아와요. */
  othersInRoom?(roomIndex: number): boolean;
  /** 내가 쓰거나 가고 있는 침대예요. */
  readonly claimedBed: number | null;
}

export interface CatsHandle {
  update(dt: number, stillMotion: boolean): void;
  /** 누른 시선에 고양이가 있으면 반응하고 true를 돌려줘요. */
  tap(origin: Vector3, reach: Vector3): boolean;
  setCompanion(enabled: boolean): void;
}

/** 병실마다 사는 고양이와, 입장 때 고른 경우 함께 다니는 고양이예요. */
export function createCats(parent: Object3D, owner: CatOwner, initialCompanion: boolean): CatsHandle {
  const pose = createCatPose();
  let now = 0;
  let lastGreet: number | null = null;
  let greetLeft = 0;
  let lyingSince: number | null = null;
  let lyingBedSeen: number | null = null;

  const navs = new Map<number, NavGrid>();
  /** 병실 안에서만 다니는 길찾기예요. 그 병실 고양이가 처음 움직일 때 만들어요. */
  const navOf = (room: WardRoom): NavGrid => {
    const existing = navs.get(room.index);
    if (existing) return existing;
    const rect = roomRect(room);
    const margin = CAT_RADIUS + 0.03;
    const nav = createNavGrid({
      areas: [
        {
          minX: rect.minX + margin,
          maxX: rect.maxX - margin,
          minZ: rect.minZ + margin,
          maxZ: rect.maxZ - margin,
        },
      ],
      obstacles: OBSTACLES,
      radius: CAT_RADIUS,
      cellSize: CAT_NAV_CELL,
    });
    navs.set(room.index, nav);
    return nav;
  };

  const wardCats = ROOMS.map((room) => {
    const spots = catSpots(room);
    const start = spots[room.index % spots.length];
    const view = createCatView("ward");
    view.root.visible = false;
    parent.add(view.root);
    return {
      room,
      spots,
      beds: BEDS.flatMap((bed, index) => (bed.roomIndex === room.index ? [index] : [])),
      view,
      brain: createCatBrain(1000 + room.number, 0) as CatBrain,
      lastPlan: null as CatPlan | null,
      path: [] as Point[],
      arrived: false,
      /** 침대에 오르내리는 중이면 시작과 끝 자리예요. */
      hop: null as { fromX: number; fromZ: number; fromY: number; toX: number; toZ: number; toY: number; t: number } | null,
      y: 0,
      moves: newMoves(start.x, start.z, room.index),
      sinceThink: HIDDEN_THINK_SECONDS,
      active: false,
    };
  });
  type WardCat = (typeof wardCats)[number];

  const companion = createCompanion(parent);
  const setCompanion = (enabled: boolean): void => companion.setEnabled(enabled, owner);

  /** 새 계획을 받았을 때 걸어갈 길이나 뛰어오를 자리를 정해요. */
  const startPlan = (cat: WardCat, plan: CatPlan): void => {
    cat.path = [];
    cat.arrived = false;
    const { moves } = cat;
    const walkTo = (spot: Point): void => {
      if (!cat.active) {
        // 안 보이는 곳에서는 걷지 않고 바로 옮겨요.
        moves.x = spot.x;
        moves.z = spot.z;
        cat.arrived = true;
        return;
      }
      const nav = navOf(cat.room);
      const goal = nav.nearestFree(spot);
      cat.path = goal ? nav.findPath(moves, goal) : [];
      if (cat.path.length === 0) cat.arrived = true;
    };
    const hopTo = (toX: number, toZ: number, toY: number): void => {
      cat.hop = { fromX: moves.x, fromZ: moves.z, fromY: cat.y, toX, toZ, toY, t: 0 };
    };

    if (plan.kind === "stroll") {
      walkTo(cat.spots[plan.spot]);
    } else if (plan.kind === "toBed") {
      walkTo(bedApproach(BEDS[plan.bed]));
    } else if (plan.kind === "onBed") {
      const seat = bedCatSeat(BEDS[plan.bed], plan.purpose === "visit");
      hopTo(seat.x, seat.z, BED_SURFACE_Y);
    } else if (plan.kind === "offBed") {
      const landing = bedApproach(BEDS[plan.bed]);
      hopTo(landing.x, landing.z, 0);
    }
  };

  const updateWardCat = (cat: WardCat, dt: number, stillMotion: boolean): void => {
    const { moves, room } = cat;
    const ownerRoom = roomAt(owner.walkX, owner.walkZ);
    const wasActive = cat.active;
    const near = Math.hypot(moves.x - owner.walkX, moves.z - owner.walkZ) < ACTIVE_DISTANCE;
    cat.active = ownerRoom?.index === room.index || (ownerRoom === null && near);
    cat.view.root.visible = cat.active;
    // 내가 들어오면 안 보일 때 정한 일을 그대로 이어요.
    if (!wasActive && cat.active) cat.sinceThink = HIDDEN_THINK_SECONDS;

    cat.sinceThink += dt;
    if (cat.active || cat.sinceThink >= HIDDEN_THINK_SECONDS) {
      cat.sinceThink = 0;
      const claimed = owner.claimedBed;
      const lying =
        lyingBedSeen !== null && lyingSince !== null && cat.beds.includes(lyingBedSeen)
          ? { bed: lyingBedSeen, since: lyingSince }
          : null;
      cat.brain = decideCat(cat.brain, {
        now,
        beds: cat.beds,
        takenBeds: claimed !== null ? [claimed] : [],
        lying,
        alone: !(owner.othersInRoom?.(room.index) ?? false),
        arrived: cat.arrived,
        spotCount: cat.spots.length,
      });
    }
    if (cat.brain.plan !== cat.lastPlan) {
      cat.lastPlan = cat.brain.plan;
      startPlan(cat, cat.brain.plan);
    }
    if (!cat.active) {
      // 다음에 보일 때 오르내리는 중이면 끝난 자리에 있어요.
      if (cat.hop) {
        moves.x = cat.hop.toX;
        moves.z = cat.hop.toZ;
        cat.y = cat.hop.toY;
        cat.hop = null;
      }
      return;
    }

    const plan = cat.brain.plan;
    let walking = false;
    if (cat.path.length > 0) {
      const step = stepAlong(moves, cat.path, WARD_WALK_SPEED * dt);
      const dx = step.position.x - moves.x;
      const dz = step.position.z - moves.z;
      moves.x = step.position.x;
      moves.z = step.position.z;
      cat.path = step.path;
      const walked = Math.hypot(dx, dz);
      if (walked > 0) {
        walking = true;
        moves.walkPhase += (walked / STRIDE) * Math.PI * 2;
        moves.yaw = turnToward(moves.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * TURN_RATE));
      }
      if (cat.path.length === 0) cat.arrived = true;
    }

    let lift = 0;
    if (cat.hop) {
      const hop = cat.hop;
      hop.t = stillMotion ? 1 : Math.min(1, hop.t + dt / CAT_HOP_SECONDS);
      moves.x = hop.fromX + (hop.toX - hop.fromX) * hop.t;
      moves.z = hop.fromZ + (hop.toZ - hop.fromZ) * hop.t;
      cat.y = hop.fromY + (hop.toY - hop.fromY) * hop.t;
      lift = Math.sin(hop.t * Math.PI) * HOP_HEIGHT;
      moves.yaw = turnToward(moves.yaw, Math.atan2(hop.toX - hop.fromX, hop.toZ - hop.fromZ), 1 - Math.exp(-dt * TURN_RATE));
      if (hop.t >= 1) cat.hop = null;
    } else if (plan.kind === "onBed") {
      moves.yaw = turnToward(moves.yaw, bedCatYaw(BEDS[plan.bed]), 1 - Math.exp(-dt * TURN_RATE));
    }

    const goalWalk = walking && !stillMotion ? 1 : 0;
    const onBed = plan.kind === "onBed" && !cat.hop;
    moves.walkWeight = ease(moves.walkWeight, goalWalk, dt);
    moves.sit = ease(moves.sit, !walking && !cat.hop && !(onBed && plan.purpose === "rest") ? 1 : 0, dt);
    moves.curl = ease(moves.curl, onBed && plan.purpose === "rest" ? 1 : 0, dt);
    drawCat(cat.view, moves, cat.y + lift, dt, pose);
  };

  /** 두 고양이가 가까워지면 서로 보고 코를 맞대요. */
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
      // 코끝이 닿는 거리까지 데리고 온 고양이가 다가서요.
      const gapX = moves.x - cat.moves.x;
      const gapZ = moves.z - cat.moves.z;
      const gap = Math.hypot(gapX, gapZ) || 1;
      const wanted = CAT_NOSE_REACH * 2;
      const next = gap + (wanted - gap) * amount;
      moves.x = cat.moves.x + (gapX / gap) * next;
      moves.z = cat.moves.z + (gapZ / gap) * next;
      return;
    }
    cat.moves.nose = ease(cat.moves.nose, 0, dt);

    if (companion.curling || cat.y > 0 || cat.hop || !catCanGreet(cat.brain.plan)) return;
    const distance = Math.hypot(moves.x - cat.moves.x, moves.z - cat.moves.z);
    if (shouldGreet(distance, now, lastGreet)) {
      lastGreet = now;
      greetLeft = CAT_GREET_SECONDS;
      cat.brain = startGreet(cat.brain, now);
    }
  };

  setCompanion(initialCompanion);

  return {
    setCompanion,
    update(dt, stillMotion) {
      now += dt;
      const lying = owner.lyingBed;
      if (lying !== lyingBedSeen) {
        lyingBedSeen = lying;
        lyingSince = lying === null ? null : now;
      }
      for (const cat of wardCats) updateWardCat(cat, dt, stillMotion);
      updateGreeting(dt);
      if (companion.enabled) companion.update(dt, owner, stillMotion, greetLeft > 0);
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
