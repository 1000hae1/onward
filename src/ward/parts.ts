import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { BufferGeometry, Material, Object3D } from "three";

const UP = new Vector3(0, 1, 0);

/** 위치, y축 회전, 크기로 변환 행렬을 만들어요. */
export function transform(
  x: number,
  y: number,
  z: number,
  rotationY = 0,
  scaleX = 1,
  scaleY = scaleX,
  scaleZ = scaleX,
): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(UP, rotationY),
    new Vector3(scaleX, scaleY, scaleZ),
  );
}

/** 같은 도형을 여러 자리에 놓아요. 물건 하나마다 한 번씩 그리지 않아 휴대폰에서도 가벼워요. */
export function addInstances(
  parent: Object3D,
  geometry: BufferGeometry,
  material: Material,
  matrices: readonly Matrix4[],
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

/** 여러 받침 자리에 같은 구성품 배치를 반복해요. */
export function repeatAt(
  bases: readonly Matrix4[],
  locals: readonly Matrix4[],
): Matrix4[] {
  return bases.flatMap((base) => locals.map((local) => new Matrix4().multiplyMatrices(base, local)));
}

/** 늘 같은 풍경이 나오도록 시드를 정해 난수를 만들어요. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
