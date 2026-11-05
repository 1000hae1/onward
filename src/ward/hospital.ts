import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import type { Matrix4, Object3D } from "three";
import { HOSPITAL_BLOCKS, HOSPITAL_LINKS } from "./layout";
import type { HospitalBlock } from "./layout";
import { addInstances, createRandom, transform } from "./parts";

const FLOOR_HEIGHT = 3.4;
const WINDOW_SPACING = 4;
const WINDOW_WIDTH = 2.4;
const WINDOW_HEIGHT = 1.6;

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

function blockBox(block: HospitalBlock): Matrix4 {
  return transform(
    (block.minX + block.maxX) / 2,
    block.height / 2,
    (block.minZ + block.maxZ) / 2,
    0,
    block.maxX - block.minX,
    block.height,
    block.maxZ - block.minZ,
  );
}

/** 한 면의 창문 자리를 층과 칸마다 계산해요. rotationY는 창이 바라보는 방향이에요. */
function windowsOnFace(
  from: number,
  to: number,
  floors: number,
  place: (along: number, y: number) => Matrix4,
): Matrix4[] {
  const matrices: Matrix4[] = [];
  for (let floor = 0; floor < floors; floor++) {
    const y = FLOOR_HEIGHT * (floor + 0.55);
    for (let along = from + WINDOW_SPACING / 2; along < to; along += WINDOW_SPACING) {
      matrices.push(place(along, y));
    }
  }
  return matrices;
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
    context.fillText("onWard", canvas.width / 2, canvas.height / 2 + 4);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 병동을 둘러싼 본관과 별관이에요. 창마다 그리지 않고 한 번에 그려서 가벼워요. */
export function buildHospital(parent: Object3D): HospitalHandles {
  const unitBox = new BoxGeometry(1, 1, 1);
  const blocks = [...HOSPITAL_BLOCKS, ...HOSPITAL_LINKS];
  addInstances(
    parent,
    unitBox,
    new MeshLambertMaterial({ color: "#e8e6df" }),
    blocks.map(blockBox),
  );
  // 지붕에 쌓인 눈이에요.
  addInstances(
    parent,
    unitBox,
    new MeshLambertMaterial({ color: "#f7fafb" }),
    blocks.map((block) =>
      transform(
        (block.minX + block.maxX) / 2,
        block.height + 0.12,
        (block.minZ + block.maxZ) / 2,
        0,
        block.maxX - block.minX + 0.4,
        0.24,
        block.maxZ - block.minZ + 0.4,
      ),
    ),
  );

  const [main, leftWing, rightWing] = HOSPITAL_BLOCKS;
  const mainFloors = Math.floor(main.height / FLOOR_HEIGHT);
  const wingFloors = Math.floor(leftWing.height / FLOOR_HEIGHT);
  // 안뜰을 향한 세 면에 창을 내요. 바깥쪽 면은 카메라에서 보이지 않아요.
  const windows = [
    ...windowsOnFace(main.minX, main.maxX, mainFloors, (along, y) =>
      transform(along, y, main.minZ - 0.05, Math.PI),
    ),
    ...windowsOnFace(leftWing.minZ, leftWing.maxZ - 2, wingFloors, (along, y) =>
      transform(leftWing.maxX + 0.05, y, along, Math.PI / 2),
    ),
    ...windowsOnFace(rightWing.minZ, rightWing.maxZ - 2, wingFloors, (along, y) =>
      transform(rightWing.minX - 0.05, y, along, -Math.PI / 2),
    ),
  ];

  const random = createRandom(3);
  const dark: Matrix4[] = [];
  const eveningOnly: Matrix4[] = [];
  const allNight: Matrix4[] = [];
  for (const matrix of windows) {
    const roll = random();
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

  // 본관 정면의 현관 지붕과 이름표예요. 실제 병원의 이름이나 표장은 쓰지 않아요.
  addInstances(parent, unitBox, new MeshLambertMaterial({ color: "#c9cdd0" }), [
    transform(0, 4.2, main.minZ - 3, 0, 16, 0.4, 6),
    transform(-7, 2, main.minZ - 5.4, 0, 0.5, 4, 0.5),
    transform(7, 2, main.minZ - 5.4, 0, 0.5, 4, 0.5),
  ]);
  const sign = new Mesh(
    new PlaneGeometry(20, 5),
    new MeshBasicMaterial({ map: createSignTexture() }),
  );
  sign.position.set(0, main.height - 2.2, main.minZ - 0.1);
  sign.rotation.y = Math.PI;
  parent.add(sign);

  return { windowDark, windowEveningOnly, windowAllNight };
}
