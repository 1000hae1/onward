import { MeshStandardMaterial, SphereGeometry } from "three";
import type { BufferGeometry } from "three";
import {
  EGG_BASE_Y,
  EGG_HEIGHT,
  eggBand,
  eggPatch,
  eggRadius,
  eggSheet,
  eggThetaAt,
  eggY,
  mirroredPatches,
  surfaceBlobs,
} from "./egg.ts";
import type { SurfaceBlob } from "./egg.ts";
import { addLanternShading } from "./lantern-shading";
import { blobs, merged, paint, place } from "./shapes.ts";
import type { BlobSpec, Outfit, SpeciesSpec } from "./species";

/**
 * 아바타 부품을 동물과 옷차림별로 한 번만 만들어 재사용해요. 재질은 모두가 하나를 함께 써요.
 * 머리와 몸이 하나인 달걀이라 메시는 몸, 팔 뭉치 둘, 발 둘로 아바타 한 명이 5번만 그려져요.
 * 환자복 껍질은 동물과 상관없이 한 번 만들어 두고 복사해서 써요. 문병객은 옷 없이 털과 꽃다발만 있어요.
 */

export interface AvatarKit {
  /** 머리까지 이어진 몸통과 옷, 얼굴, 귀와 꼬리예요. */
  body: BufferGeometry;
  /** 양팔이 함께 써요. 오른팔은 거울처럼 뒤집어 그려요. */
  arm: BufferGeometry;
  /** 문병객의 오른팔이에요. 꽃다발을 들고 있어요. 환자는 arm과 같아요. */
  armRight: BufferGeometry;
  /** 양발이 함께 써요. */
  foot: BufferGeometry;
}

/** 잠들었을 때만 얹는 부품이에요. 깨어 있을 때는 그리지 않아서 평소 그리는 횟수는 그대로예요. */
export interface SleepKit {
  /** 눈 위에 덮는 눈꺼풀과 감은 눈 선이에요. 몸과 함께 숨쉬도록 몸 쪽에 붙여요. */
  lids: BufferGeometry;
  /** 어깨까지 덮는 이불이에요. 누운 몸과 함께 기울어요. */
  blanket: BufferGeometry;
}

/** 아바타의 키예요. 이름표는 이 높이 위에 떠요. */
export const AVATAR_HEIGHT = EGG_BASE_Y + EGG_HEIGHT;
/** 얼굴 가운데 높이예요. 이름표와 날아오는 빛이 이 점을 기준으로 해요. */
export const HEAD_CENTER_Y = eggY(2.3);
/** 팔 뭉치가 붙는 높이예요. 몸 가운데를 축으로 돌아서 몸을 따라 앞뒤로 움직여요. */
export const ARM_Y = 0.31;
/** 몸 가운데에서 팔 뭉치 가운데까지의 거리예요. 뭉치 절반이 옷에 묻혀요. */
export const ARM_REACH = eggRadius(eggThetaAt(ARM_Y)) * 1.02;
/** 팔 뭉치의 반폭이에요. 두 손을 모을 때 맞닿는 거리를 정해요. */
export const ARM_HALF_WIDTH = 0.05;
export const FOOT_X = 0.095;
/** 손에 든 빛이 떠나는 자리예요. 몸 앞 가슴 높이예요. */
export const HAND_HEIGHT = ARM_Y + 0.04;
export const HAND_REACH = ARM_REACH;

/** 옷이 몸보다 큰 비율이에요. 단 끝이 살짝 도드라져요. */
const CLOTHES_SHELL = 1.045;
/** 옷이 덮는 꼭대기예요. 몸 높이의 아래 2/3쯤이에요. */
const CLOTHES_TOP = 1.82;
/** 털이 시작되는 자리예요. 브이넥 안쪽으로 보이도록 V 끝보다 조금 아래에서 시작해요. */
const FUR_START = 1.5;
const FUR_THETAS = [FUR_START, 1.76, 2.1, 2.45, 2.75, 2.98, Math.PI];

const PAJAMA = "#a9d8f2";
const PAJAMA_COLLAR = "#86c2e6";
/** 브이넥이 가장 깊이 파인 정면의 θ예요. */
const V_NECK_TIP = 1.56;
/** 정면에서 V가 벌어지는 φ 폭이에요. 이 밖은 둥근 목둘레예요. */
const V_NECK_HALF_WIDTH = 0.75;
const BUTTON_COLOR = "#fbfaf6";
const EYE_COLOR = "#2c2a28";

/** φ 자리의 목둘레 높이예요. 정면에서 V자로 내려가요. */
function neckline(phi: number): number {
  const v = Math.max(0, 1 - Math.abs(phi) / V_NECK_HALF_WIDTH);
  return CLOTHES_TOP - (CLOTHES_TOP - V_NECK_TIP) * v;
}

/** 줄무늬 없는 하늘색 환자복이에요. 브이넥을 따라 조금 진한 하늘색 옷깃이 둘러요. */
function buildPajama(): BufferGeometry[] {
  return [
    eggSheet((phi) => [0, 0.5, 1.0, 1.4, neckline(phi)], Array(5).fill(CLOTHES_SHELL), PAJAMA),
    eggSheet((phi) => {
      const top = neckline(phi);
      return [top, top + 0.06, top + 0.13];
    }, [CLOTHES_SHELL, 1.065, 1.004], PAJAMA_COLLAR),
  ];
}

const PAJAMA_DETAILS: readonly SurfaceBlob[] = [
  { shape: "ball", color: BUTTON_COLOR, on: [1.12, 0], size: [0.012, 0.012, 0.006], shell: CLOTHES_SHELL, lift: 0.002, small: true },
  { shape: "ball", color: BUTTON_COLOR, on: [1.38, 0], size: [0.012, 0.012, 0.006], shell: CLOTHES_SHELL, lift: 0.002, small: true },
];

/** 환자복이에요. 문병객은 옷을 입지 않아서 동물마다 털로 아랫몸을 채워요(buildBareBody). */
function buildClothes(): BufferGeometry {
  return merged([...buildPajama(), ...surfaceBlobs(PAJAMA_DETAILS)]);
}

/** 옷 없이 드러난 아랫몸의 털이에요. 털이 시작되는 자리까지 몸 색으로 이어요. */
function buildBareBody(spec: SpeciesSpec): BufferGeometry {
  return eggBand([0, 0.5, 1.0, FUR_START], 1, spec.fur);
}

/** 옷 위로 보이는 털과 얼굴이에요. 배 무늬는 아랫부분이 옷에 가려 윗부분만 살짝 보여요. */
function buildFace(spec: SpeciesSpec): BufferGeometry {
  // 눈은 표면을 따라 붙인 작은 까만 점이에요. 공보다 면이 적고 가장자리가 둥글어요.
  const eyes = mirroredPatches({
    at: spec.eye,
    radius: [0.08, 0.115],
    color: EYE_COLOR,
    bulge: 0.004,
    lift: spec.eyeLift ?? 0.002,
    rings: 1,
    segments: 12,
  });
  return merged([
    eggBand(FUR_THETAS, 1, spec.fur),
    eggPatch({ at: [1.92, 0], radius: [0.3, 0.8], color: spec.belly, bulge: 0.003, rings: 2, segments: 14 }),
    ...[...spec.patches, ...eyes].map(eggPatch),
    ...surfaceBlobs(spec.parts),
  ]);
}

function buildArm(spec: SpeciesSpec, outfit: Outfit): BufferGeometry {
  // 몸에 기대어 위쪽이 살짝 안으로 기운 작은 뭉치예요. 왼팔(-x) 기준이에요.
  const sleeve = place(
    paint(new SphereGeometry(1, 8, 5), outfit === "patient" ? PAJAMA : spec.fur),
    [0, 0, 0],
    [0, 0, -0.3],
    [ARM_HALF_WIDTH, 0.068, 0.058],
  );
  const hand = place(paint(new SphereGeometry(1, 6, 4), spec.hand.color), [-0.018, -0.052, 0.008], [0, 0, -0.3], spec.hand.size);
  return merged([sleeve, hand]);
}

function buildFoot(spec: SpeciesSpec): BufferGeometry {
  return merged([
    place(paint(new SphereGeometry(1, 8, 5), spec.foot.color), [0, spec.foot.size[1], 0.07], [0, 0, 0], spec.foot.size),
  ]);
}

/** 작은 꽃다발이에요. 팔은 몸을 따라 돌기만 해서 꽃다발이 언제나 곧게 서요. */
function bouquet(): BufferGeometry[] {
  const wrap: BlobSpec[] = [
    { shape: "cone", color: "#f3e6d0", at: [0, 0.07, 0.035], size: [0.04, 0.12, 0], tilt: [Math.PI, 0, 0], small: true },
    { shape: "ball", color: "#9cbf9f", at: [0.032, 0.14, 0.025], size: [0.026, 0.02, 0.026], small: true },
    { shape: "ball", color: "#f2b3bd", at: [0, 0.16, 0.05], size: [0.032, 0.029, 0.032], small: true },
    { shape: "ball", color: "#f2d98e", at: [0.027, 0.15, 0.048], size: [0.024, 0.022, 0.024], small: true },
    { shape: "ball", color: "#e99aa3", at: [-0.025, 0.152, 0.025], size: [0.026, 0.024, 0.026], small: true },
  ];
  return blobs(wrap);
}

const BLANKET = "#f3ead9";
const BLANKET_FOLD = "#fbf7ef";
/** 이불이 몸보다 큰 비율이에요. 팔 뭉치까지 덮어요. */
const BLANKET_SHELL = 1.2;
/** 이불이 덮는 꼭대기예요. 어깨 높이라 얼굴은 보여요. */
const BLANKET_TOP = 1.72;

/** 눈이 놓인 무늬의 색이에요. 무늬 위에 눈이 있으면 그 색, 아니면 털색이에요. */
function lidColor(spec: SpeciesSpec): string {
  const [theta, phi] = spec.eye;
  const under = spec.patches.filter(
    (patch) => Math.abs(theta - patch.at[0]) < patch.radius[0] && Math.abs(Math.abs(phi) - Math.abs(patch.at[1])) < patch.radius[1],
  );
  return under.at(-1)?.color ?? spec.fur;
}

function buildLids(spec: SpeciesSpec): BufferGeometry {
  const lift = spec.eyeLift ?? 0.002;
  // 눈을 털색으로 덮고, 그 위에 아래로 살짝 처진 가는 선을 그어 감은 눈을 그려요.
  const lids = mirroredPatches({ at: spec.eye, radius: [0.09, 0.125], color: lidColor(spec), bulge: 0.004, lift: lift + 0.0015, rings: 1, segments: 12 });
  const lines = mirroredPatches({ at: [spec.eye[0] - 0.03, spec.eye[1]], radius: [0.016, 0.1], color: EYE_COLOR, bulge: 0.002, lift: lift + 0.004, rings: 1, segments: 10 });
  return merged([...lids, ...lines].map(eggPatch));
}

function buildBlanket(): BufferGeometry {
  return merged([
    eggBand([0, 0.6, 1.2, BLANKET_TOP - 0.06], BLANKET_SHELL, BLANKET),
    // 이불 끝을 한 번 접은 자리예요. 조금 더 도톰하고 밝아요.
    eggBand([BLANKET_TOP - 0.08, BLANKET_TOP - 0.02, BLANKET_TOP], [BLANKET_SHELL + 0.03, BLANKET_SHELL + 0.035, 1.02], BLANKET_FOLD),
  ]);
}

const sleepKits = new Map<string, SleepKit>();
let sharedBlanket: BufferGeometry | null = null;

/** 동물마다 한 번만 만들어요. 이불은 모두 같아요. */
export function getSleepKit(spec: SpeciesSpec): SleepKit {
  return cached(sleepKits, spec.id, () => {
    sharedBlanket ??= buildBlanket();
    return { lids: buildLids(spec), blanket: sharedBlanket };
  });
}

let sharedClothes: BufferGeometry | null = null;
const faces = new Map<string, BufferGeometry>();
const feet = new Map<string, BufferGeometry>();
const kits = new Map<string, AvatarKit>();

function cached<K, V>(map: Map<K, V>, key: K, build: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = build();
    map.set(key, value);
  }
  return value;
}

/** 동물과 옷차림이 같으면 언제나 같은 부품을 돌려줘요. */
export function getAvatarKit(spec: SpeciesSpec, outfit: Outfit): AvatarKit {
  return cached(kits, `${spec.id}:${outfit}`, () => {
    const face = cached(faces, spec.id, () => buildFace(spec));
    // merged는 넘긴 조각을 정리하므로, 함께 쓰는 틀은 복사해서 넘겨요.
    const lower = outfit === "patient" ? (sharedClothes ??= buildClothes()).clone() : buildBareBody(spec);
    const body = merged([lower, face.clone()]);
    const arm = buildArm(spec, outfit);
    return {
      body,
      arm,
      armRight: outfit === "visitor" ? merged([arm.clone(), ...bouquet()]) : arm,
      foot: cached(feet, spec.id, () => buildFoot(spec)),
    };
  });
}

/** 아바타 한 명이 그리는 삼각형 수예요. */
export function kitTriangles(kit: AvatarKit): number {
  const count = (geometry: BufferGeometry): number =>
    (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
  return count(kit.body) + count(kit.arm) + count(kit.armRight) + count(kit.foot) * 2;
}

let sharedMaterial: MeshStandardMaterial | null = null;

/** 모든 아바타가 함께 쓰는 재질이에요. 반짝임 없는 점토 같은 질감이고, 색은 꼭짓점에 있어요. */
export function getAvatarMaterial(): MeshStandardMaterial {
  if (!sharedMaterial) {
    sharedMaterial = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      emissive: "#14120f",
    });
    // 저녁과 밤에 머리 위 등불이 머리와 어깨를 비춰요.
    addLanternShading(sharedMaterial);
  }
  return sharedMaterial;
}
