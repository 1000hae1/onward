/**
 * 아바타 동작을 숫자로 계산해요. 화면과 상관없는 순수 함수이고, 매 프레임 새 객체를 만들지 않도록
 * 미리 만들어 둔 Pose에 값을 써요. 각도는 라디안, 거리는 미터예요.
 *
 * 달걀 몸에는 목과 다리가 없어서, 몸 전체가 발바닥을 축으로 기울고 팔 뭉치는 몸 가운데를 축으로
 * 몸을 따라 앞뒤로 돌아요. 발은 바닥에서 살짝 들리고 앞뒤로 옮겨 가요.
 */

/** hug는 서서 안기, hug-low는 누운 사람을 침대 옆에서 몸을 낮춰 안기예요. */
export type Gesture = "pray" | "bow" | "hug" | "hug-low";

export interface Pose {
  /** 걸을 때 몸이 위아래로 움직이는 높이예요. */
  bob: number;
  /** 몸이 좌우로 기우는 각도예요. +면 왼쪽(-x)으로 기울어요. */
  sway: number;
  /** 걸을 때 몸이 좌우로 비틀리는 각도예요. */
  twist: number;
  /** 발바닥을 축으로 앞으로 숙이는 각도예요. */
  lean: number;
  /** 숨쉬기예요. +면 위로 늘어나고 옆으로 줄어요. 0.02면 2%예요. */
  breathe: number;
  /** 팔 뭉치가 몸을 따라 앞으로 돈 각도예요. 0은 몸 옆이에요. */
  armLeftSwing: number;
  armRightSwing: number;
  /** 팔 뭉치를 들어 올린 높이예요. */
  armLeftLift: number;
  armRightLift: number;
  /** 발을 바닥에서 든 높이예요. */
  footLeftLift: number;
  footRightLift: number;
  /** 발을 앞으로 내민 거리예요. */
  footLeftStep: number;
  footRightStep: number;
  /** 서 있는 자리에서 침대 위 자리로 옮겨 간 비율이에요. */
  bedTravel: number;
  /** 침대 높이로 올라간 비율이에요. */
  bedLift: number;
  /** 눕는 방향으로 돌아선 비율이에요. */
  bedTurn: number;
  /** 몸을 눕힌 비율이에요. */
  bedLie: number;
  /** 벤치 앞자리에서 앉는 자리로 옮겨 간 비율이에요. */
  seatTravel: number;
  /** 벤치 높이로 올라앉은 비율이에요. */
  seatLift: number;
  /** 벤치 앞쪽으로 돌아선 비율이에요. */
  seatTurn: number;
  /** 등을 기대고 발을 앞으로 내민 비율이에요. */
  seatSit: number;
}

export interface PoseInput {
  /** 걸은 거리에 맞춰 늘어나는 걸음 위상이에요. */
  walkPhase: number;
  /** 걷기 동작의 세기예요. 0이면 멈춰 있어요. */
  walkWeight: number;
  /** 시간에 맞춰 늘어나는 숨 위상이에요. 동작 줄이기를 켜면 0을 넘겨요. */
  breathPhase: number;
  gesture: Gesture | null;
  gestureElapsed: number;
  /** 0은 선 자세, 1은 다 누운 자세예요. */
  bedProgress: number;
  /** 0은 선 자세, 1은 벤치에 다 앉은 자세예요. 없으면 0이에요. */
  seatProgress?: number;
  /** 한 손에 꽃다발을 들고 있으면 그 팔은 앞으로 든 채예요. */
  carrying: boolean;
  /** 숨의 크기예요. 없으면 1이고, 잠들면 조금 작아져요. */
  breathAmount?: number;
}

/** 걸음마다 좌우로 기우는 각도예요. 짧은 발로 뒤뚱뒤뚱 걸어요. */
const WADDLE_SWAY = 0.12;
const WADDLE_TWIST = 0.07;
const WADDLE_BOB = 0.016;
const FOOT_LIFT = 0.03;
const FOOT_STEP = 0.035;
const WALK_ARM_SWING = 0.35;
const CARRY_ARM_SWING_RATIO = 0.2;

/** 숨 한 번에 걸리는 시간이에요. */
export const BREATH_SECONDS = 4.2;
/** 잠들었을 때 숨 한 번에 걸리는 시간이에요. 아주 느려요. */
export const SLEEP_BREATH_SECONDS = 7.5;
/** 잠들었을 때 숨의 크기예요. 깨어 있을 때보다 조금 작아요. */
export const SLEEP_BREATH_AMOUNT = 0.75;
const BREATH_AMOUNT = 0.016;

/** 꽃다발을 든 팔이 몸 앞쪽으로 돈 각도예요. */
export const CARRY_ARM_SWING = 0.95;
const CARRY_ARM_LIFT = 0.03;

/** 두 팔 뭉치가 배 앞 가운데에서 맞닿는 각도예요. */
export const PRAY_ARM_SWING = 1.4;
const PRAY_ARM_LIFT = 0.045;
const PRAY_LEAN = 0.06;

const BOW_LEAN = 0.36;
const BOW_ARM_SWING = 1.1;

const LYING_ARM_SWING = 0.15;

/** 벤치에 앉으면 등받이 쪽으로 살짝 기대고, 짧은 발은 앞으로 내밀어 달랑 들려요. */
const SEAT_LEAN = -0.1;
const SEAT_FOOT_STEP = 0.08;
const SEAT_FOOT_LIFT = 0.025;
/** 두 팔은 무릎 위에 얹듯 조금 앞으로 와요. */
const SEAT_ARM_SWING = 0.4;

/** 두 팔을 앞으로 벌려 상대를 감싸요. */
const HUG_ARM_SWING = 1.2;
const HUG_ARM_LIFT = 0.07;
const HUG_LEAN = 0.12;
/** 침대 옆에 앉듯 몸을 낮추고 더 숙여요. */
const HUG_LOW_LEAN = 0.34;
const HUG_LOW_SINK = -0.12;

interface GestureTiming {
  fadeIn: number;
  hold: number;
  fadeOut: number;
}

const GESTURE_TIMING: Record<Gesture, GestureTiming> = {
  pray: { fadeIn: 0.4, hold: 1.8, fadeOut: 0.45 },
  bow: { fadeIn: 0.45, hold: 0.35, fadeOut: 0.6 },
  // 꼭 안는 3초예요.
  hug: { fadeIn: 0.5, hold: 3, fadeOut: 0.6 },
  "hug-low": { fadeIn: 0.6, hold: 3, fadeOut: 0.6 },
};

/** 눕거나 일어나는 데 걸리는 시간이에요. */
export const BED_TRANSITION_SECONDS = 1.1;
/** 걸음 한 주기에 걷는 거리예요. 발이 짧아서 보폭이 좁아요. */
export const STRIDE_LENGTH = 0.55;

export function createPose(): Pose {
  return {
    bob: 0,
    sway: 0,
    twist: 0,
    lean: 0,
    breathe: 0,
    armLeftSwing: 0,
    armRightSwing: 0,
    armLeftLift: 0,
    armRightLift: 0,
    footLeftLift: 0,
    footRightLift: 0,
    footLeftStep: 0,
    footRightStep: 0,
    bedTravel: 0,
    bedLift: 0,
    bedTurn: 0,
    bedLie: 0,
    seatTravel: 0,
    seatLift: 0,
    seatTurn: 0,
    seatSit: 0,
  };
}

export function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 숨 위상을 dt만큼 앞으로 보내요. 동작 줄이기를 켜면 0에 머물러요. */
export function advanceBreath(phase: number, dt: number, still: boolean, seconds = BREATH_SECONDS): number {
  if (still) return 0;
  return (phase + (dt / seconds) * Math.PI * 2) % (Math.PI * 2);
}

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
  const { walkPhase, walkWeight, breathPhase, gesture, gestureElapsed, bedProgress, carrying } = input;
  const seatProgress = input.seatProgress ?? 0;
  const side = Math.sin(walkPhase);
  const stride = Math.cos(walkPhase);
  const w = walkWeight;

  // 몸이 왼쪽으로 기울면 왼발에 무게가 실리고 오른발이 들려요.
  out.sway = side * WADDLE_SWAY * w;
  out.twist = stride * WADDLE_TWIST * w;
  out.bob = Math.abs(side) * WADDLE_BOB * w;
  out.lean = 0;
  out.breathe = Math.sin(breathPhase) * BREATH_AMOUNT * (input.breathAmount ?? 1) * (1 - w);
  out.footLeftLift = Math.max(0, -side) * FOOT_LIFT * w;
  out.footRightLift = Math.max(0, side) * FOOT_LIFT * w;
  out.footLeftStep = stride * FOOT_STEP * w;
  out.footRightStep = -out.footLeftStep;
  // 왼발이 나갈 때 왼팔은 뒤로 가요.
  out.armLeftSwing = -stride * WALK_ARM_SWING * w;
  out.armLeftLift = 0;
  out.armRightSwing = carrying ? CARRY_ARM_SWING + stride * WALK_ARM_SWING * CARRY_ARM_SWING_RATIO * w : -out.armLeftSwing;
  out.armRightLift = carrying ? CARRY_ARM_LIFT : 0;

  if (gesture === "pray") {
    const weight = gestureWeight(gesture, gestureElapsed);
    out.lean = mix(out.lean, PRAY_LEAN, weight);
    out.armLeftSwing = mix(out.armLeftSwing, PRAY_ARM_SWING, weight);
    out.armRightSwing = mix(out.armRightSwing, PRAY_ARM_SWING, weight);
    out.armLeftLift = mix(out.armLeftLift, PRAY_ARM_LIFT, weight);
    out.armRightLift = mix(out.armRightLift, PRAY_ARM_LIFT, weight);
  } else if (gesture === "hug" || gesture === "hug-low") {
    const weight = gestureWeight(gesture, gestureElapsed);
    const low = gesture === "hug-low";
    out.lean = mix(out.lean, low ? HUG_LOW_LEAN : HUG_LEAN, weight);
    out.bob = mix(out.bob, low ? HUG_LOW_SINK : 0, weight);
    out.armLeftSwing = mix(out.armLeftSwing, HUG_ARM_SWING, weight);
    out.armRightSwing = mix(out.armRightSwing, HUG_ARM_SWING, weight);
    out.armLeftLift = mix(out.armLeftLift, HUG_ARM_LIFT, weight);
    out.armRightLift = mix(out.armRightLift, HUG_ARM_LIFT, weight);
  } else if (gesture === "bow") {
    const weight = gestureWeight(gesture, gestureElapsed);
    out.lean = mix(out.lean, BOW_LEAN, weight);
    out.armLeftSwing = mix(out.armLeftSwing, BOW_ARM_SWING, weight);
    if (!carrying) out.armRightSwing = mix(out.armRightSwing, BOW_ARM_SWING, weight);
  }

  // 침대 곁으로 다가가 돌아선 뒤, 올라가면서 몸을 눕혀요. 일어날 때는 이 순서를 거꾸로 밟아요.
  out.bedTurn = smoothstep(0, 0.5, bedProgress);
  out.bedTravel = smoothstep(0.1, 0.7, bedProgress);
  out.bedLift = smoothstep(0.1, 0.6, bedProgress);
  out.bedLie = smoothstep(0.45, 1, bedProgress);

  if (out.bedLie > 0) {
    const lie = out.bedLie;
    out.lean = mix(out.lean, 0, lie);
    out.sway = mix(out.sway, 0, lie);
    out.twist = mix(out.twist, 0, lie);
    out.armLeftSwing = mix(out.armLeftSwing, LYING_ARM_SWING, lie);
    out.armLeftLift = mix(out.armLeftLift, 0, lie);
    // 꽃다발을 든 문병객은 눕지 않아서, 눕는 자세는 빈손만 생각해요.
    out.armRightSwing = mix(out.armRightSwing, LYING_ARM_SWING, lie);
    out.armRightLift = mix(out.armRightLift, 0, lie);
    out.footLeftLift = mix(out.footLeftLift, 0, lie);
    out.footRightLift = mix(out.footRightLift, 0, lie);
    out.footLeftStep = mix(out.footLeftStep, 0, lie);
    out.footRightStep = mix(out.footRightStep, 0, lie);
  }

  // 벤치 앞에서 돌아선 뒤, 뒤로 옮겨 가며 올라앉아요. 일어날 때는 이 순서를 거꾸로 밟아요.
  out.seatTurn = smoothstep(0, 0.45, seatProgress);
  out.seatTravel = smoothstep(0.15, 0.75, seatProgress);
  out.seatLift = smoothstep(0.2, 0.8, seatProgress);
  out.seatSit = smoothstep(0.4, 1, seatProgress);

  if (out.seatSit > 0) {
    const sit = out.seatSit;
    // 앉은 채로 목례하면 기댄 자세에서 숙여요.
    out.lean += SEAT_LEAN * sit;
    out.footLeftStep = mix(out.footLeftStep, SEAT_FOOT_STEP, sit);
    out.footRightStep = mix(out.footRightStep, SEAT_FOOT_STEP, sit);
    out.footLeftLift = mix(out.footLeftLift, SEAT_FOOT_LIFT, sit);
    out.footRightLift = mix(out.footRightLift, SEAT_FOOT_LIFT, sit);
    if (!gesture) {
      out.armLeftSwing = mix(out.armLeftSwing, SEAT_ARM_SWING, sit);
      if (!carrying) out.armRightSwing = mix(out.armRightSwing, SEAT_ARM_SWING, sit);
    }
  }
  return out;
}
