import { mirroredPatches } from "./egg";
import type { PatchSpec, SurfaceBlob, SurfaceSpot } from "./egg";

/**
 * 동물 다섯 종의 생김새 자료예요. 도형을 직접 만들지 않고 숫자만 적어 두면 kit.ts가 조립해요.
 * 모두 같은 달걀 몸을 쓰고, 부품은 달걀 표면의 자리 [θ, φ]로 적어요. θ는 바닥 0에서 꼭대기 π,
 * φ는 정면 0에서 왼쪽으로 도는 각도라 뒤쪽은 π예요.
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
  /** 몸 색이에요. 채도를 낮춘 파스텔이고, 고양이 털색과는 멀리 떨어뜨려요. */
  fur: string;
  /** 배 무늬 색이에요. */
  belly: string;
  /** 눈 자리예요. 좌우로 대칭이에요. */
  eye: SurfaceSpot;
  /** 얼굴 무늬 위에 눈을 얹을 때 띄우는 거리예요. */
  eyeLift?: number;
  /** 귀, 주둥이, 코, 꼬리처럼 동물마다 다른 부품이에요. */
  parts: readonly SurfaceBlob[];
  /** 얼굴이나 등에 붙는 무늬예요. 배 무늬는 모두 같아서 kit.ts가 붙여요. */
  patches: readonly PatchSpec[];
  /** 팔 뭉치 끝에 보이는 손이에요. */
  hand: { color: string; size: Vec3 };
  /** 바닥에 납작하게 놓인 발이에요. */
  foot: { color: string; size: Vec3 };
}

const CHEEK = "#e9b3aa";
const MOUTH = "#6b5550";
const BACK = Math.PI;
/** 코와 입이 놓이는 높이예요. 눈은 이보다 조금 위에 떨어뜨려 놓아요. */
const NOSE_THETA = 2.2;
const MOUTH_THETA = 2.12;
const EYE: SurfaceSpot = [2.36, 0.42];

/** 발그레한 볼이에요. 표면을 따라 붙는 납작한 타원이에요. */
const cheeks = (phi = 0.8, lift?: number): PatchSpec[] =>
  mirroredPatches({ at: [2.22, phi], radius: [0.055, 0.12], color: CHEEK, bulge: 0.002, lift, rings: 1, segments: 10 });

/** 작게 다문 입이에요. lift는 주둥이가 있으면 그 위로 올려요. */
const mouth = (lift: number, theta = MOUTH_THETA): SurfaceBlob => ({
  shape: "pill",
  color: MOUTH,
  on: [theta, 0],
  size: [0.0045, 0.018, 0.6],
  tilt: [0, 0, Math.PI / 2],
  lift,
  small: true,
});

/** 엉덩이에 붙는 꼬리예요. 환자복 위로 보이도록 옷 둘레에 붙여요. */
const OVER_CLOTHES = 1.05;

export const SPECIES: readonly SpeciesSpec[] = [
  {
    id: "rabbit",
    label: "토끼",
    fur: "#d9c8de",
    belly: "#f8f0e6",
    eye: EYE,
    parts: [
      // 짧고 통통한 귀예요. 왼쪽은 곧게 서고, 오른쪽은 앞으로 살짝 숙여요.
      { shape: "pill", color: "#d9c8de", on: [2.72, 0.62], size: [0.04, 0.09, 0.62], align: "out", tilt: [0, 0, -0.12] },
      { shape: "pill", color: "#ebbdbe", on: [2.72, 0.62], size: [0.022, 0.075, 0.5], align: "out", tilt: [0, 0, -0.12], offset: [0, 0.004, 0.014], small: true },
      { shape: "pill", color: "#d9c8de", on: [2.72, -0.62], size: [0.04, 0.075, 0.62], align: "out", tilt: [0.55, 0, 0.3] },
      { shape: "pill", color: "#ebbdbe", on: [2.72, -0.62], size: [0.022, 0.06, 0.5], align: "out", tilt: [0.55, 0, 0.3], offset: [0, 0.004, 0.014], small: true },
      { shape: "ball", color: "#c98f93", on: [NOSE_THETA, 0], size: [0.016, 0.012, 0.009], small: true },
      mouth(0.002),
      { shape: "ball", color: "#f8f0e6", on: [1.0, BACK], size: [0.05, 0.05, 0.05], align: "out", shell: OVER_CLOTHES, lift: -0.02 },
    ],
    patches: cheeks(),
    hand: { color: "#d9c8de", size: [0.036, 0.032, 0.036] },
    foot: { color: "#d9c8de", size: [0.058, 0.024, 0.082] },
  },
  {
    id: "bear",
    label: "곰",
    fur: "#c29a80",
    belly: "#f3e6d6",
    eye: EYE,
    parts: [
      // 머리 위의 작은 반원 귀예요.
      { shape: "ball", color: "#c29a80", on: [2.62, 0.88], size: [0.048, 0.042, 0.026], align: "out", lift: -0.012, mirror: true },
      { shape: "ball", color: "#dfc1aa", on: [2.62, 0.88], size: [0.028, 0.024, 0.01], align: "out", lift: -0.012, offset: [0, 0, 0.018], mirror: true, small: true },
      { shape: "ball", color: "#ebd8c5", on: [2.17, 0], size: [0.07, 0.05, 0.032], lift: -0.006 },
      { shape: "ball", color: "#5a4238", on: [2.24, 0], size: [0.022, 0.015, 0.011], lift: 0.022, small: true },
      mouth(0.024, 2.13),
      { shape: "ball", color: "#c29a80", on: [1.0, BACK], size: [0.036, 0.036, 0.032], align: "out", shell: OVER_CLOTHES, lift: -0.014, small: true },
    ],
    patches: cheeks(),
    hand: { color: "#b38a70", size: [0.038, 0.034, 0.038] },
    foot: { color: "#b38a70", size: [0.062, 0.025, 0.084] },
  },
  {
    id: "penguin",
    label: "펭귄",
    fur: "#5a6a8e",
    belly: "#f6f0e4",
    eye: [2.38, 0.36],
    eyeLift: 0.008,
    parts: [
      // 얼굴 무늬 위로 뾰족 나온 부리예요.
      { shape: "cone", color: "#e8b77a", on: [2.2, 0], size: [0.03, 0.055, 0], align: "out", lift: 0.002 },
      { shape: "cone", color: "#5a6a8e", on: [0.95, BACK], size: [0.045, 0.07, 0], align: "out", tilt: [0.35, 0, 0], shell: OVER_CLOTHES, lift: -0.012, small: true },
    ],
    // 눈과 부리를 둘러싼 크림색 얼굴이에요.
    patches: [{ at: [2.3, 0], radius: [0.3, 0.92], color: "#f6f0e4", bulge: 0.004 }, ...cheeks(0.68, 0.008)],
    // 손 대신 납작한 지느러미예요.
    hand: { color: "#5a6a8e", size: [0.024, 0.062, 0.042] },
    foot: { color: "#e8b77a", size: [0.066, 0.022, 0.09] },
  },
  {
    id: "otter",
    label: "수달",
    fur: "#9a7f69",
    belly: "#efe2cf",
    eye: EYE,
    parts: [
      { shape: "ball", color: "#9a7f69", on: [2.5, 1.18], size: [0.028, 0.024, 0.018], align: "out", lift: -0.008, mirror: true, small: true },
      { shape: "ball", color: "#ebdecb", on: [2.15, 0], size: [0.085, 0.05, 0.03], lift: -0.006 },
      { shape: "ball", color: "#4d3d33", on: [2.22, 0], size: [0.024, 0.015, 0.011], lift: 0.02, small: true },
      mouth(0.022, 2.12),
      { shape: "pill", color: "#6e5a4b", on: [2.15, 0.36], size: [0.0035, 0.06, 1], tilt: [0, 0, -1.4], lift: 0.012, mirror: true, small: true },
      // 바닥 쪽으로 늘어진 굵은 꼬리예요.
      { shape: "pill", color: "#8a705b", on: [0.75, BACK], size: [0.058, 0.13, 0.62], align: "out", tilt: [0.45, 0, 0], shell: OVER_CLOTHES, lift: -0.025 },
    ],
    patches: [],
    hand: { color: "#8a705b", size: [0.036, 0.032, 0.036] },
    foot: { color: "#8a705b", size: [0.062, 0.024, 0.086] },
  },
  {
    id: "deer",
    label: "사슴",
    fur: "#d6b38c",
    belly: "#f7ecdb",
    eye: EYE,
    parts: [
      // 끝이 둥글고 짧은 뿔이에요.
      { shape: "pill", color: "#ecdcc0", on: [2.9, 0.75], size: [0.017, 0.06, 1], align: "out", tilt: [0, 0, -0.32], lift: -0.006, mirror: true, small: true },
      // 옆으로 뻗은 귀예요.
      { shape: "ball", color: "#d6b38c", on: [2.5, 1.3], size: [0.026, 0.06, 0.016], align: "out", tilt: [0, 0, -0.55], lift: -0.012, mirror: true },
      { shape: "ball", color: "#efc9b6", on: [2.5, 1.3], size: [0.015, 0.042, 0.006], align: "out", tilt: [0, 0, -0.55], offset: [0, 0, 0.012], lift: -0.012, mirror: true, small: true },
      { shape: "ball", color: "#f1e2cc", on: [2.17, 0], size: [0.058, 0.042, 0.026], lift: -0.006 },
      { shape: "ball", color: "#5c4536", on: [2.23, 0], size: [0.02, 0.014, 0.01], lift: 0.016, small: true },
      mouth(0.018, 2.12),
      { shape: "ball", color: "#f7ecdb", on: [1.0, BACK], size: [0.032, 0.042, 0.028], align: "out", shell: OVER_CLOTHES, lift: -0.012, small: true },
    ],
    // 등의 작은 크림색 점이에요.
    patches: [
      ...cheeks(),
      { at: [2.12, BACK], radius: [0.07, 0.13], color: "#f7ecdb", bulge: 0.002, small: true },
      { at: [2.32, BACK + 0.38], radius: [0.06, 0.12], color: "#f7ecdb", bulge: 0.002, small: true },
      { at: [2.32, BACK - 0.38], radius: [0.06, 0.12], color: "#f7ecdb", bulge: 0.002, small: true },
    ],
    hand: { color: "#c4a07a", size: [0.034, 0.032, 0.034] },
    foot: { color: "#a88664", size: [0.056, 0.024, 0.08] },
  },
];

export interface AvatarChoice {
  species: SpeciesId;
  outfit: Outfit;
}

export function speciesById(id: SpeciesId): SpeciesSpec {
  return SPECIES.find((spec) => spec.id === id) ?? SPECIES[0];
}
