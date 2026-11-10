import type { Object3D } from "three";
import { BEDS, bedCurlSpot } from "../../shared/ward-layout";
import { turnToward } from "../ward/camera-view";
import { addCrumb, followTrail } from "../ward/companion-trail";
import type { TrailPoint } from "../ward/companion-trail";
import { chooseSideSpot, clearLine, nextHeading, stepToward, wardWalkable } from "../ward/companion-side";
import type { Side } from "../ward/companion-side";
import { blinkAmount, CAT_NOTICE_SECONDS, composeCatPose, createCatPose } from "./cat-pose";
import type { CatPose } from "./cat-pose";
import { createCatView } from "./cat-view";
import type { CatView } from "./cat-view";

/** 고양이 걸음 한 주기에 걷는 거리예요. */
export const STRIDE = 0.34;
const BLEND_RATE = 7;
export const TURN_RATE = 7;
const COMPANION_SPEED = 2.4;
/** 옆자리를 따라 나란히 걷는 빠르기예요. 주인(1.8)보다 조금 빨라서 뒤처지지 않아요. */
const SIDE_SPEED = 2.0;
/** 옆자리에서 멀어졌으면 이만큼 서둘러 따라붙어요. */
const SIDE_CATCH_UP_SPEED = 2.9;
/** 옆자리가 이보다 멀면 곧게 가지 않고 발자국을 따라가요. */
const SIDE_MAX_REACH = 2.5;
/** 문처럼 좁아서 옆에 설 수 없을 때는 발자국을 따라 이만큼 뒤에 있어요. */
const COMPANION_LAG = 0.6;
const COMPANION_SIT_AFTER = 0.8;
/** 켜는 순간 주인과 겹치지 않게 곁에서 나타나요. */
const COMPANION_SPAWN_X = 0.45;
const COMPANION_SPAWN_Z = 0.25;

export interface Moves {
  x: number;
  z: number;
  yaw: number;
  walkPhase: number;
  walkWeight: number;
  sit: number;
  curl: number;
  nose: number;
  /** 고개를 들고 눈을 깜빡이기 시작한 뒤 흐른 시간이에요. 하지 않으면 null이에요. */
  notice: number | null;
}

export const newMoves = (x: number, z: number, yaw: number): Moves => ({
  x,
  z,
  yaw,
  walkPhase: 0,
  walkWeight: 0,
  sit: 1,
  curl: 0,
  nose: 0,
  notice: null,
});

export const ease = (current: number, goal: number, dt: number): number =>
  current + (goal - current) * (1 - Math.exp(-dt * BLEND_RATE));

/** 고개 들기가 부드럽게 시작하고 끝나는 세기예요. */
const noticeStrength = (seconds: number): number =>
  Math.min(1, seconds / 0.4, (CAT_NOTICE_SECONDS - seconds) / 0.4);

export function drawCat(view: CatView, moves: Moves, y: number, dt: number, pose: CatPose): void {
  let lookUp = 0;
  let blink = 0;
  if (moves.notice !== null) {
    moves.notice += dt;
    if (moves.notice >= CAT_NOTICE_SECONDS) {
      moves.notice = null;
    } else {
      lookUp = noticeStrength(moves.notice);
      blink = blinkAmount(moves.notice - 0.4);
    }
  }
  composeCatPose(pose, {
    walkPhase: moves.walkPhase,
    walkWeight: moves.walkWeight,
    sit: moves.sit,
    curl: moves.curl,
    lookUp,
    blink,
    nose: moves.nose,
  });
  view.place(moves.x, y, moves.z, moves.yaw);
  view.apply(pose);
}

/** 고양이가 따라다니는 사람이에요. 나일 수도, 다른 사람일 수도 있어요. */
export interface CompanionOwner {
  readonly walkX: number;
  readonly walkZ: number;
  readonly lyingBed: number | null;
}

export interface Companion {
  readonly enabled: boolean;
  readonly moves: Moves;
  /** 주인이 누워서 웅크리러 가거나 웅크린 중이에요. */
  readonly curling: boolean;
  readonly view: CatView;
  setEnabled(enabled: boolean, owner: CompanionOwner): void;
  /** frozen이면 코를 맞대는 중이라 따라가지 않아요. */
  update(dt: number, owner: CompanionOwner, stillMotion: boolean, frozen: boolean): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * 주인 옆에서 나란히 걷는 고양이예요. 주인이 멈추면 옆에 앉고, 누우면 침대 옆에 웅크려요.
 * 문처럼 좁아서 옆에 설 수 없으면 잠깐 주인이 지나온 길을 따라와요.
 */
export function createCompanion(parent: Object3D): Companion {
  const view = createCatView("companion");
  view.root.visible = false;
  parent.add(view.root);
  const pose = createCatPose();
  let enabled = false;
  let moves = newMoves(0, 0, 0);
  let trail: readonly TrailPoint[] = [];
  let curlBed: number | null = null;
  let still = 0;
  /** 주인이 바라보는 방향과 고양이가 서는 쪽이에요. */
  let heading = 0;
  let side: Side = 1;
  let lastOwner: TrailPoint | null = null;
  /** 지금 옆자리에 나란히 있는지예요. 그러면 멈췄을 때 주인과 같은 쪽을 봐요. */
  let besideOwner = false;

  return {
    get enabled() {
      return enabled;
    },
    get moves() {
      return moves;
    },
    get curling() {
      return curlBed !== null;
    },
    view,
    setEnabled(next, owner) {
      if (enabled === next) return;
      enabled = next;
      view.root.visible = next;
      if (next) {
        // 곁에서 나타나 다시 따라오기 시작해요.
        moves = newMoves(owner.walkX + COMPANION_SPAWN_X, owner.walkZ + COMPANION_SPAWN_Z, moves.yaw);
        trail = [];
        curlBed = null;
        still = COMPANION_SIT_AFTER;
        lastOwner = null;
      }
    },
    setVisible(visible) {
      view.root.visible = enabled && visible;
    },
    dispose() {
      parent.remove(view.root);
    },
    update(dt, owner, stillMotion, frozen) {
      const here = { x: owner.walkX, z: owner.walkZ };
      heading = lastOwner ? nextHeading(lastOwner, here, heading) : heading;
      lastOwner = here;

      const lying = owner.lyingBed;
      if (lying !== null && curlBed !== lying) {
        // 주인이 누우면 침대 옆 바닥으로 가서 웅크려요.
        curlBed = lying;
        trail = [...trail, bedCurlSpot(BEDS[lying])];
      } else if (lying === null && curlBed !== null) {
        curlBed = null;
        trail = [];
      }

      let walking = false;
      const walkTo = (x: number, z: number, walked: number): void => {
        const dx = x - moves.x;
        const dz = z - moves.z;
        moves.x = x;
        moves.z = z;
        moves.walkPhase += (walked / STRIDE) * Math.PI * 2;
        moves.yaw = turnToward(moves.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * TURN_RATE));
        walking = true;
      };

      besideOwner = false;
      if (curlBed === null) {
        trail = addCrumb(trail, here);
        const choice = chooseSideSpot(here, heading, side, wardWalkable);
        const reachable =
          choice !== null &&
          Math.hypot(choice.spot.x - moves.x, choice.spot.z - moves.z) < SIDE_MAX_REACH &&
          clearLine(moves, choice.spot, wardWalkable);
        if (choice && reachable) {
          // 옆자리가 열려 있으면 곧게 가서 나란히 걸어요. 지나온 발자국은 더 쓰지 않아요.
          side = choice.side;
          besideOwner = true;
          trail = [];
          if (!frozen) {
            const step = stepToward(moves, choice.spot, dt, SIDE_SPEED, SIDE_CATCH_UP_SPEED);
            if (step.walked > 0) walkTo(step.position.x, step.position.z, step.walked);
          }
        } else if (!frozen) {
          const step = followTrail(moves, trail, COMPANION_SPEED * dt, COMPANION_LAG);
          trail = step.trail;
          if (step.walked > 0) walkTo(step.position.x, step.position.z, step.walked);
        }
      } else if (!frozen) {
        const step = followTrail(moves, trail, COMPANION_SPEED * dt, 0);
        trail = step.trail;
        if (step.walked > 0) walkTo(step.position.x, step.position.z, step.walked);
      }
      // 옆에 멈춰 앉으면 주인과 같은 쪽을 바라봐요.
      if (!walking && besideOwner && !frozen) {
        moves.yaw = turnToward(moves.yaw, heading, 1 - Math.exp(-dt * TURN_RATE * 0.5));
      }
      still = walking ? 0 : still + dt;

      const curled = curlBed !== null && trail.length === 0;
      moves.walkWeight = ease(moves.walkWeight, walking && !stillMotion ? 1 : 0, dt);
      moves.sit = ease(moves.sit, !curled && still >= COMPANION_SIT_AFTER ? 1 : 0, dt);
      moves.curl = ease(moves.curl, curled ? 1 : 0, dt);
      moves.nose = ease(moves.nose, frozen ? 1 : 0, dt);
      if (view.root.visible) drawCat(view, moves, 0, dt, pose);
    },
  };
}
