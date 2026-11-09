import { BufferGeometry, Float32BufferAttribute, LatheGeometry, Matrix4, Quaternion, Vector2, Vector3, Euler } from "three";
import { blobShape, paint } from "./shapes.ts";
import type { BlobSpec, Vec3 } from "./species";

/**
 * 머리와 몸이 하나로 이어진 달걀 몸이에요. 모든 동물이 같은 달걀을 쓰고, 부품은 달걀 표면 위의
 * 자리(θ, φ)로 적어요. θ는 바닥 0에서 꼭대기 π까지, φ는 정면 0에서 왼쪽(+x)으로 도는 각도예요.
 */

/** 바닥에서 꼭대기까지의 달걀 높이예요. */
export const EGG_HEIGHT = 0.62;
/** 가장 넓은 곳의 반지름이에요. 폭은 키의 84%쯤이에요. */
export const EGG_RADIUS = 0.262;
/** 앞뒤로 살짝 납작한 비율이에요. */
export const EGG_DEPTH = 0.9;
/** 발 위에 얹히도록 달걀 바닥을 띄운 높이예요. */
export const EGG_BASE_Y = 0.035;
/** 둘레를 나누는 수예요. 휴대폰을 위해 24에서 멈춰요. */
export const EGG_RADIAL = 24;
/** 아래가 조금 더 통통한 정도예요. */
const EGG_TAPER = 0.1;
const POLE_MARGIN = 0.04;

export type SurfaceSpot = readonly [theta: number, phi: number];

export function eggRadius(theta: number): number {
  return EGG_RADIUS * Math.sin(theta) * (1 + EGG_TAPER * Math.cos(theta));
}

export function eggY(theta: number): number {
  return EGG_BASE_Y + (EGG_HEIGHT / 2) * (1 - Math.cos(theta));
}

/** 높이 y에 해당하는 θ예요. 팔이나 옷 경계를 높이로 정할 때 써요. */
export function eggThetaAt(y: number): number {
  const t = 1 - (2 * (y - EGG_BASE_Y)) / EGG_HEIGHT;
  return Math.acos(Math.min(1, Math.max(-1, t)));
}

/** shell은 옷처럼 몸 바깥을 감쌀 때 둘레를 키우는 비율이에요. */
export function eggPoint(theta: number, phi: number, shell = 1, out = new Vector3()): Vector3 {
  const r = eggRadius(theta) * shell;
  return out.set(Math.sin(phi) * r, eggY(theta), Math.cos(phi) * r * EGG_DEPTH);
}

const aheadTheta = new Vector3();
const behindTheta = new Vector3();
const aheadPhi = new Vector3();
const behindPhi = new Vector3();

/** 표면의 바깥쪽 방향이에요. */
export function eggNormal(theta: number, phi: number, out = new Vector3()): Vector3 {
  const t = Math.min(Math.PI - POLE_MARGIN, Math.max(POLE_MARGIN, theta));
  const e = 1e-3;
  eggPoint(t + e, phi, 1, aheadTheta).sub(eggPoint(t - e, phi, 1, behindTheta));
  eggPoint(t, phi + e, 1, aheadPhi).sub(eggPoint(t, phi - e, 1, behindPhi));
  return out.crossVectors(aheadPhi, aheadTheta).normalize();
}

/**
 * 달걀을 가로 띠로 잘라 만들어요. 띠마다 따로 칠하므로 줄무늬 경계가 번지지 않아요.
 * shells는 각 θ 자리의 둘레 비율이고, 숫자 하나면 모두 같아요.
 */
export function eggBand(thetas: readonly number[], shells: number | readonly number[], hex: string): BufferGeometry {
  const points = thetas.map((theta, index) => {
    const shell = typeof shells === "number" ? shells : shells[index];
    return new Vector2(Math.max(1e-4, eggRadius(theta) * shell), eggY(theta));
  });
  const lathe = new LatheGeometry(points, EGG_RADIAL);
  lathe.scale(1, 1, EGG_DEPTH);
  return paint(lathe, hex);
}

/**
 * 둘레를 따라 가장자리 높이가 달라지는 띠예요. 브이넥처럼 앞만 깊게 파인 옷깃을 만들 때 써요.
 * rows(φ)는 그 φ에서 아래부터 위로 올라가는 θ 목록이고, 길이는 shells와 같아야 해요.
 */
export function eggSheet(
  rows: (phi: number) => readonly number[],
  shells: readonly number[],
  hex: string,
  radial = EGG_RADIAL,
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  for (let j = 0; j <= radial; j++) {
    // 이음매가 등 뒤에 오도록 -π에서 시작해요. 정면(φ=0)에 꼭짓점이 하나 놓여 V 끝이 뾰족해요.
    const phi = -Math.PI + (j / radial) * Math.PI * 2;
    const thetas = rows(phi);
    thetas.forEach((theta, index) => {
      eggPoint(Math.max(1e-4, theta), phi, shells[index], point);
      positions.push(point.x, point.y, point.z);
    });
  }
  const count = shells.length;
  const at = (j: number, i: number): number => j * count + i;
  for (let j = 0; j < radial; j++) {
    for (let i = 0; i < count - 1; i++) {
      // φ 방향 × θ 방향이 바깥을 보도록 감아요.
      indices.push(at(j, i), at(j + 1, i), at(j, i + 1));
      indices.push(at(j + 1, i), at(j + 1, i + 1), at(j, i + 1));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return paint(geometry, hex);
}

export interface PatchSpec {
  at: SurfaceSpot;
  /** θ 방향과 φ 방향의 반지름이에요. */
  radius: readonly [number, number];
  color: string;
  /** 가운데가 표면에서 솟은 높이예요. 가장자리는 표면에 붙어요. */
  bulge?: number;
  shell?: number;
  /** 작은 무늬는 면을 적게 써요. */
  small?: boolean;
  /** 표면에서 띄우는 거리예요. 다른 무늬 위에 얹을 때 키워요. */
  lift?: number;
  /** 고리 수와 둘레 분할 수를 직접 정할 때 써요. */
  rings?: number;
  segments?: number;
}

const PATCH_LIFT = 0.0025;

/** 배 무늬나 얼굴 무늬처럼 표면을 따라 붙는 타원 조각이에요. */
export function eggPatch(spec: PatchSpec): BufferGeometry {
  const rings = spec.rings ?? (spec.small ? 1 : 3);
  const segments = spec.segments ?? (spec.small ? 8 : 16);
  const bulge = spec.bulge ?? 0.006;
  const shell = spec.shell ?? 1;
  const lift = spec.lift ?? PATCH_LIFT;
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  const normal = new Vector3();
  const push = (u: number, v: number): void => {
    const theta = spec.at[0] + v * spec.radius[0];
    const phi = spec.at[1] + u * spec.radius[1];
    const s2 = u * u + v * v;
    eggPoint(theta, phi, shell, point);
    eggNormal(theta, phi, normal);
    point.addScaledVector(normal, lift + bulge * (1 - s2));
    positions.push(point.x, point.y, point.z);
  };
  push(0, 0);
  for (let ring = 1; ring <= rings; ring++) {
    const s = ring / rings;
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      push(Math.cos(angle) * s, Math.sin(angle) * s);
    }
  }
  const at = (ring: number, j: number): number => 1 + (ring - 1) * segments + (j % segments);
  for (let j = 0; j < segments; j++) indices.push(0, at(1, j), at(1, j + 1));
  for (let ring = 1; ring < rings; ring++) {
    for (let j = 0; j < segments; j++) {
      indices.push(at(ring, j), at(ring + 1, j), at(ring + 1, j + 1));
      indices.push(at(ring, j), at(ring + 1, j + 1), at(ring, j + 1));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return paint(geometry, spec.color);
}

/** 좌우 한 쌍의 무늬예요. 눈과 볼처럼 φ만 반대인 두 조각을 돌려줘요. */
export function mirroredPatches(spec: PatchSpec): PatchSpec[] {
  return [spec, { ...spec, at: [spec.at[0], -spec.at[1]] }];
}

export interface SurfaceBlob extends Pick<BlobSpec, "shape" | "color" | "size" | "small"> {
  on: SurfaceSpot;
  /**
   * face는 납작한 면이 바깥을 보게(눈, 코, 볼), out은 부품의 위쪽이 바깥으로 뻗게(귀, 뿔, 꼬리) 붙여요.
   * out이면 부품 밑동이 표면에 닿도록 저절로 올려 붙여요.
   */
  align?: "face" | "out";
  /** 표면에서 바깥으로 띄우는 거리예요. 음수면 묻혀요. */
  lift?: number;
  /** 붙인 자리에서 부품을 더 돌리는 각도예요. 밑동을 중심으로 돌아요. */
  tilt?: Vec3;
  /** 돌린 뒤 부품의 자기 좌표로 옮기는 거리예요. */
  offset?: Vec3;
  /** 옷 위에 붙이는 부품이면 옷 둘레 비율이에요. */
  shell?: number;
  /** φ를 반대로 한 짝을 하나 더 붙여요. */
  mirror?: boolean;
}

const UP = new Vector3(0, 1, 0);
const FRONT = new Vector3(0, 0, 1);
const surfaceMatrix = new Matrix4();
const localMatrix = new Matrix4();
const alignQuaternion = new Quaternion();
const tiltQuaternion = new Quaternion();
const tiltEuler = new Euler();
const spot = new Vector3();
const outward = new Vector3();
const shift = new Vector3();
const ONE = new Vector3(1, 1, 1);

function baseOffset(blob: SurfaceBlob): number {
  if (blob.align !== "out") return 0;
  if (blob.shape === "pill") return (blob.size[1] / 2 + blob.size[0]) * 0.85;
  if (blob.shape === "cone") return blob.size[1] * 0.42;
  return blob.size[1] * 0.6;
}

function placeOne(blob: SurfaceBlob, phi: number, tilt: Vec3, offset: Vec3): BufferGeometry {
  const [theta] = blob.on;
  eggPoint(theta, phi, blob.shell ?? 1, spot);
  eggNormal(theta, phi, outward);
  spot.addScaledVector(outward, blob.lift ?? 0);
  alignQuaternion.setFromUnitVectors(blob.align === "out" ? UP : FRONT, outward);
  tiltQuaternion.setFromEuler(tiltEuler.set(tilt[0], tilt[1], tilt[2]));
  alignQuaternion.multiply(tiltQuaternion);
  surfaceMatrix.compose(spot, alignQuaternion, ONE);
  shift.set(offset[0], offset[1] + baseOffset(blob), offset[2]);
  localMatrix.makeTranslation(shift.x, shift.y, shift.z);
  return blobShape(blob).applyMatrix4(surfaceMatrix.multiply(localMatrix));
}

/** 표면 자리로 적은 부품을 도형으로 바꿔요. */
export function surfaceBlobs(list: readonly SurfaceBlob[]): BufferGeometry[] {
  return list.flatMap((blob) => {
    const tilt = blob.tilt ?? [0, 0, 0];
    const offset = blob.offset ?? [0, 0, 0];
    const parts = [placeOne(blob, blob.on[1], tilt, offset)];
    if (blob.mirror) {
      parts.push(placeOne(blob, -blob.on[1], [tilt[0], -tilt[1], -tilt[2]], [-offset[0], offset[1], offset[2]]));
    }
    return parts;
  });
}
