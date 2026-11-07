/**
 * 아바타 동작을 숫자로 계산해요. 화면과 상관없는 순수 함수이고, 매 프레임 새 객체를 만들지 않도록
 * 미리 만들어 둔 Pose에 값을 써요. 각도는 라디안이에요.
 */

export type Gesture = "pray" | "bow";

export interface Pose {
  /** 걸을 때 몸이 위아래로 움직이는 높이예요. */
  bob: number;
  /** 걸을 때 몸이 좌우로 기우는 각도예요. */
  sway: number;
  /** 허리에서 앞으로 숙이는 각도예요. */
  lean: number;
  headPitch: number;
  armLeftPitch: number;
  armRightPitch: number;
  /** 팔을 몸 가운데로 모으는 각도예요. */
  armLeftIn: number;
  armRightIn: number;
  legLeftPitch: number;
  legRightPitch: number;
  /** 서 있는 자리에서 침대 위 자리로 옮겨 간 비율이에요. */
  bedTravel: number;
  /** 침대 높이로 올라간 비율이에요. */
  bedLift: number;
  /** 눕는 방향으로 돌아선 비율이에요. */
  bedTurn: number;
  /** 몸을 눕힌 비율이에요. */
  bedLie: number;
}

export interface PoseInput {
  /** 걸은 거리에 맞춰 늘어나는 걸음 위상이에요. */
  walkPhase: number;
  /** 걷기 동작의 세기예요. 0이면 멈춰 있어요. */
  walkWeight: number;
  gesture: Gesture | null;
  gestureElapsed: number;
  /** 0은 선 자세, 1은 다 누운 자세예요. */
  bedProgress: number;
  /** 한 손에 꽃다발을 들고 있으면 그 팔은 앞으로 든 채예요. */
  carrying: boolean;
}

const WALK_LEG_SWING = 0.6;
const WALK_ARM_SWING = 0.45;
const CARRY_ARM_SWING_RATIO = 0.2;
const WALK_BOB = 0.018;
const WALK_SWAY = 0.035;

export const CARRY_ARM_PITCH = -0.95;
const CARRY_ARM_IN = 0.18;

const PRAY_ARM_PITCH = -1.25;
/** 양손 끝이 가슴 앞 가운데에서 만나는 각도예요. */
const PRAY_ARM_IN = 0.64;
const PRAY_HEAD = 0.18;
const PRAY_LEAN = 0.05;

const BOW_LEAN = 0.5;
const BOW_HEAD = 0.22;
const BOW_ARM_PITCH = -0.28;

const LYING_LEG_PITCH = 0.22;
const LYING_HEAD_PITCH = 0.1;
const LYING_ARM_IN = -0.08;

interface GestureTiming {
  fadeIn: number;
  hold: number;
  fadeOut: number;
}

const GESTURE_TIMING: Record<Gesture, GestureTiming> = {
  pray: { fadeIn: 0.4, hold: 1.8, fadeOut: 0.45 },
  bow: { fadeIn: 0.45, hold: 0.35, fadeOut: 0.6 },
};

/** 눕거나 일어나는 데 걸리는 시간이에요. */
export const BED_TRANSITION_SECONDS = 1.1;
/** 걸음 한 주기에 걷는 거리예요. */
export const STRIDE_LENGTH = 0.9;

export function createPose(): Pose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    headPitch: 0,
    armLeftPitch: 0,
    armRightPitch: 0,
    armLeftIn: 0,
    armRightIn: 0,
    legLeftPitch: 0,
    legRightPitch: 0,
    bedTravel: 0,
    bedLift: 0,
    bedTurn: 0,
    bedLie: 0,
  };
}

export function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function gestureDuration(gesture: Gesture): number {
  const timing = GESTURE_TIMING[gesture];
  return timing.fadeIn + timing.hold + timing.fadeOut;
}

/** 동작의 세기를 시간으로 알려 줘요. 천천히 들어갔다가 잠시 머문 뒤 돌아와요. */
export function gestureWeight(gesture: Gesture, elapsed: number): number {
  const { fadeIn, hold, fadeOut } = GESTURE_TIMING[gesture];
  if (elapsed <= 0) return 0;
  if (elapsed < fadeIn) return smoothstep(0, fadeIn, elapsed);
  if (elapsed < fadeIn + hold) return 1;
  return 1 - smoothstep(fadeIn + hold, fadeIn + hold + fadeOut, elapsed);
}

/** 지금 입력에 맞는 자세를 out에 써요. */
export function composePose(out: Pose, input: PoseInput): Pose {
  const { walkPhase, walkWeight, gesture, gestureElapsed, bedProgress, carrying } = input;
  const swing = Math.sin(walkPhase);
  const armSwing = swing * WALK_ARM_SWING * walkWeight;

  out.bob = Math.abs(Math.cos(walkPhase)) * WALK_BOB * walkWeight;
  out.sway = swing * WALK_SWAY * walkWeight;
  out.lean = 0;
  out.headPitch = 0;
  out.legLeftPitch = swing * WALK_LEG_SWING * walkWeight;
  out.legRightPitch = -out.legLeftPitch;
  out.armLeftPitch = -armSwing;
  out.armLeftIn = 0;
  out.armRightPitch = carrying ? CARRY_ARM_PITCH + armSwing * CARRY_ARM_SWING_RATIO : armSwing;
  out.armRightIn = carrying ? CARRY_ARM_IN : 0;

  if (gesture === "pray") {
    const weight = gestureWeight(gesture, gestureElapsed);
    out.lean = mix(out.lean, PRAY_LEAN, weight);
    out.headPitch = mix(out.headPitch, PRAY_HEAD, weight);
    out.armLeftPitch = mix(out.armLeftPitch, PRAY_ARM_PITCH, weight);
    out.armRightPitch = mix(out.armRightPitch, PRAY_ARM_PITCH, weight);
    out.armLeftIn = mix(out.armLeftIn, PRAY_ARM_IN, weight);
    out.armRightIn = mix(out.armRightIn, PRAY_ARM_IN, weight);
  } else if (gesture === "bow") {
    const weight = gestureWeight(gesture, gestureElapsed);
    out.lean = mix(out.lean, BOW_LEAN, weight);
    out.headPitch = mix(out.headPitch, BOW_HEAD, weight);
    out.armLeftPitch = mix(out.armLeftPitch, BOW_ARM_PITCH, weight);
    if (!carrying) out.armRightPitch = mix(out.armRightPitch, BOW_ARM_PITCH, weight);
  }

  // 침대 곁으로 다가가 돌아앉은 뒤, 올라가면서 몸을 눕혀요. 일어날 때는 이 순서를 거꾸로 밟아요.
  out.bedTurn = smoothstep(0, 0.5, bedProgress);
  out.bedTravel = smoothstep(0.1, 0.7, bedProgress);
  out.bedLift = smoothstep(0.1, 0.6, bedProgress);
  out.bedLie = smoothstep(0.45, 1, bedProgress);

  if (out.bedLie > 0) {
    const lie = out.bedLie;
    out.lean = mix(out.lean, 0, lie);
    out.headPitch = mix(out.headPitch, LYING_HEAD_PITCH, lie);
    out.legLeftPitch = mix(out.legLeftPitch, LYING_LEG_PITCH, lie);
    out.legRightPitch = mix(out.legRightPitch, LYING_LEG_PITCH, lie);
    out.armLeftPitch = mix(out.armLeftPitch, 0, lie);
    out.armLeftIn = mix(out.armLeftIn, LYING_ARM_IN, lie);
    // 꽃다발을 든 문병객은 눕지 않아서, 눕는 자세는 빈손만 생각해요.
    out.armRightPitch = mix(out.armRightPitch, 0, lie);
    out.armRightIn = mix(out.armRightIn, LYING_ARM_IN, lie);
  }
  return out;
}
