import type { Object3D } from "three";
import { bedApproach, bedCatSeat, bedCatYaw, BED_SURFACE_Y, BEDS, bedCurlSpot } from "../../shared/ward-layout";
import type { CatSceneKind } from "../../shared/cat-play-rules";
import { sceneFrame, sceneRest } from "./cat-play";
import type { PlayScene, SceneFrame } from "./cat-play";
import { createCatProps } from "./cat-props";
import { turnToward } from "../ward/camera-view";
import { addCrumb, followTrail } from "../ward/companion-trail";
import type { TrailPoint } from "../ward/companion-trail";
import { chooseSideSpot, clearLine, nextHeading, stepToward, wardWalkable } from "../ward/companion-side";
import type { Side } from "../ward/companion-side";
import { blinkAmount, CAT_NOTICE_SECONDS, composeCatPose, createCatPose, restPlayPose } from "./cat-pose";
import type { CatPlayPose, CatPose } from "./cat-pose";
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
  /** 놀이 자세예요. 놀지 않으면 모두 0이에요. */
  play: CatPlayPose;
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
  play: restPlayPose(),
});

/** 장면 한 장면을 고양이 움직임에 옮겨요. 걸은 거리만큼 걸음 위상도 늘려요. */
export function applySceneFrame(moves: Moves, frame: SceneFrame, dt: number, stillMotion: boolean): void {
  const walked = Math.hypot(frame.x - moves.x, frame.z - moves.z);
  if (walked < 1) moves.walkPhase += (walked / STRIDE) * Math.PI * 2;
  moves.x = frame.x;
  moves.z = frame.z;
  moves.yaw = walked >= 1 ? frame.yaw : turnToward(moves.yaw, frame.yaw, 1 - Math.exp(-dt * TURN_RATE));
  moves.walkWeight = ease(moves.walkWeight, frame.walking && !stillMotion ? 1 : 0, dt);
  moves.sit = ease(moves.sit, frame.sit, dt);
  moves.curl = ease(moves.curl, frame.curl, dt);
  // 놀이 자세는 장면이 정한 대로 바로 따라요. 동작 줄이기를 켜면 흔들림은 빼요.
  moves.play = stillMotion ? { ...frame.play, wiggle: 0, headRoll: 0, knead: 0, roll: frame.play.roll > 0.6 ? 1.2 : 0 } : frame.play;
}

/** 서버가 알려 준 놀이예요. 데리고 다니는 고양이는 각 화면에서 지금 있는 자리부터 놀아요. */
export interface CompanionPlay {
  kind: CatSceneKind;
  seed: number;
  at: number;
  until: number;
  /** 함께 노는 사람의 자리예요. */
  person: { x: number; z: number };
  bed: number | null;
}

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
    play: moves.play,
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
  /** 놀이를 시작해요. elapsedMs는 서버 시각으로 이미 흐른 시간이에요. */
  startPlay(play: CompanionPlay, elapsedMs: number): void;
  /** 곁에서 자던 고양이가 until에 깨어나요. */
  wake(until: number): void;
  /** 지금 노는 중이에요. */
  readonly playing: boolean;
  /** 장면에서 함께 노는 사람 손의 자리를 바꿔요. 낚싯대를 이어 그릴 때 써요. */
  setPlayHand(hand: { x: number; z: number } | null): void;
  /** 병동 고양이가 털실을 쫓으면 곁에서 같이 쫓아요. 매 프레임 update 전에 정해요. */
  setChase(ball: { x: number; z: number } | null): void;
}

/** 같이 털실을 쫓을 때 공 앞에서 멈추는 거리와 빠르기예요. */
const CHASE_STOP = 0.24;
const CHASE_SPEED = 1.4;

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
  const props = createCatProps(parent);
  /** 지금 하는 놀이와 서버 시각으로 흐른 시간이에요. */
  let scene: PlayScene | null = null;
  let playMs = 0;
  let playHand: { x: number; z: number } | null = null;
  /** 침대 위에서 놀이가 끝나면 바닥으로 뛰어내려요. */
  let landing: { from: { x: number; y: number; z: number }; to: { x: number; z: number }; t: number } | null = null;
  let y = 0;
  let chase: { x: number; z: number } | null = null;
  let chaseTime = 0;

  /** 같이 털실을 쫓는 중이면 공 쪽으로 가서 톡톡 치고 true를 돌려줘요. */
  const updateChase = (dt: number, stillMotion: boolean): boolean => {
    if (!chase || curlBed !== null) {
      chaseTime = 0;
      return false;
    }
    chaseTime += dt;
    const dx = chase.x - moves.x;
    const dz = chase.z - moves.z;
    const distance = Math.hypot(dx, dz);
    const walked = Math.max(0, Math.min(distance - CHASE_STOP, CHASE_SPEED * dt));
    if (walked > 0) {
      moves.x += (dx / distance) * walked;
      moves.z += (dz / distance) * walked;
      moves.walkPhase += (walked / STRIDE) * Math.PI * 2;
    }
    moves.yaw = turnToward(moves.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * TURN_RATE));
    const close = distance - CHASE_STOP < 0.05;
    moves.walkWeight = ease(moves.walkWeight, walked > 0 && !stillMotion ? 1 : 0, dt);
    moves.sit = ease(moves.sit, 0, dt);
    moves.curl = ease(moves.curl, 0, dt);
    moves.play = { ...restPlayPose(), crouch: close ? 0.5 : 0, paw: close && !stillMotion ? Math.max(0, Math.sin(chaseTime * 6 + 1.5)) : 0 };
    trail = [];
    return true;
  };

  /** 놀이 중이면 장면을 그리고 true를 돌려줘요. */
  const updatePlay = (dt: number, stillMotion: boolean): boolean => {
    if (scene) {
      playMs += dt * 1000;
      const time = scene.at + playMs;
      if (time < scene.until) {
        const frame = sceneFrame(scene, time);
        applySceneFrame(moves, frame, dt, stillMotion);
        y = frame.y;
        props.show(frame, playHand);
        return true;
      }
      // 장면이 끝났어요. 침대 위였으면 내려와요.
      const rest = sceneRest(scene);
      landing = y > 0 ? { from: { x: moves.x, y, z: moves.z }, to: rest.point, t: 0 } : null;
      scene = null;
      props.show(null, null);
      moves.play = restPlayPose();
      trail = [];
    }
    if (landing) {
      landing.t = Math.min(1, landing.t + dt / 0.7);
      const t = landing.t;
      moves.x = landing.from.x + (landing.to.x - landing.from.x) * t;
      moves.z = landing.from.z + (landing.to.z - landing.from.z) * t;
      y = landing.from.y * (1 - t) + Math.sin(t * Math.PI) * 0.2;
      if (t >= 1) {
        landing = null;
        y = 0;
      }
      return true;
    }
    return false;
  };

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
    get playing() {
      return scene !== null;
    },
    view,
    startPlay(play, elapsedMs) {
      const bed = play.bed === null ? null : BEDS[play.bed];
      scene = {
        kind: play.kind,
        seed: play.seed,
        at: play.at,
        until: play.until,
        start: { x: moves.x, y, z: moves.z, yaw: moves.yaw },
        floor: { x: moves.x, z: moves.z },
        person: play.person,
        bed: bed
          ? { approach: bedApproach(bed), seat: bedCatSeat(bed, true), yaw: bedCatYaw(bed), height: BED_SURFACE_Y }
          : null,
        door: null,
        // 데리고 다니는 고양이는 늘 주인 곁이라 곧게 가요.
        path: (_from, to) => [to],
      };
      playMs = Math.max(0, elapsedMs);
      playHand = play.kind === "wand" ? play.person : null;
      landing = null;
    },
    wake(until) {
      if (scene) scene = { ...scene, until: Math.min(scene.until, until) };
    },
    setChase(ball) {
      if (ball === null && chase !== null) moves.play = restPlayPose();
      chase = ball;
    },
    setPlayHand(hand) {
      if (scene?.kind === "wand") playHand = hand;
    },
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
      props.dispose();
    },
    update(dt, owner, stillMotion, frozen) {
      if (updatePlay(dt, stillMotion)) {
        if (view.root.visible) drawCat(view, moves, y, dt, pose);
        lastOwner = { x: owner.walkX, z: owner.walkZ };
        return;
      }
      if (updateChase(dt, stillMotion)) {
        if (view.root.visible) drawCat(view, moves, 0, dt, pose);
        lastOwner = { x: owner.walkX, z: owner.walkZ };
        return;
      }
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
