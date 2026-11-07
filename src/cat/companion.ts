import type { Object3D } from "three";
import { BEDS, bedCurlSpot } from "../../shared/ward-layout";
import { turnToward } from "../ward/camera-view";
import { addCrumb, followTrail } from "../ward/companion-trail";
import type { TrailPoint } from "../ward/companion-trail";
import { blinkAmount, CAT_NOTICE_SECONDS, composeCatPose, createCatPose } from "./cat-pose";
import type { CatPose } from "./cat-pose";
import { createCatView } from "./cat-view";
import type { CatView } from "./cat-view";

/** 고양이 걸음 한 주기에 걷는 거리예요. */
export const STRIDE = 0.34;
const BLEND_RATE = 7;
export const TURN_RATE = 7;
const COMPANION_SPEED = 2.4;
/** 주인 뒤로 이만큼 떨어져서 따라와요. */
const COMPANION_LAG = 1.1;
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

/** 주인이 지나온 길을 몇 걸음 뒤에서 따라오고, 주인이 누우면 침대 옆에 웅크리는 고양이예요. */
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
      }
    },
    setVisible(visible) {
      view.root.visible = enabled && visible;
    },
    dispose() {
      parent.remove(view.root);
    },
    update(dt, owner, stillMotion, frozen) {
      const lying = owner.lyingBed;
      if (lying !== null && curlBed !== lying) {
        // 주인이 누우면 침대 옆 바닥으로 가서 웅크려요.
        curlBed = lying;
        trail = [...trail, bedCurlSpot(BEDS[lying])];
      } else if (lying === null && curlBed !== null) {
        curlBed = null;
      }
      if (curlBed === null) trail = addCrumb(trail, { x: owner.walkX, z: owner.walkZ });

      let walking = false;
      if (!frozen) {
        const step = followTrail(moves, trail, COMPANION_SPEED * dt, curlBed === null ? COMPANION_LAG : 0);
        trail = step.trail;
        if (step.walked > 0) {
          const dx = step.position.x - moves.x;
          const dz = step.position.z - moves.z;
          moves.x = step.position.x;
          moves.z = step.position.z;
          moves.walkPhase += (step.walked / STRIDE) * Math.PI * 2;
          moves.yaw = turnToward(moves.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * TURN_RATE));
          walking = true;
        }
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
