import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import type { BufferGeometry, Matrix4, Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BUILDING, BUILDING_HEIGHT, ENTRANCE, FLOOR_COUNT, FLOOR_HEIGHT } from "../../shared/ward-layout";
import { facadeWindowCenters, mirrorPairIndex } from "./facade-windows";
import { addInstances, createRandom, transform } from "./parts";

const WINDOW_SPACING = 3.6;
const WINDOW_WIDTH = 2.2;
const WINDOW_HEIGHT = 1.6;
const CANOPY_HALF_WIDTH = 4;
const CANOPY_Y = 3.5;

/** 저녁에는 불이 켜지고 소등 뒤에는 꺼지는 창의 비율이에요. */
const EVENING_ONLY_RATIO = 0.42;
/** 밤새 불이 켜져 있는 창의 비율이에요. */
const ALL_NIGHT_RATIO = 0.16;

export interface HospitalHandles {
  /** 불이 꺼진 창이에요. */
  windowDark: MeshBasicMaterial;
  windowEveningOnly: MeshBasicMaterial;
  windowAllNight: MeshBasicMaterial;
}

function outerWall(
  x: number,
  z: number,
  width: number,
  bottom: number,
  top: number,
  rotationY: number,
): BufferGeometry {
  const geometry = new PlaneGeometry(width, top - bottom);
  geometry.applyMatrix4(transform(x, (bottom + top) / 2, z, rotationY));
  return geometry;
}

/** 창 바깥 끝에서 건물 모서리까지 남기는 벽이에요. */
const WINDOW_MARGIN = 0.6;

interface FacadeWindow {
  matrix: Matrix4;
  /** 불 켜짐을 함께 정하는 창끼리 같은 값이에요. 좌우로 마주 보는 창이 같은 값을 가져요. */
  key: string;
}

/**
 * 한 면의 창문 자리를 층과 칸마다 계산해요. 창은 벽 가운데를 기준으로 대칭이고
 * 벽 모서리 밖으로 나가지 않아요.
 */
function windowsOnFace(
  from: number,
  to: number,
  keyOf: (floor: number, index: number, count: number) => string,
  place: (along: number, y: number, floor: number) => Matrix4 | null,
): FacadeWindow[] {
  const centers = facadeWindowCenters(from, to, {
    spacing: WINDOW_SPACING,
    width: WINDOW_WIDTH,
    margin: WINDOW_MARGIN,
  });
  const windows: FacadeWindow[] = [];
  for (let floor = 0; floor < FLOOR_COUNT; floor++) {
    const y = FLOOR_HEIGHT * (floor + 0.52);
    centers.forEach((along, index) => {
      const matrix = place(along, y, floor);
      if (matrix) windows.push({ matrix, key: keyOf(floor, index, centers.length) });
    });
  }
  return windows;
}

function createSignTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#3f6f6b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fbfaf4";
    context.font = '600 74px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("온기병동", canvas.width / 2, canvas.height / 2 + 4);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * 밖에서 보이는 병원 건물이에요. 바깥벽은 바깥에서만 보이는 면이라,
 * 병실 안에서는 벽에 가리지 않고 창밖 풍경이 그대로 보여요.
 */
export function buildHospital(parent: Object3D): HospitalHandles {
  const width = BUILDING.maxX - BUILDING.minX;
  const depth = BUILDING.maxZ - BUILDING.minZ;
  const centerZ = (BUILDING.minZ + BUILDING.maxZ) / 2;
  const top = BUILDING_HEIGHT;

  const entranceWidth = ENTRANCE.maxX - ENTRANCE.minX;
  const frontSide = BUILDING.maxX - ENTRANCE.maxX;
  const walls = mergeGeometries([
    // 현관 자리를 비운 앞면
    outerWall((BUILDING.minX + ENTRANCE.minX) / 2, BUILDING.maxZ, frontSide, 0, top, 0),
    outerWall((BUILDING.maxX + ENTRANCE.maxX) / 2, BUILDING.maxZ, frontSide, 0, top, 0),
    outerWall(0, BUILDING.maxZ, entranceWidth, ENTRANCE.height, top, 0),
    // 뒷면과 양옆
    outerWall(0, BUILDING.minZ, width, 0, top, Math.PI),
    outerWall(BUILDING.minX, centerZ, depth, 0, top, -Math.PI / 2),
    outerWall(BUILDING.maxX, centerZ, depth, 0, top, Math.PI / 2),
  ]);
  parent.add(new Mesh(walls, new MeshLambertMaterial({ color: "#eceae3" })));

  const box = new BoxGeometry(1, 1, 1);
  // 눈 덮인 지붕이에요. 천장 아래에서는 보이지 않아요.
  addInstances(parent, box, new MeshLambertMaterial({ color: "#f7fafb" }), [
    transform(0, top + 0.15, centerZ, 0, width + 0.6, 0.3, depth + 0.6),
  ]);
  // 층을 나누는 가로띠예요.
  const bands: Matrix4[] = [];
  for (let floor = 1; floor < FLOOR_COUNT; floor++) {
    const y = floor * FLOOR_HEIGHT;
    bands.push(transform(0, y, BUILDING.maxZ + 0.04, 0, width, 0.14, 0.08));
    bands.push(transform(0, y, BUILDING.minZ - 0.04, 0, width, 0.14, 0.08));
    bands.push(transform(BUILDING.minX - 0.04, y, centerZ, 0, 0.08, 0.14, depth));
    bands.push(transform(BUILDING.maxX + 0.04, y, centerZ, 0, 0.08, 0.14, depth));
  }
  addInstances(parent, box, new MeshLambertMaterial({ color: "#c9cdd0" }), bands);

  // 앞뒷면은 가운데를 사이에 둔 창끼리, 양옆면은 서로 마주 보는 창끼리 불이 함께 켜져요.
  const mirrored = (face: string) => (floor: number, index: number, count: number): string =>
    `${face}:${floor}:${mirrorPairIndex(index, count)}`;
  const sides = (floor: number, index: number): string => `side:${floor}:${index}`;
  const windows = [
    ...windowsOnFace(BUILDING.minX, BUILDING.maxX, mirrored("front"), (along, y, floor) =>
      floor === 0 && Math.abs(along) < CANOPY_HALF_WIDTH + WINDOW_WIDTH / 2
        ? null
        : transform(along, y, BUILDING.maxZ + 0.02, 0),
    ),
    ...windowsOnFace(BUILDING.minX, BUILDING.maxX, mirrored("back"), (along, y) =>
      transform(along, y, BUILDING.minZ - 0.02, Math.PI),
    ),
    ...windowsOnFace(BUILDING.minZ, BUILDING.maxZ, sides, (along, y) =>
      transform(BUILDING.minX - 0.02, y, along, -Math.PI / 2),
    ),
    ...windowsOnFace(BUILDING.minZ, BUILDING.maxZ, sides, (along, y) =>
      transform(BUILDING.maxX + 0.02, y, along, Math.PI / 2),
    ),
  ];

  const random = createRandom(3);
  const rolls = new Map<string, number>();
  const dark: Matrix4[] = [];
  const eveningOnly: Matrix4[] = [];
  const allNight: Matrix4[] = [];
  for (const { matrix, key } of windows) {
    let roll = rolls.get(key);
    if (roll === undefined) {
      roll = random();
      rolls.set(key, roll);
    }
    if (roll < ALL_NIGHT_RATIO) allNight.push(matrix);
    else if (roll < ALL_NIGHT_RATIO + EVENING_ONLY_RATIO) eveningOnly.push(matrix);
    else dark.push(matrix);
  }

  const windowGeometry = new PlaneGeometry(WINDOW_WIDTH, WINDOW_HEIGHT);
  const windowDark = new MeshBasicMaterial();
  const windowEveningOnly = new MeshBasicMaterial();
  const windowAllNight = new MeshBasicMaterial();
  addInstances(parent, windowGeometry, windowDark, dark);
  addInstances(parent, windowGeometry, windowEveningOnly, eveningOnly);
  addInstances(parent, windowGeometry, windowAllNight, allNight);

  // 현관 지붕과 기둥이에요.
  const canopyDepth = 3.2;
  addInstances(parent, box, new MeshLambertMaterial({ color: "#c9cdd0" }), [
    transform(0, CANOPY_Y, BUILDING.maxZ + canopyDepth / 2, 0, CANOPY_HALF_WIDTH * 2, 0.3, canopyDepth),
    transform(-CANOPY_HALF_WIDTH + 0.4, CANOPY_Y / 2, BUILDING.maxZ + canopyDepth - 0.3, 0, 0.3, CANOPY_Y, 0.3),
    transform(CANOPY_HALF_WIDTH - 0.4, CANOPY_Y / 2, BUILDING.maxZ + canopyDepth - 0.3, 0, 0.3, CANOPY_Y, 0.3),
  ]);
  addInstances(parent, box, new MeshLambertMaterial({ color: "#f7fafb" }), [
    transform(0, CANOPY_Y + 0.2, BUILDING.maxZ + canopyDepth / 2, 0, CANOPY_HALF_WIDTH * 2 + 0.1, 0.12, canopyDepth + 0.1),
  ]);

  // 이름표예요. 실제 병원의 이름이나 표장은 쓰지 않아요.
  const sign = new Mesh(
    new PlaneGeometry(7, 1.75),
    new MeshBasicMaterial({ map: createSignTexture() }),
  );
  sign.position.set(0, FLOOR_HEIGHT + 1.6, BUILDING.maxZ + 0.1);
  parent.add(sign);

  return { windowDark, windowEveningOnly, windowAllNight };
}
