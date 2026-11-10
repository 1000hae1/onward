/**
 * 병원 앞 남색 라이트박스 간판의 배치와 규칙이에요. 화면이나 three에 기대지 않는 순수한 값과 함수예요.
 * 좌표는 앞면 텍스처(2048×680)의 픽셀이에요. 왼쪽 위가 (0, 0)이에요.
 */
import type { TimeSlot } from "./time-of-day";

export const SIGN_TEXTURE = { width: 2048, height: 680 } as const;
/** 바깥 테두리 두께와 모서리 둥글기예요. */
export const SIGN_FRAME = { border: 34, outerRadius: 92, innerRadius: 62 } as const;

export interface Circle {
  x: number;
  y: number;
  r: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SIGN_MOON: Circle = { x: 400, y: 330, r: 168 };
/** 큰 글자 "온기병동"이 들어가는 칸이에요. 글자가 넓으면 이 칸에 맞게 줄여요. */
export const SIGN_TITLE: Box = { x: 650, y: 150, w: 1080, h: 290 };
/** 작은 문구 "서로의 평안을 빌어주는 곳"이 들어가는 칸이에요. */
export const SIGN_SUBTITLE: Box = { x: 650, y: 458, w: 1080, h: 104 };
export const SIGN_TITLE_TEXT = "온기병동";
export const SIGN_SUBTITLE_TEXT = "서로의 평안을 빌어주는 곳";

/** 별이 글자와 달에서 떨어져 있어야 하는 거리예요. */
export const STAR_CLEARANCE = 14;

export interface SignStar {
  kind: "dot" | "sparkle";
  x: number;
  y: number;
  /** 점 별은 반지름, 십자 별은 갈래 끝까지의 길이예요. */
  r: number;
  /** 밝기 비율이에요. 낮과 밤의 투명도 범위 안에서 이 비율만큼 밝아요. 0~1 */
  bright: number;
  /** 반짝이는 별만 있어요. 한 번 밝아졌다 어두워지는 데 걸리는 초와 시작 위상(0~1)이에요. */
  twinkle?: { period: number; phase: number };
}

/** 점 별 16개는 가장자리 위주로, 십자 별 4개는 달 오른쪽 위·오른쪽 가운데·오른쪽 아래·달 오른쪽 아래에 있어요. */
export const SIGN_STARS: readonly SignStar[] = [
  // 위쪽 가장자리
  { kind: "dot", x: 150, y: 84, r: 7, bright: 0.8 },
  { kind: "dot", x: 318, y: 74, r: 5, bright: 0.45, twinkle: { period: 4.2, phase: 0.1 } },
  { kind: "dot", x: 812, y: 92, r: 6, bright: 0.65 },
  { kind: "dot", x: 1018, y: 72, r: 9, bright: 1 },
  { kind: "dot", x: 1268, y: 96, r: 5, bright: 0.5, twinkle: { period: 3.4, phase: 0.55 } },
  { kind: "dot", x: 1504, y: 78, r: 7, bright: 0.75 },
  { kind: "dot", x: 1760, y: 98, r: 6, bright: 0.55 },
  { kind: "dot", x: 1948, y: 84, r: 8, bright: 0.9 },
  // 왼쪽 가장자리
  { kind: "dot", x: 82, y: 312, r: 6, bright: 0.6 },
  { kind: "dot", x: 104, y: 570, r: 8, bright: 0.85, twinkle: { period: 4.8, phase: 0.3 } },
  // 아래쪽 가장자리
  { kind: "dot", x: 300, y: 612, r: 5, bright: 0.5 },
  { kind: "dot", x: 882, y: 606, r: 7, bright: 0.7 },
  { kind: "dot", x: 1150, y: 618, r: 5, bright: 0.45 },
  { kind: "dot", x: 1424, y: 602, r: 8, bright: 0.9, twinkle: { period: 3.8, phase: 0.8 } },
  // 오른쪽 가장자리
  { kind: "dot", x: 1958, y: 206, r: 5, bright: 0.55 },
  { kind: "dot", x: 1950, y: 478, r: 6, bright: 0.65 },
  // 십자 별
  { kind: "sparkle", x: 604, y: 116, r: 40, bright: 1, twinkle: { period: 4.5, phase: 0 } },
  { kind: "sparkle", x: 1858, y: 330, r: 46, bright: 0.95 },
  { kind: "sparkle", x: 1822, y: 572, r: 36, bright: 0.85, twinkle: { period: 3.2, phase: 0.45 } },
  { kind: "sparkle", x: 604, y: 576, r: 32, bright: 0.8 },
];

/** 낮(06~18시)에는 불 꺼진 간판, 저녁과 소등(18~06시)에는 불 켜진 간판이에요. */
export function signLitFor(slot: TimeSlot): boolean {
  return slot !== "day";
}

/** 불이 켜지고 꺼지는 데 걸리는 초예요. */
export const SIGN_TRANSITION_SECONDS = 2;

/** 불 켜짐 정도(0~1)를 목표 쪽으로 dt만큼 옮겨요. 2초 동안 고르게 움직여요. */
export function stepLit(current: number, target: number, dt: number): number {
  const step = dt / SIGN_TRANSITION_SECONDS;
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}

/** 화면에 쓸 불 켜짐 정도예요. 처음과 끝이 부드러워요. */
export function easeLit(lit: number): number {
  const t = Math.min(1, Math.max(0, lit));
  return t * t * (3 - 2 * t);
}

/** 별의 투명도 범위예요. 낮 점 별 50~70%, 낮 십자 별 75~85%, 밤 점 별 70~100%, 밤 십자 별 100%예요. */
export function starOpacity(star: SignStar, lit: boolean): number {
  if (!lit) return star.kind === "dot" ? 0.5 + 0.2 * star.bright : 0.75 + 0.1 * star.bright;
  return star.kind === "dot" ? 0.7 + 0.3 * star.bright : 1;
}

/** 반짝임이 가장 어두울 때 남는 밝기 비율이에요. */
const TWINKLE_LOW = 0.35;

/**
 * 밤 별의 지금 투명도예요. 반짝이는 별은 저마다의 박자로 천천히 밝아졌다 어두워져요.
 * lively가 false이면(저사양, 움직임 줄이기) 반짝이지 않아요.
 */
export function twinkleOpacity(star: SignStar, seconds: number, lively: boolean): number {
  const base = starOpacity(star, true);
  if (!lively || !star.twinkle) return base;
  const wave = 0.5 + 0.5 * Math.cos(2 * Math.PI * (seconds / star.twinkle.period + star.twinkle.phase));
  return base * (TWINKLE_LOW + (1 - TWINKLE_LOW) * wave);
}

/** 원과 사각형 사이의 가장 가까운 거리예요. 겹치면 0이에요. */
export function circleBoxGap(circle: Circle, box: Box): number {
  const dx = Math.max(box.x - circle.x, 0, circle.x - (box.x + box.w));
  const dy = Math.max(box.y - circle.y, 0, circle.y - (box.y + box.h));
  return Math.max(0, Math.hypot(dx, dy) - circle.r);
}

/** 원과 원 사이의 거리예요. 겹치면 0이에요. */
export function circleGap(a: Circle, b: Circle): number {
  return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
}
