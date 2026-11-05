import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import type { Matrix4, Object3D } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CORRIDOR, HOSPITAL_BLOCKS, HOSPITAL_LINKS, ROOM } from "./layout";
import { addInstances, createRandom, repeatAt, transform } from "./parts";

const GROUND_Y = -0.12;
const GROUND_SIZE = 900;
/** 정원 자리예요. 이 안에는 숲의 큰 나무를 심지 않아요. */
const GARDEN = { minX: -40, maxX: 40, minZ: -34, maxZ: ROOM.minZ };
const FOREST_MIN_RADIUS = 36;
const FOREST_MAX_RADIUS = 165;

interface RidgeShape {
  radius: number;
  base: number;
  /** [세기, 둘레에 반복되는 횟수, 시작 각도] */
  waves: readonly (readonly [number, number, number])[];
}

const RIDGES: readonly RidgeShape[] = [
  {
    radius: 320,
    base: 44,
    waves: [
      [11, 3, 0.4],
      [6, 7, 2.1],
      [3, 17, 4.2],
    ],
  },
  {
    radius: 255,
    base: 30,
    waves: [
      [9, 4, 1.7],
      [5, 9, 0.2],
      [2.2, 23, 3.1],
    ],
  },
  {
    radius: 195,
    base: 17,
    waves: [
      [7, 5, 3.3],
      [3.5, 11, 1.1],
      [1.4, 29, 5.2],
    ],
  },
];

export interface LandscapeOptions {
  forestTrees: number;
  ridgeSegments: number;
}

export interface LandscapeHandles {
  ground: MeshBasicMaterial;
  /** 먼 산부터 가까운 산 순서예요. */
  ridges: MeshBasicMaterial[];
  gardenLamp: MeshBasicMaterial;
}

const lambert = (color: string, flatShading = false): MeshLambertMaterial =>
  new MeshLambertMaterial({ color, flatShading });

function createRidgeGeometry(shape: RidgeShape, segments: number): BufferGeometry {
  const positions = new Float32Array((segments + 1) * 6);
  const colors = new Float32Array((segments + 1) * 6);
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    let height = shape.base;
    for (const [strength, repeats, phase] of shape.waves) {
      height += Math.sin(angle * repeats + phase) * strength;
    }
    const x = Math.cos(angle) * shape.radius;
    const z = Math.sin(angle) * shape.radius;
    positions.set([x, -1, z, x, height, z], i * 6);
    // 산자락은 어둡고 눈 덮인 능선은 밝아요.
    colors.set([0.74, 0.74, 0.74, 1, 1, 1], i * 6);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function buildRidges(parent: Object3D, segments: number): MeshBasicMaterial[] {
  return RIDGES.map((shape) => {
    const material = new MeshBasicMaterial({
      vertexColors: true,
      side: DoubleSide,
      fog: false,
    });
    parent.add(new Mesh(createRidgeGeometry(shape, segments), material));
    return material;
  });
}

function isForestSpotFree(x: number, z: number): boolean {
  const margin = 4;
  const hits = (rect: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean =>
    x > rect.minX - margin && x < rect.maxX + margin && z > rect.minZ - margin && z < rect.maxZ + margin;
  return !hits(GARDEN) && ![...HOSPITAL_BLOCKS, ...HOSPITAL_LINKS].some(hits);
}

/** 눈 덮인 침엽수 한 그루는 줄기, 잎, 눈 모자로 이루어져요. */
function addConifers(
  parent: Object3D,
  spots: readonly (readonly [number, number, number])[],
): void {
  addInstances(
    parent,
    new CylinderGeometry(0.1, 0.14, 0.8, 6),
    lambert("#7f6450", true),
    spots.map(([x, z, s]) => transform(x, 0.4 * s, z, 0, s)),
  );
  addInstances(
    parent,
    new ConeGeometry(0.85, 1.7, 7),
    lambert("#5e8272", true),
    spots.map(([x, z, s]) => transform(x, 1.5 * s, z, x * z, s)),
  );
  addInstances(
    parent,
    new ConeGeometry(0.55, 0.95, 7),
    lambert("#f6f9fa", true),
    spots.map(([x, z, s]) => transform(x, 2.05 * s, z, x * z, s)),
  );
}

function buildForest(parent: Object3D, treeCount: number): void {
  const random = createRandom(7);
  const spots: (readonly [number, number, number])[] = [];
  let attempts = 0;
  while (spots.length < treeCount && attempts < treeCount * 12) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const radius = FOREST_MIN_RADIUS + random() * (FOREST_MAX_RADIUS - FOREST_MIN_RADIUS);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (isForestSpotFree(x, z)) spots.push([x, z, 2.6 + random() * 3.4]);
  }
  addConifers(parent, spots);
}

/** 병실 창밖의 정원이에요. 산책로, 얼어붙은 연못, 벤치, 가로등, 눈사람이 있어요. */
function buildGarden(parent: Object3D): MeshBasicMaterial {
  const addFlat = (geometry: BufferGeometry, color: string, x: number, y: number, z: number): void => {
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, lambert(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
  };

  // 병동 건물을 따라 난 긴 산책로와 연못으로 가는 길이에요.
  const pathColor = "#d6d4cf";
  addFlat(new PlaneGeometry(CORRIDOR.maxX - CORRIDOR.minX + 40, 1.7), pathColor, 0, -0.08, -9);
  addFlat(new PlaneGeometry(1.5, 8), pathColor, 0, -0.08, -13);
  addFlat(new CircleGeometry(7.5, 28), "#b5d0dc", 0, -0.08, -23);
  addFlat(new CircleGeometry(8.2, 28), "#e9eef0", 0, -0.09, -23);

  // 산책로 옆의 나지막한 눈 쌓인 나무와 언덕이에요.
  addConifers(parent, [
    [-14, -14, 2.2],
    [-8.5, -18, 2.6],
    [10, -15, 2.4],
    [15, -19, 2.8],
    [-24, -13, 2.5],
    [24, -14, 2.3],
    [-30, -24, 3],
    [31, -26, 3.2],
    [-16, -30, 3.1],
    [17, -31, 3],
  ]);
  addInstances(parent, new SphereGeometry(1, 12, 8), lambert("#f1f5f6"), [
    transform(-20, -0.12, -19, 0, 5, 0.9, 4),
    transform(21, -0.12, -21, 0, 6, 1.1, 4),
    transform(-5, -0.12, -31, 0, 7, 1, 3),
    transform(9, -0.12, -6.6, 0, 3.5, 0.4, 1),
    transform(-11, -0.12, -6.6, 0, 3, 0.35, 1),
  ]);

  // 산책로를 따라 줄지어 선 낮은 울타리예요.
  const hedgeSpots = [-24, -18, -12, -6, 6, 12, 18, 24].map((x) => transform(x, 0.28, -10.4));
  addInstances(parent, new RoundedBoxGeometry(4.6, 0.6, 0.7, 2, 0.2), lambert("#6c8d78"), hedgeSpots);
  addInstances(
    parent,
    new RoundedBoxGeometry(4.7, 0.16, 0.8, 2, 0.08),
    lambert("#f6f9fa"),
    hedgeSpots.map((matrix) => transform(0, 0.33, 0).premultiply(matrix)),
  );

  // 벤치
  const benches: Matrix4[] = [-21, -9, 9, 21].map((x) => transform(x, 0, -7.6));
  addInstances(
    parent,
    new RoundedBoxGeometry(1.5, 0.08, 0.42, 2, 0.03),
    lambert("#c9bda8"),
    repeatAt(benches, [transform(0, 0.42, 0), transform(0, 0.68, -0.2, 0, 1, 1, 0.3)]),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.035, 0.035, 0.42, 6),
    lambert("#8d959b"),
    repeatAt(benches, [transform(-0.6, 0.21, 0), transform(0.6, 0.21, 0)]),
  );

  // 가로등. 저녁이 되면 불이 들어와요.
  const lampSpots: Matrix4[] = [-27, -15, -3, 3, 15, 27].map((x) => transform(x, 0, -7.2));
  addInstances(
    parent,
    new CylinderGeometry(0.05, 0.07, 2.8, 8),
    lambert("#7f878d"),
    repeatAt(lampSpots, [transform(0, 1.4, 0)]),
  );
  const lampMaterial = new MeshBasicMaterial({ color: "#ffffff" });
  addInstances(
    parent,
    new SphereGeometry(0.2, 12, 8),
    lampMaterial,
    repeatAt(lampSpots, [transform(0, 2.9, 0)]),
  );

  // 창문 앞 눈사람
  const snowmanX = 1.8;
  const snowmanZ = -7;
  addInstances(parent, new SphereGeometry(1, 14, 10), lambert("#fbfdfe"), [
    transform(snowmanX, 0.32, snowmanZ, 0, 0.42),
    transform(snowmanX, 0.84, snowmanZ, 0, 0.29),
  ]);
  addInstances(parent, new ConeGeometry(0.05, 0.22, 7), lambert("#ee8a2c"), [
    transform(snowmanX, 0.85, snowmanZ + 0.3).multiply(
      transform(0, 0, 0).makeRotationX(Math.PI / 2),
    ),
  ]);
  addInstances(parent, new SphereGeometry(0.034, 7, 5), lambert("#33363a"), [
    transform(snowmanX - 0.1, 0.93, snowmanZ + 0.26),
    transform(snowmanX + 0.1, 0.93, snowmanZ + 0.26),
  ]);
  addInstances(parent, new CylinderGeometry(0.31, 0.33, 0.1, 14), lambert("#c9524a"), [
    transform(snowmanX, 0.63, snowmanZ),
  ]);
  return lampMaterial;
}

/** 병원 둘레의 땅, 정원, 숲, 먼 산이에요. */
export function buildLandscape(parent: Object3D, options: LandscapeOptions): LandscapeHandles {
  // 땅은 실내 조명의 영향을 받지 않도록 시간대별 색을 직접 정해요.
  const ground = new MeshBasicMaterial({ color: "#ffffff" });
  const groundGeometry = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
  groundGeometry.rotateX(-Math.PI / 2);
  const groundMesh = new Mesh(groundGeometry, ground);
  groundMesh.position.y = GROUND_Y;
  parent.add(groundMesh);

  const ridges = buildRidges(parent, options.ridgeSegments);
  buildForest(parent, options.forestTrees);
  const gardenLamp = buildGarden(parent);
  return { ground, ridges, gardenLamp };
}
