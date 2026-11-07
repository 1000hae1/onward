import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import type { Object3D } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { BUILDING, ENTRANCE_GARDENS, ROOMS, YARD, YARD_LAMPS } from "../../shared/ward-layout";
import { addInstances, createRandom, repeatAt, transform } from "./parts";

/** 정원 안 자리는 화단 크기에 대한 비율이에요. 나무는 [가로, 세로, 크기]예요. */
const GARDEN_TREE_SPOTS = [
  [0.3, 0.2, 1.45],
  [0.75, 0.68, 1.05],
  [0.22, 0.78, 0.9],
] as const;
const CAMELLIA_SPOTS = [
  [0.58, 0.2],
  [0.82, 0.32],
  [0.5, 0.48],
  [0.17, 0.5],
  [0.5, 0.86],
] as const;
const GARDEN_ROCK_SPOTS = [
  [0.72, 0.5, 0.34],
  [0.33, 0.62, 0.26],
  [0.82, 0.86, 0.3],
] as const;

const GROUND_Y = -0.12;
const GROUND_SIZE = 900;
/** 건물 둘레의 정원 자리예요. 이 안에는 숲의 큰 나무를 심지 않아요. */
const GARDEN = { minX: -36, maxX: 36, minZ: -28, maxZ: 62 };
const FOREST_MIN_RADIUS = 24;
const SIDE_PATH_X = BUILDING.maxX + 4;
const POND = { x: SIDE_PATH_X + 11, z: -2 };
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
  return !(x > GARDEN.minX && x < GARDEN.maxX && z > GARDEN.minZ && z < GARDEN.maxZ);
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

/** 병실 창밖과 앞마당이에요. 산책로, 얼어붙은 연못, 벤치, 가로등, 눈사람이 있어요. */
function buildGarden(parent: Object3D): MeshBasicMaterial {
  const addFlat = (geometry: BufferGeometry, color: string, x: number, y: number, z: number): void => {
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, lambert(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
  };

  const pathColor = "#d6d4cf";
  const gardenZ = (BUILDING.minZ + BUILDING.maxZ) / 2;
  const gardenLength = BUILDING.maxZ - BUILDING.minZ + 8;
  // 건물 양옆을 따라 난 산책로예요. 병실 창에서 내다보여요.
  addFlat(new PlaneGeometry(1.7, gardenLength), pathColor, SIDE_PATH_X, -0.08, gardenZ);
  addFlat(new PlaneGeometry(1.7, gardenLength), pathColor, -SIDE_PATH_X, -0.08, gardenZ);
  // 현관으로 이어지는 진입로와 앞마당이에요.
  addFlat(
    new PlaneGeometry(YARD.maxX - YARD.minX, YARD.maxZ - YARD.minZ),
    "#e6e6e2",
    0,
    -0.09,
    (YARD.minZ + YARD.maxZ) / 2,
  );
  addFlat(new PlaneGeometry(4.4, 44), pathColor, 0, -0.08, YARD.minZ + 22);

  // 오른쪽 창밖의 얼어붙은 연못이에요.
  addFlat(new CircleGeometry(6.5, 28), "#b5d0dc", POND.x, -0.08, POND.z);
  addFlat(new CircleGeometry(7.2, 28), "#e9eef0", POND.x, -0.09, POND.z);

  addConifers(parent, [
    [-21, -8, 2.4],
    [-26, 3, 2.8],
    [-20, 11, 2.3],
    [-29, -15, 3],
    [-24, 22, 2.8],
    [20, -11, 2.5],
    [29, 8, 2.9],
    [21, 14, 2.2],
    [30, -18, 3.1],
    [24, 24, 2.7],
    [-15, 30, 3],
    [15, 32, 3.2],
    [-14, 40, 2.6],
    [14, 41, 2.8],
    [-22, 46, 3.4],
    [23, 48, 3.3],
    [-13, 22, 2.4],
    [13, 23, 2.5],
    [-8, -22, 2.8],
    [9, -24, 3],
  ]);
  addInstances(parent, new SphereGeometry(1, 12, 8), lambert("#f1f5f6"), [
    transform(-24, -0.12, -3, 0, 5, 0.9, 4),
    transform(32, -0.12, 18, 0, 6, 1.1, 4),
    transform(-17, -0.12, 36, 0, 4, 0.7, 3),
    transform(17, -0.12, 27, 0, 4, 0.7, 3),
    transform(0, -0.12, -18, 0, 7, 1, 3),
  ]);

  // 앞마당을 두르는 낮은 울타리예요. 걸을 수 있는 곳의 경계이기도 해요.
  const hedges: Matrix4[] = [
    ...[19.4, 24.2, 29, 33.8, 38.6].flatMap((z) => [
      transform(YARD.minX - 0.5, 0.28, z, Math.PI / 2),
      transform(YARD.maxX + 0.5, 0.28, z, Math.PI / 2),
    ]),
    transform(-6.5, 0.28, YARD.maxZ + 0.5),
    transform(6.5, 0.28, YARD.maxZ + 0.5),
    transform(-11.5, 0.28, 18.6),
    transform(11.5, 0.28, 18.6),
    // 병실 창밖 산책로 옆
    ...[-8, -2, 4, 10].flatMap((z) => [
      transform(-SIDE_PATH_X - 2, 0.28, z, Math.PI / 2),
      transform(SIDE_PATH_X + 2, 0.28, z, Math.PI / 2),
    ]),
  ];
  addInstances(parent, new RoundedBoxGeometry(4.6, 0.6, 0.7, 2, 0.2), lambert("#6c8d78"), hedges);
  addInstances(
    parent,
    new RoundedBoxGeometry(4.7, 0.16, 0.8, 2, 0.08),
    lambert("#f6f9fa"),
    hedges.map((matrix) => transform(0, 0.33, 0).premultiply(matrix)),
  );

  // 벤치
  const benches: Matrix4[] = [
    ...[-7, 7].flatMap((z) => [
      transform(-SIDE_PATH_X - 1.2, 0, z, Math.PI / 2),
      transform(SIDE_PATH_X + 1.2, 0, z, -Math.PI / 2),
    ]),
    transform(-7, 0, 29, Math.PI / 2),
    transform(7, 0, 29, -Math.PI / 2),
    transform(-7, 0, 34, Math.PI / 2),
    transform(7, 0, 34, -Math.PI / 2),
  ];
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
  const lampSpots: Matrix4[] = [
    ...[-14, -4, 4, 14].flatMap((z) => [
      transform(-SIDE_PATH_X + 1.3, 0, z),
      transform(SIDE_PATH_X - 1.3, 0, z),
    ]),
    ...YARD_LAMPS.map((lamp) => transform(lamp.x, 0, lamp.z)),
  ];
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

  // 302호 창문 앞 눈사람. 창을 바라보고 서 있어요.
  const snowman = [transform(BUILDING.minX - 2.2, 0, ROOMS[1].z + 1.2, Math.PI / 2)];
  addInstances(
    parent,
    new SphereGeometry(1, 14, 10),
    lambert("#fbfdfe"),
    repeatAt(snowman, [transform(0, 0.32, 0, 0, 0.42), transform(0, 0.84, 0, 0, 0.29)]),
  );
  addInstances(
    parent,
    new ConeGeometry(0.05, 0.22, 7),
    lambert("#ee8a2c"),
    repeatAt(snowman, [transform(0, 0.85, 0.3).multiply(new Matrix4().makeRotationX(Math.PI / 2))]),
  );
  addInstances(
    parent,
    new SphereGeometry(0.034, 7, 5),
    lambert("#33363a"),
    repeatAt(snowman, [transform(-0.1, 0.93, 0.26), transform(0.1, 0.93, 0.26)]),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.31, 0.33, 0.1, 14),
    lambert("#c9524a"),
    repeatAt(snowman, [transform(0, 0.63, 0)]),
  );
  return lampMaterial;
}

/** 현관 양옆의 겨울 정원이에요. 눈 덮인 화단에 소나무, 빨간 동백, 바위, 석등이 있어요. */
function buildEntranceGardens(
  parent: Object3D,
  ground: MeshBasicMaterial,
  lamp: MeshBasicMaterial,
): void {
  const at = (bed: (typeof ENTRANCE_GARDENS)[number], u: number, v: number): [number, number] => {
    // 양쪽 화단이 현관을 사이에 두고 대칭이 되도록 현관 쪽에서부터 재요.
    const width = bed.maxX - bed.minX;
    const x = bed.minX > 0 ? bed.minX + width * u : bed.maxX - width * u;
    return [x, bed.minZ + (bed.maxZ - bed.minZ) * v];
  };

  // 눈 덮인 화단. 시간대마다 땅과 같은 색으로 보여요.
  addInstances(
    parent,
    new CylinderGeometry(1, 1, 0.3, 32),
    ground,
    ENTRANCE_GARDENS.map((bed) =>
      transform(
        (bed.minX + bed.maxX) / 2,
        0.03,
        (bed.minZ + bed.maxZ) / 2,
        0,
        (bed.maxX - bed.minX) / 2,
        1,
        (bed.maxZ - bed.minZ) / 2,
      ),
    ),
  );

  // 화단 둘레의 돌
  const random = createRandom(41);
  const edgeStones: Matrix4[] = [];
  for (const bed of ENTRANCE_GARDENS) {
    const centerX = (bed.minX + bed.maxX) / 2;
    const centerZ = (bed.minZ + bed.maxZ) / 2;
    const stones = 30;
    for (let index = 0; index < stones; index++) {
      const angle = (index / stones) * Math.PI * 2;
      edgeStones.push(
        transform(
          centerX + Math.cos(angle) * (bed.maxX - bed.minX) * 0.5,
          0.07,
          centerZ + Math.sin(angle) * (bed.maxZ - bed.minZ) * 0.5,
          random() * Math.PI,
          0.2 + random() * 0.08,
          0.13,
          0.17,
        ),
      );
    }
  }
  addInstances(parent, new IcosahedronGeometry(1, 0), lambert("#9fa3a4", true), edgeStones);

  addConifers(
    parent,
    ENTRANCE_GARDENS.flatMap((bed) =>
      GARDEN_TREE_SPOTS.map(([u, v, scale]) => [...at(bed, u, v), scale] as const),
    ),
  );

  // 겨울에 피는 빨간 동백 덤불
  const bushes = ENTRANCE_GARDENS.flatMap((bed) =>
    CAMELLIA_SPOTS.map(([u, v]) => at(bed, u, v)),
  );
  addInstances(
    parent,
    new SphereGeometry(0.42, 10, 7),
    lambert("#3f7654"),
    bushes.map(([x, z]) => transform(x, 0.42, z, 0, 1, 0.9, 1)),
  );
  const flowers: Matrix4[] = bushes.flatMap(([x, z]) =>
    Array.from({ length: 7 }, () => {
      const angle = random() * Math.PI * 2;
      const lift = 0.15 + random() * 0.7;
      const ring = Math.sqrt(Math.max(0, 1 - lift * lift)) * 0.42;
      return transform(x + Math.cos(angle) * ring, 0.42 + lift * 0.38, z + Math.sin(angle) * ring);
    }),
  );
  addInstances(parent, new SphereGeometry(0.055, 7, 5), lambert("#d33a3f"), flowers);

  // 눈 쌓인 바위
  const rocks = ENTRANCE_GARDENS.flatMap((bed) =>
    GARDEN_ROCK_SPOTS.map(([u, v, size]) => [...at(bed, u, v), size] as const),
  );
  addInstances(
    parent,
    new IcosahedronGeometry(1, 0),
    lambert("#8e9396", true),
    rocks.map(([x, z, size]) => transform(x, size * 0.5, z, x, size, size * 0.75, size)),
  );
  addInstances(
    parent,
    new SphereGeometry(1, 10, 6),
    lambert("#f7fafb"),
    rocks.map(([x, z, size]) => transform(x, size * 0.98, z, x, size * 0.72, size * 0.2, size * 0.72)),
  );

  // 화단마다 하나씩 놓은 석등. 저녁이 되면 불이 들어와요.
  const lanterns = ENTRANCE_GARDENS.map((bed) => {
    const [x, z] = at(bed, 0.12, 0.2);
    return transform(x, 0, z);
  });
  const stone = lambert("#b6b8b6", true);
  addInstances(
    parent,
    new CylinderGeometry(0.1, 0.14, 0.62, 6),
    stone,
    repeatAt(lanterns, [transform(0, 0.31, 0)]),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.2, 0.2, 0.05, 6),
    stone,
    repeatAt(lanterns, [transform(0, 0.64, 0)]),
  );
  addInstances(
    parent,
    new SphereGeometry(0.13, 10, 8),
    lamp,
    repeatAt(lanterns, [transform(0, 0.79, 0)]),
  );
  addInstances(
    parent,
    new ConeGeometry(0.3, 0.2, 6),
    stone,
    repeatAt(lanterns, [transform(0, 1.02, 0)]),
  );
  addInstances(
    parent,
    new ConeGeometry(0.2, 0.1, 6),
    lambert("#f7fafb", true),
    repeatAt(lanterns, [transform(0, 1.1, 0)]),
  );
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
  buildEntranceGardens(parent, ground, gardenLamp);
  return { ground, ridges, gardenLamp };
}
