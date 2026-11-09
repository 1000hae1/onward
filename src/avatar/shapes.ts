import {
  BufferAttribute,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { BlobSpec, Vec3 } from "./species";

/** 자료로 적은 부품을 도형으로 바꾸는 도구예요. 아바타와 고양이, 선물이 함께 써요. */

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const scale = new Vector3(1, 1, 1);

export function paint(source: BufferGeometry, hex: string): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  geometry.deleteAttribute("uv");
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const { r, g, b } = new Color(hex);
  for (let index = 0; index < count; index++) colors.set([r, g, b], index * 3);
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

export function place(
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

/** 자리를 잡기 전, 원점에 놓인 부품 모양이에요. 크기와 납작함만 들어가 있어요. */
export function blobShape(blob: Pick<BlobSpec, "shape" | "color" | "size" | "small">): BufferGeometry {
  const { shape, size, small } = blob;
  if (shape === "ball") {
    const sphere = small ? new SphereGeometry(1, 5, 3) : new SphereGeometry(1, 8, 5);
    return paint(sphere, blob.color).scale(size[0], size[1], size[2]);
  }
  if (shape === "pill") {
    const pill = small
      ? new CapsuleGeometry(size[0], size[1], 1, 4)
      : new CapsuleGeometry(size[0], size[1], 1, 6);
    return paint(pill, blob.color).scale(1, 1, size[2]);
  }
  return paint(new ConeGeometry(size[0], size[1], small ? 5 : 6), blob.color);
}

function blobGeometry(blob: BlobSpec, at: Vec3, tilt: Vec3): BufferGeometry {
  return place(blobShape(blob), at, tilt);
}

export function blobs(list: readonly BlobSpec[], offset: Vec3 = [0, 0, 0]): BufferGeometry[] {
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
export function merged(parts: BufferGeometry[]): BufferGeometry {
  // 이미 합친 조각(색인 있음)과 새 조각(색인 없음)을 함께 넘겨도 되도록 맞춰요.
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const geometry = mergeGeometries(flat);
  for (const part of flat) part.dispose();
  for (const part of parts) part.dispose();
  return mergeVertices(geometry);
}

