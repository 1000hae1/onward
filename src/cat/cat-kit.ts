import { CapsuleGeometry, MeshLambertMaterial, SphereGeometry } from "three";
import { addRimGlow } from "../avatar/rim-glow";
import type { BufferGeometry } from "three";
import { blobs, merged, paint, place } from "../avatar/shapes.ts";
import type { BlobSpec, Vec3 } from "../avatar/species";

/**
 * 고양이 부품을 무늬별로 한 번만 만들어요. 재질은 모두 하나를 함께 써요.
 * 아바타와 달리 옷 없이 네 발로 걷는 작은 모양이고, 몸 높이가 아바타 허리쯤이에요.
 */

export type CatCoat = "ward" | "companion";

export interface CoatSpec {
  fur: string;
  /** 주둥이와 가슴처럼 밝은 곳이에요. */
  light: string;
  /** 발 끝 색이에요. */
  paw: string;
  /** 무늬와 목에 두른 것이에요. */
  body: readonly BlobSpec[];
  head: readonly BlobSpec[];
}

/** 몸통 관절의 높이예요. 네 다리와 머리가 이 몸통에 붙어요. */
export const CAT_BODY_Y = 0.17;
export const CAT_HEAD_AT: Vec3 = [0, 0.055, 0.135];
export const CAT_EYE_AT: Vec3 = [0, 0.012, 0.075];
export const CAT_LEG_X = 0.05;
export const CAT_LEG_FRONT_Z = 0.095;
export const CAT_LEG_BACK_Z = -0.095;
/** 머리에서 코끝까지의 거리예요. 코를 맞댈 때 두 고양이 사이를 정해요. */
export const CAT_NOSE_REACH = 0.235;

const WARD_FUR = "#f0dcbc";
const WARD_STRIPE = "#d9a066";
const GREY_FUR = "#7f8791";
const WHITE = "#f7f4ee";

const stripe = (z: number, width: number): BlobSpec => ({
  shape: "ball",
  color: WARD_STRIPE,
  at: [0, 0.066, z],
  size: [width, 0.024, 0.02],
  small: true,
});

export const CAT_COATS: Record<CatCoat, CoatSpec> = {
  // 병동 고양이예요. 크림색 몸에 등을 가로지르는 줄무늬가 있고 목에 방울을 달았어요.
  ward: {
    fur: WARD_FUR,
    light: "#fbf3e4",
    paw: WARD_FUR,
    body: [
      stripe(-0.075, 0.054),
      stripe(0.02, 0.054),
      { shape: "ball", color: "#c9685c", at: [0, 0.052, 0.112], size: [0.05, 0.014, 0.05], tilt: [1.05, 0, 0], small: true },
      { shape: "ball", color: "#f2c94c", at: [0, 0.018, 0.158], size: [0.018, 0.018, 0.018], small: true },
    ],
    head: [],
  },
  // 데리고 다니는 고양이예요. 회색 몸에 흰 가슴과 흰 발, 방울 대신 작은 목도리예요.
  companion: {
    fur: GREY_FUR,
    light: WHITE,
    paw: WHITE,
    body: [
      { shape: "ball", color: WHITE, at: [0, -0.012, 0.09], size: [0.05, 0.05, 0.05], small: true },
      { shape: "ball", color: "#d9707a", at: [0, 0.05, 0.112], size: [0.058, 0.022, 0.056], tilt: [1.05, 0, 0], small: true },
      { shape: "pill", color: "#d9707a", at: [0.03, 0.0, 0.158], size: [0.014, 0.04, 0.6], small: true },
    ],
    head: [],
  },
};

const BODY_SIZE: Vec3 = [0.078, 0.08, 0.155];
const HEAD_RADIUS = 0.086;
const LEG_RADIUS = 0.024;
const LEG_LENGTH = 0.085;
const LEG_CENTER_Y = -0.06;
const PAW_Y = -0.118;

export interface CatKit {
  body: BufferGeometry;
  head: BufferGeometry;
  eyes: BufferGeometry;
  /** 다리 네 개가 함께 써요. */
  leg: BufferGeometry;
}

function buildBody(coat: CoatSpec): BufferGeometry {
  const tail: BlobSpec[] = [
    { shape: "pill", color: coat.fur, at: [0, 0.085, -0.185], size: [0.019, 0.17, 1], tilt: [-0.5, 0, 0], small: true },
  ];
  return merged([
    place(paint(new SphereGeometry(1, 8, 5), coat.fur), [0, 0, 0], [0, 0, 0], BODY_SIZE),
    ...blobs(coat.body),
    ...blobs(tail),
  ]);
}

function buildHead(coat: CoatSpec): BufferGeometry {
  const parts: BlobSpec[] = [
    { shape: "cone", color: coat.fur, at: [0.056, 0.079, -0.006], size: [0.033, 0.058, 0], tilt: [0, 0, -0.26], mirror: true, small: true },
    { shape: "ball", color: coat.light, at: [0, -0.024, 0.066], size: [0.044, 0.03, 0.026], small: true },
    { shape: "ball", color: "#d98d80", at: [0, -0.011, 0.09], size: [0.009, 0.007, 0.005], small: true },
    ...coat.head,
  ];
  return merged([
    place(paint(new SphereGeometry(1, 8, 6), coat.fur), [0, 0, 0], [0, 0, 0], [HEAD_RADIUS, HEAD_RADIUS * 0.92, HEAD_RADIUS * 0.95]),
    ...blobs(parts),
  ]);
}

/** 눈은 따로 그려서 천천히 깜빡일 수 있게 해요. 기준점이 눈 높이라 위아래로 고르게 감겨요. */
function buildEyes(): BufferGeometry {
  const eye = (x: number): BufferGeometry =>
    place(paint(new SphereGeometry(1, 5, 3), "#2c2a28"), [x, 0, 0], [0, 0, 0], [0.012, 0.015, 0.008]);
  return merged([eye(0.037), eye(-0.037)]);
}

function buildLeg(coat: CoatSpec): BufferGeometry {
  return merged([
    place(paint(new CapsuleGeometry(LEG_RADIUS, LEG_LENGTH, 1, 5), coat.fur), [0, LEG_CENTER_Y, 0]),
    place(paint(new SphereGeometry(1, 4, 2), coat.paw), [0, PAW_Y, 0.008], [0, 0, 0], [0.027, 0.018, 0.034]),
  ]);
}

const kits = new Map<CatCoat, CatKit>();

export function getCatKit(coat: CatCoat): CatKit {
  const existing = kits.get(coat);
  if (existing) return existing;
  const spec = CAT_COATS[coat];
  const kit: CatKit = {
    body: buildBody(spec),
    head: buildHead(spec),
    eyes: buildEyes(),
    leg: buildLeg(spec),
  };
  kits.set(coat, kit);
  return kit;
}

export function catTriangles(kit: CatKit): number {
  const count = (geometry: BufferGeometry): number =>
    (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
  return count(kit.body) + count(kit.head) + count(kit.eyes) + count(kit.leg) * 4;
}

let material: MeshLambertMaterial | null = null;

export function getCatMaterial(): MeshLambertMaterial {
  if (!material) {
    material = new MeshLambertMaterial({ vertexColors: true, emissive: "#14120f" });
    addRimGlow(material);
  }
  return material;
}
