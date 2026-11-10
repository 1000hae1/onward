/**
 * 내 침대 옆 작은 사과나무예요. 방명록 주인의 화면에서만 그려요.
 * 서버는 사과나무를 주인의 연결에만 알려 주고(my-tree, guestbook), 다른 사람 화면에는 그릴 정보가 없어요.
 */
import { Group, Mesh, MeshLambertMaterial } from "three";
import type { BufferGeometry, Object3D } from "three";
import { blobs, merged } from "../avatar/shapes.ts";
import type { BlobSpec } from "../avatar/species";
import { appleTreeSpot, BEDS } from "../../shared/ward-layout";

/** 작은 나무에 보이는 사과는 이만큼까지예요. 개수는 방명록 화면에서 봐요. */
const MAX_FRUIT = 8;

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
  };
}
