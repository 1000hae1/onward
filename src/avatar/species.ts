/**
 * 동물 다섯 종의 생김새 자료예요. 도형을 직접 만들지 않고 숫자만 적어 두면 kit.ts가 조립해요.
 * 머리 부품은 머리 중심, 꼬리는 엉덩이 관절을 기준으로 한 좌표예요. +z가 앞, +y가 위예요.
 */

export type Vec3 = readonly [number, number, number];

export interface BlobSpec {
  shape: "ball" | "pill" | "cone";
  color: string;
  at: Vec3;
  /** ball은 세 축의 반지름, pill은 [반지름, 길이, z축 납작함], cone은 [반지름, 높이, 쓰지 않음]이에요. */
  size: Vec3;
  tilt?: Vec3;
  /** 좌우 대칭으로 하나 더 놓아요. */
  mirror?: boolean;
  /** 눈이나 수염처럼 작은 부품이면 면을 더 적게 써요. */
  small?: boolean;
}

export type SpeciesId = "rabbit" | "bear" | "penguin" | "otter" | "deer";
export type Outfit = "patient" | "visitor";

export interface SpeciesSpec {
  id: SpeciesId;
  label: string;
  fur: string;
  /** 머리 구의 세 축 반지름이에요. */
  headSize: Vec3;
  /** 눈 자리예요. 머리 중심 기준이고 좌우로 대칭이에요. */
  eye: Vec3;
  head: readonly BlobSpec[];
  tail: readonly BlobSpec[];
  hand: { color: string; size: Vec3 };
  foot: { color: string; size: Vec3 };
}

const CHEEK = "#efb6a4";

const cheeks = (x: number, y: number, z: number): BlobSpec => ({
  shape: "ball",
  color: CHEEK,
  at: [x, y, z],
  size: [0.032, 0.02, 0.015],
  mirror: true,
  small: true,
});

export const SPECIES: readonly SpeciesSpec[] = [
  {
    id: "rabbit",
    label: "토끼",
    fur: "#ead9bf",
    headSize: [0.2, 0.19, 0.19],
    eye: [0.085, 0.025, 0.168],
    head: [
      // 왼쪽 귀는 곧게 서고, 오른쪽 귀는 중간에서 바깥으로 접혀요.
      { shape: "pill", color: "#ead9bf", at: [-0.085, 0.27, -0.01], size: [0.048, 0.2, 0.7], tilt: [0, 0, 0.1] },
      { shape: "pill", color: "#f0bfb0", at: [-0.085, 0.27, 0.016], size: [0.024, 0.17, 0.5], tilt: [0, 0, 0.1], small: true },
      { shape: "pill", color: "#ead9bf", at: [0.09, 0.22, -0.01], size: [0.048, 0.1, 0.7], tilt: [0, 0, -0.12] },
      { shape: "pill", color: "#ead9bf", at: [0.16, 0.315, -0.01], size: [0.046, 0.12, 0.7], tilt: [0, 0, -1.05] },
      { shape: "ball", color: "#f7eedd", at: [0, -0.055, 0.165], size: [0.07, 0.05, 0.04] },
      { shape: "ball", color: "#d98d80", at: [0, -0.032, 0.2], size: [0.018, 0.013, 0.01], small: true },
      cheeks(0.125, -0.035, 0.14),
    ],
    tail: [{ shape: "ball", color: "#f7eedd", at: [0, 0.03, -0.17], size: [0.06, 0.06, 0.06], small: true }],
    hand: { color: "#ead9bf", size: [0.058, 0.062, 0.058] },
    foot: { color: "#ead9bf", size: [0.07, 0.04, 0.115] },
  },
  {
    id: "bear",
    label: "곰",
    fur: "#8a6a52",
    headSize: [0.215, 0.19, 0.19],
    eye: [0.09, 0.03, 0.168],
    head: [
      { shape: "ball", color: "#8a6a52", at: [0.155, 0.145, -0.015], size: [0.066, 0.066, 0.04], mirror: true },
      { shape: "ball", color: "#c7a78b", at: [0.155, 0.143, 0.018], size: [0.038, 0.038, 0.012], mirror: true, small: true },
      { shape: "ball", color: "#d9c0a3", at: [0, -0.055, 0.155], size: [0.1, 0.07, 0.06] },
      { shape: "ball", color: "#3b2c25", at: [0, -0.024, 0.21], size: [0.03, 0.02, 0.014], small: true },
      cheeks(0.14, -0.03, 0.125),
    ],
    tail: [{ shape: "ball", color: "#8a6a52", at: [0, 0.02, -0.16], size: [0.045, 0.045, 0.04], small: true }],
    hand: { color: "#8a6a52", size: [0.065, 0.066, 0.065] },
    foot: { color: "#7a5c46", size: [0.078, 0.042, 0.11] },
  },
  {
    id: "penguin",
    label: "펭귄",
    fur: "#59626d",
    headSize: [0.195, 0.2, 0.19],
    eye: [0.065, -0.005, 0.183],
    head: [
      // 얼굴의 크림색 부분이에요. 머리보다 살짝 앞으로 나와요.
      { shape: "ball", color: "#f2ede0", at: [0, -0.035, 0.115], size: [0.135, 0.12, 0.085] },
      {
        shape: "cone",
        color: "#eda36a",
        at: [0, -0.05, 0.225],
        size: [0.04, 0.075, 0],
        tilt: [Math.PI / 2, 0, 0],
        small: true,
      },
      cheeks(0.098, -0.058, 0.165),
    ],
    tail: [{ shape: "cone", color: "#59626d", at: [0, 0, -0.17], size: [0.05, 0.09, 0], tilt: [-2, 0, 0], small: true }],
    // 손 대신 납작하고 긴 지느러미예요.
    hand: { color: "#59626d", size: [0.03, 0.095, 0.058] },
    foot: { color: "#eda36a", size: [0.082, 0.028, 0.12] },
  },
  {
    id: "otter",
    label: "수달",
    fur: "#7d5a41",
    headSize: [0.215, 0.17, 0.19],
    eye: [0.09, 0.03, 0.17],
    head: [
      { shape: "ball", color: "#7d5a41", at: [0.165, 0.085, -0.02], size: [0.042, 0.042, 0.03], mirror: true, small: true },
      { shape: "ball", color: "#ecdcc2", at: [0, -0.05, 0.13], size: [0.135, 0.085, 0.085] },
      { shape: "ball", color: "#33261f", at: [0, -0.012, 0.21], size: [0.03, 0.018, 0.013], small: true },
      {
        shape: "pill",
        color: "#4f3a2b",
        at: [0.135, -0.045, 0.175],
        size: [0.005, 0.075, 1],
        tilt: [0, 0, -1.35],
        mirror: true,
        small: true,
      },
    ],
    // 끝이 바닥 쪽으로 처지는 굵은 꼬리예요.
    tail: [{ shape: "pill", color: "#6f4f39", at: [0, -0.09, -0.24], size: [0.058, 0.2, 0.85], tilt: [-1.05, 0, 0] }],
    hand: { color: "#6f4f39", size: [0.058, 0.06, 0.058] },
    foot: { color: "#6f4f39", size: [0.078, 0.036, 0.115] },
  },
  {
    id: "deer",
    label: "사슴",
    fur: "#c49a6c",
    headSize: [0.19, 0.19, 0.185],
    eye: [0.085, 0.035, 0.162],
    head: [
      // 끝이 둥글고 짧은 뿔이에요.
      { shape: "pill", color: "#e0cda9", at: [0.085, 0.215, -0.02], size: [0.018, 0.1, 1], tilt: [0, 0, -0.28], mirror: true, small: true },
      { shape: "pill", color: "#e0cda9", at: [0.14, 0.255, -0.02], size: [0.015, 0.05, 1], tilt: [0, 0, -1.1], mirror: true, small: true },
      { shape: "ball", color: "#c49a6c", at: [0.205, 0.075, -0.02], size: [0.08, 0.036, 0.024], tilt: [0, 0, 0.38], mirror: true, small: true },
      { shape: "ball", color: "#efc2ab", at: [0.208, 0.074, -0.002], size: [0.052, 0.02, 0.01], tilt: [0, 0, 0.38], mirror: true, small: true },
      { shape: "ball", color: "#efe0c8", at: [0, -0.06, 0.15], size: [0.075, 0.06, 0.06] },
      { shape: "ball", color: "#4a372b", at: [0, -0.03, 0.203], size: [0.024, 0.016, 0.012], small: true },
      cheeks(0.12, -0.03, 0.135),
    ],
    tail: [{ shape: "ball", color: "#f4ead8", at: [0, 0.06, -0.165], size: [0.04, 0.055, 0.032], small: true }],
    hand: { color: "#b58b5f", size: [0.054, 0.06, 0.054] },
    foot: { color: "#a57d54", size: [0.062, 0.04, 0.1] },
  },
];

export interface AvatarChoice {
  species: SpeciesId;
  outfit: Outfit;
}

export const DEFAULT_CHOICE: AvatarChoice = { species: "rabbit", outfit: "patient" };

export function speciesById(id: SpeciesId): SpeciesSpec {
  return SPECIES.find((spec) => spec.id === id) ?? SPECIES[0];
}

/** 저장해 둔 선택을 읽어요. 형식이 맞지 않으면 없는 것으로 봐요. */
export function parseAvatarChoice(raw: string | null): AvatarChoice | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { species, outfit } = value as { species?: unknown; outfit?: unknown };
  const spec = SPECIES.find((candidate) => candidate.id === species);
  if (!spec || (outfit !== "patient" && outfit !== "visitor")) return null;
  return { species: spec.id, outfit };
}
