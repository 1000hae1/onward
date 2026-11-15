/**
 * 내 침대 옆 작은 사과나무예요. 방명록 주인의 화면에서만 그려요.
 * 서버는 사과나무를 주인의 연결에만 알려 주고(my-tree, guestbook), 다른 사람 화면에는 그릴 정보가 없어요.
 */
import { Group, Mesh, MeshLambertMaterial } from "three";
import type { BufferGeometry, Object3D, Vector3 } from "three";
import { blobs, merged } from "../avatar/shapes.ts";
import type { BlobSpec } from "../avatar/species";
import { appleTreeSpot, BEDS, WALL_BOXES } from "../../shared/ward-layout";
import { hitBox } from "./camera-view";
import type { TapHit } from "./tap-pick";

/** 작은 나무에 보이는 사과는 이만큼까지예요. 개수는 방명록 화면에서 봐요. */
const MAX_FRUIT = 8;
/** 누르는 상자예요. 나무보다 조금 넉넉해요. */
const TAP_HALF = 0.3;
const TAP_HEIGHT = 0.9;
/** 로딩 표시를 띄우는 높이예요. 수관 바로 위예요. */
export const APPLE_TREE_TOP_Y = 0.9;
/** 기다리는 동안 사과가 흔들리는 빠르기와 크기예요. */
const SHAKE_RATE = 9;
const SHAKE_ANGLE = 0.06;

const trunk: BlobSpec[] = [
  { shape: "ball", color: "#c9b896", at: [0, 0.01, 0], size: [0.17, 0.012, 0.17], small: true },
  { shape: "pill", color: "#8b6a4e", at: [0, 0.2, 0], size: [0.035, 0.38, 1] },
  { shape: "pill", color: "#8b6a4e", at: [-0.06, 0.36, 0], size: [0.014, 0.12, 1], tilt: [0, 0, 0.8], small: true },
  { shape: "pill", color: "#8b6a4e", at: [0.06, 0.4, 0], size: [0.012, 0.1, 1], tilt: [0, 0, -0.8], small: true },
];

const canopy: BlobSpec[] = [
  { shape: "ball", color: "#86b575", at: [-0.1, 0.5, 0], size: [0.13, 0.12, 0.12] },
  { shape: "ball", color: "#86b575", at: [0.1, 0.5, 0.02], size: [0.13, 0.12, 0.12] },
  { shape: "ball", color: "#8fbd7d", at: [0, 0.5, -0.06], size: [0.15, 0.13, 0.12] },
  { shape: "ball", color: "#9cc58a", at: [-0.06, 0.6, 0.03], size: [0.13, 0.12, 0.12] },
  { shape: "ball", color: "#9cc58a", at: [0.07, 0.6, -0.02], size: [0.13, 0.12, 0.12] },
  { shape: "ball", color: "#a9cf95", at: [0, 0.68, 0], size: [0.11, 0.09, 0.1] },
];

/** 수관 겉에 사과가 열리는 자리예요. */
const FRUIT_SPOTS: readonly [number, number, number][] = [
  [0.0, 0.52, 0.15],
  [-0.15, 0.48, 0.08],
  [0.16, 0.5, 0.07],
  [-0.09, 0.62, 0.12],
  [0.1, 0.63, 0.1],
  [0.0, 0.42, 0.12],
  [-0.18, 0.56, -0.04],
  [0.18, 0.58, -0.05],
];

const fruit = (at: [number, number, number]): BlobSpec[] => [
  { shape: "ball", color: "#e0574f", at, size: [0.032, 0.03, 0.032], small: true },
  { shape: "ball", color: "#5e9a4e", at: [at[0] + 0.012, at[1] + 0.03, at[2]], size: [0.014, 0.005, 0.008], small: true },
];

export interface AppleTreeView {
  /** 서버가 알려 준 내 나무예요. null이면 그리지 않아요. */
  setTree(tree: { active: boolean; count: number } | null): void;
  /** 내가 차지한 침대예요. 없으면 그리지 않아요. */
  setBed(bed: number | null): void;
  /** 화면에 보이는 나무를 시선이 맞혔으면 맞은 구간이에요. */
  tap(origin: Vector3, reach: Vector3): TapHit | null;
  /** 방명록을 여는 중이면 사과가 살짝 흔들려요. */
  setBusy(busy: boolean): void;
  update(dt: number, stillMotion: boolean): void;
  /** 나무가 보이면 수관 위 자리를 target에 쓰고 돌려줘요. */
  top(target: Vector3): Vector3 | null;
}

export function createAppleTree(parent: Object3D): AppleTreeView {
  const material = new MeshLambertMaterial({ vertexColors: true, emissive: "#14120f" });
  const root = new Group();
  root.visible = false;
  root.add(new Mesh(merged([...blobs(trunk), ...blobs(canopy)]), material));
  const fruitGeometries = new Map<number, BufferGeometry>([[1, merged(blobs(fruit(FRUIT_SPOTS[0])))]]);
  const fruitMesh = new Mesh(fruitGeometries.get(1), material);
  root.add(fruitMesh);
  parent.add(root);

  let tree: { active: boolean; count: number } | null = null;
  let bed: number | null = null;
  let shownFruit = 1;
  let busy = false;
  let shakePhase = 0;

  const refresh = (): void => {
    const show = tree !== null && (tree.active || tree.count > 0) && bed !== null && BEDS[bed] !== undefined;
    root.visible = show;
    if (!show || bed === null || !tree) return;
    const spot = appleTreeSpot(BEDS[bed]);
    root.position.set(spot.x, 0, spot.z);
    const count = Math.min(MAX_FRUIT, tree.count);
    if (count !== shownFruit) {
      shownFruit = count;
      let geometry = fruitGeometries.get(count);
      if (!geometry && count > 0) {
        geometry = merged(FRUIT_SPOTS.slice(0, count).flatMap((at) => blobs(fruit(at))));
        fruitGeometries.set(count, geometry);
      }
      fruitMesh.visible = count > 0;
      if (geometry) fruitMesh.geometry = geometry;
    }
  };

  return {
    setTree(next) {
      tree = next;
      refresh();
    },
    setBed(next) {
      if (next === bed) return;
      bed = next;
      refresh();
    },
    tap(origin, reach) {
      if (!root.visible) return null;
      const { x, z } = root.position;
      const box = { minX: x - TAP_HALF, maxX: x + TAP_HALF, minZ: z - TAP_HALF, maxZ: z + TAP_HALF, minY: 0, maxY: TAP_HEIGHT };
      return hitBox(origin, reach, [box], WALL_BOXES);
    },
    setBusy(next) {
      busy = next;
      if (!busy) {
        shakePhase = 0;
        fruitMesh.rotation.set(0, 0, 0);
      }
    },
    update(dt, stillMotion) {
      if (!busy || stillMotion || !root.visible) return;
      shakePhase += dt * SHAKE_RATE;
      fruitMesh.rotation.z = Math.sin(shakePhase) * SHAKE_ANGLE;
      fruitMesh.rotation.x = Math.sin(shakePhase * 0.7) * SHAKE_ANGLE * 0.5;
    },
    top(target) {
      if (!root.visible) return null;
      return target.set(root.position.x, APPLE_TREE_TOP_Y, root.position.z);
    },
  };
}
