import {
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
} from "three";
import type { BufferGeometry, Material, Matrix4, Object3D, Texture } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BED_LENGTH,
  BED_WIDTH,
  BEDS,
  CORRIDOR,
  DOOR,
  ELEVATOR_HALL,
  FRIDGE_DEPTH,
  FRIDGE_HEIGHT,
  FRIDGE_WIDTH,
  FRIDGES,
  IV_POLE_HEIGHT,
  IV_STAND_RADIUS,
  IV_STANDS,
  IV_TUBE_REACH,
  NIGHTSTAND_HEIGHT,
  NIGHTSTAND_SIZE,
  NIGHTSTANDS,
  NURSE_STATION,
  ROOM,
  ROOMS,
  TABLE_HEIGHT,
  TABLE_RADIUS,
  TABLES,
  WALL_HEIGHT,
  WINDOW,
} from "./layout";
import type { Rect, WardRoom } from "./layout";
import { addInstances, repeatAt, transform } from "./parts";

const SHADOW_Y = 0.012;
const FOUNDATION_Y = -0.03;
const WALLPAPER_COLOR = "#ffffff";
const BED_FRAME_COLOR = "#f3e8d2";
const FURNITURE_COLOR = "#f4efe5";
const TRIM_COLOR = "#dfdcd5";

const lambert = (color: string): MeshLambertMaterial => new MeshLambertMaterial({ color });

/** 같은 구성을 병실마다 반복해요. */
const inEveryRoom = (locals: readonly Matrix4[]): Matrix4[] =>
  repeatAt(ROOMS.map((room) => transform(room.x, 0, 0)), locals);

export interface RoomHandles {
  /** 시간대에 따라 밝기가 바뀌는 재질들이에요. */
  ceilingPanel: MeshBasicMaterial;
  sleepLamp: MeshBasicMaterial;
  windowGlass: MeshBasicMaterial;
}

/** 벽 한 면이에요. u는 벽을 따라가는 좌표이고, 안쪽에서만 보이는 면으로 만들어요. */
interface WallSide {
  place(u: number): { x: number; z: number };
  rotationY: number;
}

const farWall = (roomX: number): WallSide => ({
  place: (u) => ({ x: roomX + u, z: ROOM.minZ }),
  rotationY: 0,
});
const nearWall = (roomX: number): WallSide => ({
  place: (u) => ({ x: roomX + u, z: ROOM.maxZ }),
  rotationY: Math.PI,
});
const leftWall = (roomX: number): WallSide => ({
  place: (u) => ({ x: roomX + ROOM.minX, z: u }),
  rotationY: Math.PI / 2,
});
const rightWall = (roomX: number): WallSide => ({
  place: (u) => ({ x: roomX + ROOM.maxX, z: u }),
  rotationY: -Math.PI / 2,
});

const CORRIDOR_BACK: WallSide = {
  place: (u) => ({ x: u, z: CORRIDOR.maxZ }),
  rotationY: Math.PI,
};
const CORRIDOR_LEFT: WallSide = {
  place: (u) => ({ x: CORRIDOR.minX, z: u }),
  rotationY: Math.PI / 2,
};
const CORRIDOR_RIGHT: WallSide = {
  place: (u) => ({ x: CORRIDOR.maxX, z: u }),
  rotationY: -Math.PI / 2,
};

function wallPiece(
  side: WallSide,
  u1: number,
  u2: number,
  y1: number,
  y2: number,
): BufferGeometry {
  const { x, z } = side.place((u1 + u2) / 2);
  const geometry = new PlaneGeometry(Math.abs(u2 - u1), y2 - y1);
  geometry.applyMatrix4(transform(x, (y1 + y2) / 2, z, side.rotationY));
  return geometry;
}

/** 벽은 안쪽 면만 그려요. 카메라가 벽 바깥으로 나가도 벽이 시야를 가리지 않아요. */
function buildWalls(parent: Object3D): void {
  const pieces: BufferGeometry[] = [];

  for (const room of ROOMS) {
    const far = farWall(room.x);
    const near = nearWall(room.x);
    pieces.push(
      wallPiece(leftWall(room.x), ROOM.minZ, ROOM.maxZ, 0, WALL_HEIGHT),
      wallPiece(rightWall(room.x), ROOM.minZ, ROOM.maxZ, 0, WALL_HEIGHT),
      // 창문 벽
      wallPiece(far, ROOM.minX, ROOM.maxX, 0, WINDOW.minY),
      wallPiece(far, ROOM.minX, WINDOW.minX, WINDOW.minY, WALL_HEIGHT),
      wallPiece(far, WINDOW.maxX, ROOM.maxX, WINDOW.minY, WALL_HEIGHT),
      wallPiece(far, WINDOW.minX, WINDOW.maxX, WINDOW.maxY, WALL_HEIGHT),
      // 출입구 벽
      wallPiece(near, ROOM.minX, DOOR.minX, 0, WALL_HEIGHT),
      wallPiece(near, DOOR.maxX, ROOM.maxX, 0, WALL_HEIGHT),
      wallPiece(near, DOOR.minX, DOOR.maxX, DOOR.height, WALL_HEIGHT),
    );
  }

  // 복도 뒷벽은 간호사실과 엘리베이터 홀 자리만큼 트여 있어요.
  const recessWalls = (rect: Rect): BufferGeometry[] => [
    wallPiece(
      { place: (u) => ({ x: u, z: rect.maxZ }), rotationY: Math.PI },
      rect.minX,
      rect.maxX,
      0,
      WALL_HEIGHT,
    ),
    wallPiece(
      { place: (u) => ({ x: rect.minX, z: u }), rotationY: Math.PI / 2 },
      rect.minZ,
      rect.maxZ,
      0,
      WALL_HEIGHT,
    ),
    wallPiece(
      { place: (u) => ({ x: rect.maxX, z: u }), rotationY: -Math.PI / 2 },
      rect.minZ,
      rect.maxZ,
      0,
      WALL_HEIGHT,
    ),
  ];
  pieces.push(
    wallPiece(CORRIDOR_BACK, CORRIDOR.minX, NURSE_STATION.minX, 0, WALL_HEIGHT),
    wallPiece(CORRIDOR_BACK, NURSE_STATION.maxX, ELEVATOR_HALL.minX, 0, WALL_HEIGHT),
    wallPiece(CORRIDOR_LEFT, CORRIDOR.minZ, CORRIDOR.maxZ, 0, WALL_HEIGHT),
    wallPiece(CORRIDOR_RIGHT, CORRIDOR.minZ, CORRIDOR.maxZ, 0, WALL_HEIGHT),
    ...recessWalls(NURSE_STATION),
    ...recessWalls(ELEVATOR_HALL),
  );

  parent.add(new Mesh(mergeGeometries(pieces), lambert(WALLPAPER_COLOR)));
}

function floorPiece(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y = 0,
): BufferGeometry {
  const geometry = new PlaneGeometry(maxX - minX, maxZ - minZ);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((minX + maxX) / 2, y, (minZ + maxZ) / 2);
  return geometry;
}

function buildFloorsAndCeilings(parent: Object3D): MeshBasicMaterial {
  // 벽이 서는 자리예요. 위에서 볼 때 병실 사이로 바깥이 비치지 않게 막아요.
  parent.add(
    new Mesh(
      mergeGeometries([
        floorPiece(CORRIDOR.minX, CORRIDOR.maxX, ROOM.minZ, CORRIDOR.maxZ, FOUNDATION_Y),
      ]),
      lambert("#ecebe6"),
    ),
  );

  const addMerged = (pieces: BufferGeometry[], color: string): void => {
    parent.add(new Mesh(mergeGeometries(pieces), lambert(color)));
  };
  addMerged(
    ROOMS.map((room) => floorPiece(room.x + ROOM.minX, room.x + ROOM.maxX, ROOM.minZ, ROOM.maxZ)),
    "#d8d4c9",
  );
  addMerged(
    ROOMS.map((room) => floorPiece(room.x + DOOR.minX, room.x + DOOR.maxX, DOOR.minZ, DOOR.maxZ)),
    "#c4c1b8",
  );
  addMerged(
    [
      floorPiece(CORRIDOR.minX, CORRIDOR.maxX, CORRIDOR.minZ, CORRIDOR.maxZ),
      floorPiece(NURSE_STATION.minX, NURSE_STATION.maxX, NURSE_STATION.minZ, NURSE_STATION.maxZ),
      floorPiece(ELEVATOR_HALL.minX, ELEVATOR_HALL.maxX, ELEVATOR_HALL.minZ, ELEVATOR_HALL.maxZ),
    ],
    "#cfcdc6",
  );

  // 천장은 아래에서만 보여요. 위에서 내려다볼 때는 병실 안이 그대로 보여요.
  const ceilingGeometry = new PlaneGeometry(ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ);
  ceilingGeometry.rotateX(Math.PI / 2);
  addInstances(
    parent,
    ceilingGeometry,
    lambert(WALLPAPER_COLOR),
    inEveryRoom([transform(0, WALL_HEIGHT, 0)]),
  );

  const panelMaterial = new MeshBasicMaterial({ color: "#fff3d6" });
  const panelGeometry = new CircleGeometry(0.42, 20);
  panelGeometry.rotateX(Math.PI / 2);
  addInstances(
    parent,
    panelGeometry,
    panelMaterial,
    inEveryRoom([transform(0, WALL_HEIGHT - 0.01, -2.5), transform(0, WALL_HEIGHT - 0.01, 2.5)]),
  );
  return panelMaterial;
}

function buildWindows(parent: Object3D): MeshBasicMaterial {
  const frame = lambert("#eef0f0");
  const width = WINDOW.maxX - WINDOW.minX;
  const height = WINDOW.maxY - WINDOW.minY;
  const centerY = (WINDOW.minY + WINDOW.maxY) / 2;
  const z = ROOM.minZ;

  const rail = new RoundedBoxGeometry(width + 0.2, 0.1, 0.14, 2, 0.04);
  addInstances(
    parent,
    rail,
    frame,
    inEveryRoom([
      transform(0, WINDOW.maxY + 0.02, z),
      transform(0, WINDOW.minY - 0.02, z + 0.04),
    ]),
  );
  const post = new RoundedBoxGeometry(0.1, height, 0.12, 2, 0.04);
  addInstances(
    parent,
    post,
    frame,
    inEveryRoom([
      transform(WINDOW.minX - 0.02, centerY, z),
      transform(WINDOW.maxX + 0.02, centerY, z),
      transform(-0.8, centerY, z, 0, 0.6, 1, 0.8),
      transform(0.8, centerY, z, 0, 0.6, 1, 0.8),
    ]),
  );

  const glassMaterial = new MeshBasicMaterial({
    color: "#dcecf5",
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    fog: false,
  });
  const glass = addInstances(
    parent,
    new PlaneGeometry(width, height),
    glassMaterial,
    inEveryRoom([transform(0, centerY, z - 0.01)]),
  );
  glass.renderOrder = 2;
  return glassMaterial;
}

function createDoorPlateTexture(room: WardRoom): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#5f7480";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fbf3e6";
    context.font = '600 46px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${room.number}호`, canvas.width / 2, canvas.height / 2 + 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function buildDoorways(parent: Object3D): void {
  const trim = lambert(TRIM_COLOR);
  const z = (DOOR.minZ + DOOR.maxZ) / 2;
  const depth = DOOR.maxZ - DOOR.minZ + 0.06;
  addInstances(
    parent,
    new RoundedBoxGeometry(0.12, DOOR.height, depth, 2, 0.04),
    trim,
    inEveryRoom([
      transform(DOOR.minX - 0.05, DOOR.height / 2, z),
      transform(DOOR.maxX + 0.05, DOOR.height / 2, z),
    ]),
  );
  addInstances(
    parent,
    new RoundedBoxGeometry(DOOR.maxX - DOOR.minX + 0.22, 0.12, depth, 2, 0.04),
    trim,
    inEveryRoom([transform(0, DOOR.height + 0.03, z)]),
  );

  // 문 위 복도 쪽에 병실 번호를 달아요. 소등 뒤에도 읽히도록 조명의 영향을 받지 않아요.
  const plateGeometry = new PlaneGeometry(0.72, 0.3);
  for (const room of ROOMS) {
    const plate = new Mesh(
      plateGeometry,
      new MeshBasicMaterial({ map: createDoorPlateTexture(room) }),
    );
    plate.position.set(room.x, DOOR.height + 0.21, DOOR.maxZ + 0.05);
    parent.add(plate);
  }

  // 복도 손잡이
  const rail = (fromX: number, toX: number): Matrix4 =>
    transform((fromX + toX) / 2, 0.9, CORRIDOR.maxZ - 0.06, 0, toX - fromX, 1, 1);
  addInstances(parent, new RoundedBoxGeometry(1, 0.07, 0.08, 1, 0.03), lambert("#c9cdd0"), [
    rail(CORRIDOR.minX + 0.15, NURSE_STATION.minX - 0.15),
    rail(NURSE_STATION.maxX + 0.15, ELEVATOR_HALL.minX - 0.15),
  ]);
}

function buildBeds(parent: Object3D): void {
  const bases = BEDS.map((bed) => transform(bed.x, 0, bed.z, bed.rotationY));
  const part = (geometry: BufferGeometry, material: Material, locals: Matrix4[]): void => {
    addInstances(parent, geometry, material, repeatAt(bases, locals));
  };
  const frame = lambert(BED_FRAME_COLOR);

  // 한 침대의 머리는 -x 쪽이에요.
  part(new RoundedBoxGeometry(BED_LENGTH, 0.2, BED_WIDTH, 2, 0.07), frame, [transform(0, 0.36, 0)]);
  part(new RoundedBoxGeometry(0.1, 0.3, 0.1, 2, 0.04), frame, [
    transform(-0.92, 0.14, -0.4),
    transform(-0.92, 0.14, 0.4),
    transform(0.92, 0.14, -0.4),
    transform(0.92, 0.14, 0.4),
  ]);
  part(new RoundedBoxGeometry(BED_LENGTH - 0.12, 0.17, BED_WIDTH - 0.08, 3, 0.08), lambert("#e4e2dc"), [
    transform(0, 0.52, 0),
  ]);
  part(new RoundedBoxGeometry(1.32, 0.13, BED_WIDTH - 0.02, 3, 0.06), lambert("#ffffff"), [
    transform(0.3, 0.58, 0),
  ]);
  part(new RoundedBoxGeometry(0.44, 0.14, 0.66, 3, 0.07), lambert("#ffffff"), [
    transform(-0.68, 0.66, 0),
  ]);
  part(new RoundedBoxGeometry(0.09, 0.82, BED_WIDTH, 2, 0.04), frame, [
    transform(-BED_LENGTH / 2 + 0.03, 0.56, 0),
  ]);
  part(new RoundedBoxGeometry(0.09, 0.56, BED_WIDTH, 2, 0.04), frame, [
    transform(BED_LENGTH / 2 - 0.03, 0.42, 0),
  ]);
}

function buildNightstands(parent: Object3D): MeshBasicMaterial {
  const bases = NIGHTSTANDS.map((stand) => transform(stand.x, 0, stand.z, stand.rotationY));
  addInstances(
    parent,
    new RoundedBoxGeometry(NIGHTSTAND_SIZE, NIGHTSTAND_HEIGHT, NIGHTSTAND_SIZE, 2, 0.05),
    lambert(FURNITURE_COLOR),
    repeatAt(bases, [transform(0, NIGHTSTAND_HEIGHT / 2, 0)]),
  );

  // 머리맡 벽에 수면등을 달아요.
  const lampMaterial = new MeshBasicMaterial({ color: "#ffc27a" });
  const lampGeometry = new SphereGeometry(0.075, 12, 8);
  addInstances(
    parent,
    lampGeometry,
    lampMaterial,
    BEDS.map((bed, index) => {
      const wallOffset = bed.index < 3 ? ROOM.minX + 0.07 : ROOM.maxX - 0.07;
      return transform(ROOMS[bed.roomIndex].x + wallOffset, 1.3, NIGHTSTANDS[index].z);
    }),
  );
  return lampMaterial;
}

function buildTables(parent: Object3D): void {
  const top = lambert(FURNITURE_COLOR);
  const stand = lambert("#c9cdd0");
  addInstances(
    parent,
    new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS - 0.03, 0.05, 24),
    top,
    inEveryRoom([transform(0, TABLE_HEIGHT - 0.025, 0)]),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.05, 0.06, TABLE_HEIGHT - 0.05, 10),
    stand,
    inEveryRoom([transform(0, (TABLE_HEIGHT - 0.05) / 2, 0)]),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.26, 0.3, 0.04, 18),
    stand,
    inEveryRoom([transform(0, 0.02, 0)]),
  );
}

/** 병실마다 한 대씩 있는 작은 냉장고예요. 문은 통로 쪽(-x)을 봐요. */
function buildFridges(parent: Object3D): void {
  const bases = FRIDGES.map((fridge) => transform(fridge.x, 0, fridge.z));
  const frontX = -FRIDGE_DEPTH / 2;
  const seamY = FRIDGE_HEIGHT * 0.68;

  addInstances(
    parent,
    new RoundedBoxGeometry(FRIDGE_DEPTH, FRIDGE_HEIGHT, FRIDGE_WIDTH, 3, 0.05),
    lambert("#d7dcdf"),
    repeatAt(bases, [transform(0, FRIDGE_HEIGHT / 2, 0)]),
  );
  // 위 칸과 아래 칸을 나누는 틈이에요.
  addInstances(
    parent,
    new RoundedBoxGeometry(0.02, 0.018, FRIDGE_WIDTH - 0.02, 1, 0.006),
    lambert("#7f878d"),
    repeatAt(bases, [transform(frontX, seamY, 0)]),
  );
  // 칸마다 세로 손잡이가 하나씩 있어요.
  const handleZ = FRIDGE_WIDTH / 2 - 0.08;
  addInstances(
    parent,
    new RoundedBoxGeometry(0.035, 0.26, 0.035, 2, 0.015),
    lambert("#8d959b"),
    repeatAt(bases, [
      transform(frontX - 0.015, seamY - 0.2, handleZ),
      transform(frontX - 0.015, seamY + 0.17, handleZ, 0, 1, 0.55, 1),
    ]),
  );
}

/** 침대마다 있는 링거예요. 폴대에 수액 팩을 걸고, 줄은 local +x 방향의 침대 위로 내려와요. */
function buildIvStands(parent: Object3D): void {
  const bases = IV_STANDS.map((stand) => transform(stand.x, 0, stand.z, stand.rotationY));
  const metal = lambert("#b4bbc1");
  const bagY = IV_POLE_HEIGHT - 0.2;
  const bagX = 0.09;
  const dripY = bagY - 0.16;

  addInstances(
    parent,
    new CylinderGeometry(IV_STAND_RADIUS * 0.8, IV_STAND_RADIUS, 0.04, 10),
    lambert("#9099a0"),
    repeatAt(bases, [transform(0, 0.03, 0)]),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.016, 0.016, IV_POLE_HEIGHT, 8),
    metal,
    repeatAt(bases, [transform(0, IV_POLE_HEIGHT / 2, 0)]),
  );
  // 수액 팩을 거는 가로대예요.
  addInstances(
    parent,
    new RoundedBoxGeometry(bagX + 0.05, 0.018, 0.018, 1, 0.006),
    metal,
    repeatAt(bases, [transform(bagX / 2, IV_POLE_HEIGHT - 0.04, 0)]),
  );
  addInstances(
    parent,
    new RoundedBoxGeometry(0.11, 0.2, 0.045, 3, 0.02),
    lambert("#a9dbea"),
    repeatAt(bases, [transform(bagX, bagY, 0)]),
  );
  // 수액 방울이 떨어지는 작은 통이에요.
  addInstances(
    parent,
    new CylinderGeometry(0.014, 0.014, 0.07, 8),
    lambert("#e4f3f7"),
    repeatAt(bases, [transform(bagX, dripY, 0)]),
  );

  const tubePath = new CatmullRomCurve3([
    new Vector3(bagX, dripY - 0.03, 0),
    new Vector3(bagX + 0.06, 1.05, 0),
    new Vector3(IV_TUBE_REACH * 0.62, 0.78, 0),
    new Vector3(IV_TUBE_REACH, 0.655, 0),
  ]);
  addInstances(
    parent,
    new TubeGeometry(tubePath, 12, 0.006, 5),
    lambert("#eef6f8"),
    repeatAt(bases, [transform(0, 0, 0)]),
  );
}

/** 가구 아래 바닥에 깔리는 부드러운 그림자예요. 실시간 그림자보다 훨씬 가벼워요. */
function buildContactShadows(parent: Object3D, softCircle: Texture): void {
  const material = new MeshBasicMaterial({
    map: softCircle,
    color: "#3a2a1c",
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  addInstances(parent, geometry, material, [
    ...BEDS.map((bed) => transform(bed.x, SHADOW_Y, bed.z, 0, BED_LENGTH + 0.8, 1, BED_WIDTH + 0.8)),
    ...NIGHTSTANDS.map((stand) => transform(stand.x, SHADOW_Y, stand.z, 0, 1.1)),
    ...TABLES.map((table) => transform(table.x, SHADOW_Y, table.z, 0, TABLE_RADIUS * 3)),
    ...FRIDGES.map((fridge) => transform(fridge.x, SHADOW_Y, fridge.z, 0, 1.2)),
    ...IV_STANDS.map((stand) => transform(stand.x, SHADOW_Y, stand.z, 0, 0.5)),
  ]);
}

/** 병실 다섯 개와 긴 복도를 만들어요. */
export function buildWard(parent: Object3D, softCircle: Texture): RoomHandles {
  const ceilingPanel = buildFloorsAndCeilings(parent);
  buildWalls(parent);
  const windowGlass = buildWindows(parent);
  buildDoorways(parent);
  buildBeds(parent);
  const sleepLamp = buildNightstands(parent);
  buildTables(parent);
  buildFridges(parent);
  buildIvStands(parent);
  buildContactShadows(parent, softCircle);
  return { ceilingPanel, sleepLamp, windowGlass };
}
