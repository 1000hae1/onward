import {
  BufferAttribute,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Euler,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { BlobSpec, Outfit, SpeciesSpec, Vec3 } from "./species";

/**
 * 아바타 부품을 동물과 옷차림별로 한 번만 만들어 재사용해요. 재질은 모두가 하나를 함께 써요.
 * 색은 꼭짓점에 칠해서 텍스처가 없고, 관절 하나가 메시 하나라 아바타 한 명이 6번만 그려져요.
 */

export interface AvatarKit {
  torso: BufferGeometry;
  head: BufferGeometry;
  /** 왼팔과 오른팔이 함께 써요. */
  arm: BufferGeometry;
  /** 문병객의 오른팔이에요. 꽃다발을 들고 있어요. 환자는 arm과 같아요. */
  armRight: BufferGeometry;
  /** 왼다리와 오른다리가 함께 써요. */
  leg: BufferGeometry;
}

/** 엉덩이, 어깨, 목 관절 자리예요. 몸통과 머리 치수의 기준이에요. */
export const HIP_Y = 0.26;
export const SHOULDER_X = 0.185;
export const SHOULDER_Y = 0.27;
export const NECK_Y = 0.32;
export const LEG_X = 0.085;
const HEAD_CENTER_Y = 0.17;

const TORSO_RADIUS = 0.17;
const TORSO_DEPTH = 0.88;
const TORSO_RADIAL = 16;
const LIMB_RADIAL = 8;
const ARM_RADIUS = 0.05;
const ARM_LENGTH = 0.17;
const ARM_CENTER_Y = -0.1;
const HAND_Y = -0.25;
const LEG_RADIUS = 0.07;
const LEG_LENGTH = 0.1;
const LEG_CENTER_Y = -0.09;
const FOOT_Y = -0.222;

const PAJAMA = "#b4def5";
const PAJAMA_COLLAR = "#7fbde3";
const BUTTON_COLOR = "#ffffff";
const KNIT = "#c97b63";
const KNIT_TRIM = "#b56a54";
const TROUSERS = "#5a6678";
const SCARF = "#e3b85f";

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const scale = new Vector3(1, 1, 1);

function paint(source: BufferGeometry, hex: string): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  geometry.deleteAttribute("uv");
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const { r, g, b } = new Color(hex);
  for (let index = 0; index < count; index++) colors.set([r, g, b], index * 3);
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

function place(
  geometry: BufferGeometry,
  at: Vec3,
  tilt: Vec3 = [0, 0, 0],
  stretch: Vec3 = [1, 1, 1],
): BufferGeometry {
  euler.set(tilt[0], tilt[1], tilt[2]);
  quaternion.setFromEuler(euler);
  position.set(at[0], at[1], at[2]);
  scale.set(stretch[0], stretch[1], stretch[2]);
  geometry.applyMatrix4(matrix.compose(position, quaternion, scale));
  return geometry;
}

function blobGeometry(blob: BlobSpec, at: Vec3, tilt: Vec3): BufferGeometry {
  const { shape, size, small } = blob;
  if (shape === "ball") {
    const sphere = small ? new SphereGeometry(1, 5, 3) : new SphereGeometry(1, 8, 5);
    return place(paint(sphere, blob.color), at, tilt, size);
  }
  if (shape === "pill") {
    const pill = small
      ? new CapsuleGeometry(size[0], size[1], 1, 4)
      : new CapsuleGeometry(size[0], size[1], 1, 6);
    return place(paint(pill, blob.color), at, tilt, [1, 1, size[2]]);
  }
  return place(paint(new ConeGeometry(size[0], size[1], small ? 5 : 6), blob.color), at, tilt);
}

function blobs(list: readonly BlobSpec[], offset: Vec3 = [0, 0, 0]): BufferGeometry[] {
  return list.flatMap((blob) => {
    const tilt = blob.tilt ?? [0, 0, 0];
    const at: Vec3 = [blob.at[0] + offset[0], blob.at[1] + offset[1], blob.at[2] + offset[2]];
    const parts = [blobGeometry(blob, at, tilt)];
    if (blob.mirror) {
      // x축 거울상이에요. y와 z축 회전은 방향이 반대가 돼요.
      parts.push(blobGeometry(blob, [-at[0], at[1], at[2]], [tilt[0], -tilt[1], -tilt[2]]));
    }
    return parts;
  });
}

/** 부품을 하나로 합쳐요. 같은 꼭짓점은 다시 묶어서 휴대폰이 계산할 양을 줄여요. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return mergeVertices(geometry);
}

function buildHead(spec: SpeciesSpec): BufferGeometry {
  const center: Vec3 = [0, HEAD_CENTER_Y, 0];
  const eye = paint(new SphereGeometry(1, 7, 4), "#2c2a28");
  const eyeMirror = eye.clone();
  const eyeSize: Vec3 = [0.024, 0.026, 0.016];
  const [eyeX, eyeY, eyeZ] = spec.eye;
  return merged([
    place(paint(new SphereGeometry(1, 16, 9), spec.fur), center, [0, 0, 0], spec.headSize),
    ...blobs(spec.head, center),
    place(eye, [eyeX, center[1] + eyeY, eyeZ], [0, 0, 0], eyeSize),
    place(eyeMirror, [-eyeX, center[1] + eyeY, eyeZ], [0, 0, 0], eyeSize),
  ]);
}

function buildTorso(spec: SpeciesSpec, outfit: Outfit): BufferGeometry {
  const body = new CapsuleGeometry(TORSO_RADIUS, 0.06, 3, TORSO_RADIAL);
  const middle: Vec3 = [0, 0.16, 0];
  const depth: Vec3 = [1, 1, TORSO_DEPTH];
  const tail = blobs(spec.tail);
  if (outfit === "patient") {
    return merged([
      place(paint(body, PAJAMA), middle, [0, 0, 0], depth),
      ...blobs([
        { shape: "ball", color: PAJAMA_COLLAR, at: [0, 0.325, 0], size: [0.125, 0.032, 0.115] },
        { shape: "ball", color: BUTTON_COLOR, at: [0, 0.2, 0.15], size: [0.014, 0.014, 0.008], small: true },
        { shape: "ball", color: BUTTON_COLOR, at: [0, 0.11, 0.153], size: [0.014, 0.014, 0.008], small: true },
      ]),
      ...tail,
    ]);
  }
  return merged([
    place(paint(body, KNIT), middle, [0, 0, 0], depth),
    ...blobs([
      { shape: "ball", color: SCARF, at: [0, 0.32, 0], size: [0.135, 0.04, 0.125] },
      { shape: "ball", color: KNIT_TRIM, at: [0, 0, 0], size: [0.135, 0.03, 0.12], small: true },
    ]),
    ...tail,
  ]);
}

function sleeve(outfit: Outfit): BufferGeometry {
  const pill = new CapsuleGeometry(ARM_RADIUS, ARM_LENGTH, 2, LIMB_RADIAL);
  const painted =
    outfit === "patient" ? paint(pill, PAJAMA) : paint(pill, KNIT);
  return place(painted, [0, ARM_CENTER_Y, 0]);
}

function hand(spec: SpeciesSpec): BufferGeometry {
  const sphere = paint(new SphereGeometry(1, 6, 4), spec.hand.color);
  return place(sphere, [0, HAND_Y, 0], [0, 0, 0], spec.hand.size);
}

/** 작은 꽃다발이에요. 팔을 앞으로 들었을 때 곧게 서도록 팔 각도만큼 되돌려 달아요. */
function bouquet(armPitch: number): BufferGeometry[] {
  const wrap: BlobSpec[] = [
    { shape: "cone", color: "#f3e6d0", at: [0, 0.03, 0], size: [0.05, 0.15, 0], tilt: [Math.PI, 0, 0], small: true },
    { shape: "ball", color: "#d98c8c", at: [0, 0.015, 0], size: [0.03, 0.012, 0.03], small: true },
    { shape: "ball", color: "#7aa886", at: [0.04, 0.115, -0.015], size: [0.03, 0.024, 0.03], small: true },
    { shape: "ball", color: "#7aa886", at: [-0.04, 0.11, 0.015], size: [0.03, 0.024, 0.03], small: true },
    { shape: "ball", color: "#f2a7b5", at: [0, 0.14, 0.02], size: [0.038, 0.034, 0.038], small: true },
    { shape: "ball", color: "#f7d67a", at: [0.033, 0.125, 0.018], size: [0.028, 0.026, 0.028], small: true },
    { shape: "ball", color: "#e9828f", at: [-0.03, 0.128, -0.012], size: [0.03, 0.028, 0.03], small: true },
  ];
  const handle = new Matrix4().compose(
    new Vector3(0, HAND_Y - 0.01, 0.015),
    new Quaternion().setFromEuler(new Euler(-armPitch, 0, 0)),
    new Vector3(1, 1, 1),
  );
  return blobs(wrap).map((part) => part.applyMatrix4(handle));
}

function buildLeg(spec: SpeciesSpec, outfit: Outfit): BufferGeometry {
  const pill = new CapsuleGeometry(LEG_RADIUS, LEG_LENGTH, 1, LIMB_RADIAL);
  const trouser =
    outfit === "patient" ? paint(pill, PAJAMA) : paint(pill, TROUSERS);
  const foot = paint(new SphereGeometry(1, 6, 4), spec.foot.color);
  return merged([
    place(trouser, [0, LEG_CENTER_Y, 0]),
    place(foot, [0, FOOT_Y, 0.03], [0, 0, 0], spec.foot.size),
  ]);
}

const heads = new Map<string, BufferGeometry>();
const kits = new Map<string, AvatarKit>();

/** 동물과 옷차림이 같으면 언제나 같은 부품을 돌려줘요. armPitch는 꽃다발 든 팔의 각도예요. */
export function getAvatarKit(spec: SpeciesSpec, outfit: Outfit, armPitch: number): AvatarKit {
  const key = `${spec.id}:${outfit}`;
  const existing = kits.get(key);
  if (existing) return existing;

  let head = heads.get(spec.id);
  if (!head) {
    head = buildHead(spec);
    heads.set(spec.id, head);
  }
  const arm = merged([sleeve(outfit), hand(spec)]);
  const kit: AvatarKit = {
    torso: buildTorso(spec, outfit),
    head,
    arm,
    armRight:
      outfit === "visitor" ? merged([sleeve(outfit), hand(spec), ...bouquet(armPitch)]) : arm,
    leg: buildLeg(spec, outfit),
  };
  kits.set(key, kit);
  return kit;
}

/** 아바타 한 명이 그리는 삼각형 수예요. */
export function kitTriangles(kit: AvatarKit): number {
  const count = (geometry: BufferGeometry): number =>
    (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
  return (
    count(kit.torso) +
    count(kit.head) +
    count(kit.arm) +
    count(kit.armRight) +
    count(kit.leg) * 2
  );
}

let sharedMaterial: MeshLambertMaterial | null = null;

/** 모든 아바타가 함께 쓰는 재질이에요. 색은 꼭짓점에 있어요. */
export function getAvatarMaterial(): MeshLambertMaterial {
  sharedMaterial ??= new MeshLambertMaterial({ vertexColors: true, emissive: "#14120f" });
  return sharedMaterial;
}
