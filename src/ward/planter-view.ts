import { Group, Mesh, MeshLambertMaterial } from "three";
import type { BufferGeometry, Object3D, Vector3 } from "three";
import { blobs, merged } from "../avatar/shapes.ts";
import type { BlobSpec } from "../avatar/species";
import { planterSpot, ROOMS, WALL_BOXES } from "../../shared/ward-layout";
import { planterStage } from "../../shared/planter";
import { pickBox } from "./camera-view";

const POT = "#c98a62";
const POT_RIM = "#b97a54";
const SOIL = "#6b4a33";
const STEM = "#5f9a58";
const LEAF = "#74b86c";
const BUD = "#9fca7e";
const PETAL = "#f6c9d2";
const PETAL_DEEP = "#f2b0bf";
const CENTER = "#f4d77a";

/** 잎이 살짝 흔들리는 시간이에요. 단계가 오를 때 한 번이에요. */
const SWAY_SECONDS = 2.4;
const SWAY_ANGLE = 0.14;
const TAP_HALF = 0.14;
const TAP_HEIGHT = 0.42;

const pot: BlobSpec[] = [
  { shape: "cone", color: POT, at: [0, 0.07, 0], size: [0.075, 0.14, 1], tilt: [Math.PI, 0, 0] },
  { shape: "pill", color: POT_RIM, at: [0, 0.135, 0], size: [0.082, 0.02, 1] },
  { shape: "ball", color: SOIL, at: [0, 0.14, 0], size: [0.066, 0.012, 0.066], small: true },
];

const leaf = (angle: number, y: number, length: number): BlobSpec => ({
  shape: "ball",
  color: LEAF,
  at: [Math.cos(angle) * length * 0.8, y, Math.sin(angle) * length * 0.8],
  size: [length, 0.008, length * 0.5],
  tilt: [0, -angle, 0.35],
  small: true,
});

const stem = (height: number): BlobSpec => ({
  shape: "pill",
  color: STEM,
  at: [0, 0.14 + height / 2, 0],
  size: [0.006, height, 1],
  small: true,
});

const flower = (x: number, y: number, z: number, color: string): BlobSpec[] => [
  ...Array.from({ length: 5 }, (_, index): BlobSpec => {
    const angle = (index / 5) * Math.PI * 2;
    return {
      shape: "ball",
      color,
      at: [x + Math.cos(angle) * 0.022, y, z + Math.sin(angle) * 0.022],
      size: [0.02, 0.008, 0.014],
      tilt: [0, -angle, 0],
      small: true,
    };
  }),
  { shape: "ball", color: CENTER, at: [x, y + 0.004, z], size: [0.011, 0.008, 0.011], small: true },
];

/** 단계마다 화분 위에 자라는 것이에요. 새싹 → 잎 → 줄기 → 봉오리 → 꽃 한 송이 → 꽃 여러 송이. */
const STAGE_PLANTS: readonly BlobSpec[][] = [
  [stem(0.03), leaf(0.3, 0.172, 0.016), leaf(Math.PI + 0.3, 0.172, 0.016)],
  [stem(0.06), leaf(0.3, 0.19, 0.03), leaf(Math.PI + 0.3, 0.19, 0.03), leaf(1.9, 0.17, 0.024)],
  [stem(0.14), leaf(0.3, 0.21, 0.036), leaf(Math.PI + 0.3, 0.23, 0.036), leaf(1.9, 0.25, 0.03), leaf(4.6, 0.19, 0.03)],
  [
    stem(0.18),
    leaf(0.3, 0.21, 0.04),
    leaf(Math.PI + 0.3, 0.24, 0.04),
    leaf(1.9, 0.27, 0.032),
    { shape: "ball", color: BUD, at: [0, 0.33, 0], size: [0.016, 0.026, 0.016], small: true },
  ],
  [
    stem(0.2),
    leaf(0.3, 0.21, 0.04),
    leaf(Math.PI + 0.3, 0.24, 0.04),
    leaf(1.9, 0.27, 0.032),
    ...flower(0, 0.345, 0, PETAL),
  ],
  [
    stem(0.2),
    { shape: "pill", color: STEM, at: [0.04, 0.27, 0.01], size: [0.005, 0.12, 1], tilt: [0, 0, -0.35], small: true },
    { shape: "pill", color: STEM, at: [-0.035, 0.26, -0.015], size: [0.005, 0.1, 1], tilt: [0.2, 0, 0.4], small: true },
    leaf(0.3, 0.21, 0.042),
    leaf(Math.PI + 0.3, 0.23, 0.042),
    leaf(1.9, 0.26, 0.034),
    leaf(4.6, 0.2, 0.034),
    ...flower(0, 0.345, 0, PETAL),
    ...flower(0.06, 0.325, 0.015, PETAL_DEEP),
    ...flower(-0.055, 0.31, -0.025, PETAL),
  ],
];

export interface PlanterView {
  /** 서버가 알려 준 누적 수로 맞춰요. 처음 맞출 때는 흔들지 않아요. */
  setTotals(totals: readonly number[]): void;
  /** 한 병실의 누적 수가 바뀌었어요. 단계가 오르면 잎이 살짝 흔들려요. */
  setTotal(room: number, total: number): void;
  total(room: number): number;
  update(dt: number, stillMotion: boolean): void;
  /** 누른 곳에 화분이 있으면 그 병실 번호예요. */
  tap(origin: Vector3, reach: Vector3): number | null;
}

/** 병실 창틀마다 놓인 작은 화분이에요. 아무도 오지 않아도 시들지 않아요. */
export function createPlanters(parent: Object3D): PlanterView {
  const material = new MeshLambertMaterial({ vertexColors: true, emissive: "#14120f" });
  const potGeometry = merged(blobs(pot));
  const plantGeometries: BufferGeometry[] = STAGE_PLANTS.map((plant) => merged(blobs(plant)));

  const planters = ROOMS.map((room) => {
    const spot = planterSpot(room);
    const root = new Group();
    root.position.set(spot.x, spot.y, spot.z);
    root.rotation.y = room.rotationY;
    root.add(new Mesh(potGeometry, material));
    const plant = new Mesh(plantGeometries[0], material);
    plant.position.y = 0;
    root.add(plant);
    parent.add(root);
    return { spot, root, plant, total: 0, stage: 0, sway: 0 };
  });

  const apply = (index: number, total: number, animate: boolean): void => {
    const planter = planters[index];
    if (!planter) return;
    // 줄어든 값은 받지 않아요. 화분은 줄지 않아요.
    const next = Math.max(planter.total, total);
    const stage = planterStage(next);
    if (stage !== planter.stage) {
      planter.plant.geometry = plantGeometries[stage];
      if (animate && stage > planter.stage) planter.sway = SWAY_SECONDS;
      planter.stage = stage;
    }
    planter.total = next;
  };

  return {
    setTotals(totals) {
      totals.forEach((total, index) => apply(index, total, false));
    },
    setTotal(room, total) {
      apply(room, total, true);
    },
    total(room) {
      return planters[room]?.total ?? 0;
    },
    update(dt, stillMotion) {
      for (const planter of planters) {
        if (planter.sway <= 0) continue;
        planter.sway = Math.max(0, planter.sway - dt);
        if (stillMotion) {
          planter.plant.rotation.z = 0;
          planter.plant.scale.setScalar(1);
          continue;
        }
        const t = 1 - planter.sway / SWAY_SECONDS;
        const fade = Math.sin(Math.PI * t);
        planter.plant.rotation.z = Math.sin(t * Math.PI * 5) * SWAY_ANGLE * fade;
        planter.plant.rotation.x = Math.sin(t * Math.PI * 3.5) * SWAY_ANGLE * 0.5 * fade;
        planter.plant.scale.setScalar(1 + 0.08 * fade);
      }
    },
    tap(origin, reach) {
      const boxes = planters.map(({ spot }) => ({
        minX: spot.x - TAP_HALF,
        maxX: spot.x + TAP_HALF,
        minZ: spot.z - TAP_HALF,
        maxZ: spot.z + TAP_HALF,
        minY: spot.y,
        maxY: spot.y + TAP_HEIGHT,
      }));
      return pickBox(origin, reach, boxes, WALL_BOXES);
    },
  };
}
