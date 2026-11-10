import { CapsuleGeometry, MeshLambertMaterial, SphereGeometry } from "three";
import { addLanternShading } from "../avatar/lantern-shading";
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

/** 몸 비율이에요. 병동 고양이는 통통하고 둥근 몸에 다리가 짧아요. */
export interface CatBuild {
  /** 몸통 관절의 높이예요. 네 다리와 머리가 이 몸통에 붙어요. */
  bodyY: number;
  bodySize: Vec3;
  headAt: Vec3;
  /** 머리를 기본 크기보다 이만큼 키워요. 귀와 주둥이, 눈도 함께 커져요. */
  headScale: number;
  legX: number;
  legFrontZ: number;
  legBackZ: number;
  /** 다리가 몸통에 붙는 높이예요. 몸통 관절 기준이에요. */
  legJointY: number;
  legRadius: number;
  legLength: number;
  /** 다리 관절 기준의 다리 가운데와 발 높이예요. */
  legCenterY: number;
  pawY: number;
  pawSize: Vec3;
  tailAt: Vec3;
  /** 앉거나 웅크릴 때 몸을 낮추고 기울이는 정도예요. 배가 바닥에 닿는 통통한 몸은 덜 낮춰요. */
  lowerScale: number;
  pitchScale: number;
}

const HEAD_RADIUS = 0.086;
const EYE_AT: Vec3 = [0, 0.012, 0.075];

export const CAT_BUILDS: Record<CatCoat, CatBuild> = {
  // 둥글고 통통한 뚱냥이예요. 배가 바닥 가까이 내려오고, 짧은 다리가 배 밑으로 살짝 보여요.
  ward: {
    bodyY: 0.165,
    bodySize: [0.15, 0.135, 0.19],
    headAt: [0, 0.085, 0.18],
    headScale: 1.08,
    legX: 0.085,
    legFrontZ: 0.11,
    legBackZ: -0.11,
    legJointY: -0.08,
    legRadius: 0.03,
    legLength: 0.025,
    legCenterY: -0.035,
    pawY: -0.065,
    pawSize: [0.033, 0.02, 0.04],
    tailAt: [0, 0.12, -0.225],
    lowerScale: 0.3,
    pitchScale: 0.6,
  },
  companion: {
    bodyY: 0.17,
    bodySize: [0.078, 0.08, 0.155],
    headAt: [0, 0.055, 0.135],
    headScale: 1,
    legX: 0.05,
    legFrontZ: 0.095,
    legBackZ: -0.095,
    legJointY: -0.01,
    legRadius: 0.024,
    legLength: 0.085,
    legCenterY: -0.06,
    pawY: -0.118,
    pawSize: [0.027, 0.018, 0.034],
    tailAt: [0, 0.085, -0.185],
    lowerScale: 1,
    pitchScale: 1,
  },
};

/** 눈 관절의 자리예요. 머리 관절 기준이고 머리 크기를 따라가요. */
export function catEyeAt(coat: CatCoat): Vec3 {
  const scale = CAT_BUILDS[coat].headScale;
  return [EYE_AT[0] * scale, EYE_AT[1] * scale, EYE_AT[2] * scale];
}

/** 몸통 관절에서 코끝까지 앞으로 나온 거리예요. 코를 맞댈 때 두 고양이 사이를 정해요. */
export function catNoseReach(coat: CatCoat): number {
  const build = CAT_BUILDS[coat];
  return build.headAt[2] + (HEAD_RADIUS + 0.014) * build.headScale;
}

const WARD_FUR = "#f0dcbc";
const WARD_STRIPE = "#d9a066";
const GREY_FUR = "#7f8791";
const WHITE = "#f7f4ee";

/** 등을 가로지르는 줄무늬예요. y는 그 자리의 등 높이예요. */
const stripe = (y: number, z: number, width: number): BlobSpec => ({
  shape: "ball",
  color: WARD_STRIPE,
  at: [0, y, z],
  size: [width, 0.026, 0.024],
  small: true,
});

export const CAT_COATS: Record<CatCoat, CoatSpec> = {
  // 병동 고양이예요. 크림색 둥근 몸에 등을 가로지르는 줄무늬가 있고 목에 방울을 달았어요.
  ward: {
    fur: WARD_FUR,
    light: "#fbf3e4",
    paw: WARD_FUR,
    body: [
      stripe(0.116, -0.09, 0.11),
      stripe(0.132, 0.005, 0.13),
      { shape: "ball", color: "#c9685c", at: [0, 0.085, 0.16], size: [0.085, 0.018, 0.065], tilt: [1.05, 0, 0], small: true },
      { shape: "ball", color: "#f2c94c", at: [0, 0.04, 0.196], size: [0.021, 0.021, 0.021], small: true },
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


export interface CatKit {
  body: BufferGeometry;
  head: BufferGeometry;
  eyes: BufferGeometry;
  /** 다리 네 개가 함께 써요. */
  leg: BufferGeometry;
}

function buildBody(coat: CoatSpec, build: CatBuild): BufferGeometry {
  const tail: BlobSpec[] = [
    { shape: "pill", color: coat.fur, at: build.tailAt, size: [0.019, 0.17, 1], tilt: [-0.5, 0, 0], small: true },
  ];
  return merged([
    place(paint(new SphereGeometry(1, 8, 5), coat.fur), [0, 0, 0], [0, 0, 0], build.bodySize),
    ...blobs(coat.body),
    ...blobs(tail),
  ]);
}

function buildHead(coat: CoatSpec, scale: number): BufferGeometry {
  const parts: BlobSpec[] = [
    { shape: "cone", color: coat.fur, at: [0.056, 0.079, -0.006], size: [0.033, 0.058, 0], tilt: [0, 0, -0.26], mirror: true, small: true },
    { shape: "ball", color: coat.light, at: [0, -0.024, 0.066], size: [0.044, 0.03, 0.026], small: true },
    { shape: "ball", color: "#d98d80", at: [0, -0.011, 0.09], size: [0.009, 0.007, 0.005], small: true },
    ...coat.head,
  ];
  return merged([
    place(paint(new SphereGeometry(1, 8, 6), coat.fur), [0, 0, 0], [0, 0, 0], [HEAD_RADIUS, HEAD_RADIUS * 0.92, HEAD_RADIUS * 0.95]),
    ...blobs(parts),
  ]).scale(scale, scale, scale);
}

/** 눈은 따로 그려서 천천히 깜빡일 수 있게 해요. 기준점이 눈 높이라 위아래로 고르게 감겨요. */
function buildEyes(scale: number): BufferGeometry {
  const eye = (x: number): BufferGeometry =>
    place(paint(new SphereGeometry(1, 5, 3), "#2c2a28"), [x, 0, 0], [0, 0, 0], [0.012, 0.015, 0.008]);
  return merged([eye(0.037), eye(-0.037)]).scale(scale, scale, scale);
}

function buildLeg(coat: CoatSpec, build: CatBuild): BufferGeometry {
  return merged([
    place(paint(new CapsuleGeometry(build.legRadius, build.legLength, 1, 5), coat.fur), [0, build.legCenterY, 0]),
    place(paint(new SphereGeometry(1, 4, 2), coat.paw), [0, build.pawY, 0.008], [0, 0, 0], build.pawSize),
  ]);
}

const kits = new Map<CatCoat, CatKit>();

export function getCatKit(coat: CatCoat): CatKit {
  const existing = kits.get(coat);
  if (existing) return existing;
  const spec = CAT_COATS[coat];
  const build = CAT_BUILDS[coat];
  const kit: CatKit = {
    body: buildBody(spec, build),
    head: buildHead(spec, build.headScale),
    eyes: buildEyes(build.headScale),
    leg: buildLeg(spec, build),
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
    addLanternShading(material);
  }
  return material;
}
