import {
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  BoxGeometry,
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
  BED_LOCAL_ROWS_Z,
  BED_WIDTH,
  BEDS,
  BUILDING,
  CORRIDOR,
  CORRIDOR_WINDOW,
  CURTAIN_BUNCHES,
  CURTAIN_RAIL_FOOT_X,
  CURTAIN_RAIL_SIDE,
  CURTAIN_RAIL_Y,
  DOOR,
  DOOR_RECTS,
  ENTRANCE,
  FRIDGE_DEPTH,
  FRIDGE_HEIGHT,
  FRIDGE_WIDTH,
  FRIDGES,
  HEADER_Y,
  IV_POLE_HEIGHT,
  IV_STAND_RADIUS,
  IV_STANDS,
  IV_TUBE_REACH,
  LOBBY,
  NIGHTSTAND_HEIGHT,
  NIGHTSTAND_SIZE,
  NIGHTSTANDS,
  ROOM,
  ROOMS,
  SLEEP_LAMPS,
  TABLE_HEIGHT,
  TABLE_RADIUS,
  TABLES,
  WALL_HEIGHT,
  WINDOW,
} from "../../shared/ward-layout";
import type { WardRoom } from "../../shared/ward-layout";
import { addInstances, repeatAt, transform } from "./parts";

const SHADOW_Y = 0.012;
const FOUNDATION_Y = -0.03;
const WALLPAPER_COLOR = "#ffffff";
const BED_FRAME_COLOR = "#f3e8d2";
const FURNITURE_COLOR = "#f4efe5";
const TRIM_COLOR = "#dfdcd5";
const RAIL_COLOR = "#c9cdd0";

const lambert = (color: string): MeshLambertMaterial => new MeshLambertMaterial({ color });

const roomBase = (room: WardRoom): Matrix4 => transform(room.x, 0, room.z, room.rotationY);

/** 병실 안쪽 좌표의 구성을 병실마다 반복해요. */
const inEveryRoom = (locals: readonly Matrix4[]): Matrix4[] => repeatAt(ROOMS.map(roomBase), locals);

export interface RoomHandles {
  /** 시간대에 따라 밝기가 바뀌는 재질들이에요. */
  ceiling: MeshLambertMaterial;
  ceilingPanel: MeshBasicMaterial;
  sleepLamp: MeshBasicMaterial;
  windowGlass: MeshBasicMaterial;
}

type Facing = "+x" | "-x" | "+z" | "-z";

const FACING_ROTATION: Record<Facing, number> = {
  "+z": 0,
  "-z": Math.PI,
  "+x": Math.PI / 2,
  "-x": -Math.PI / 2,
};

/**
 * 벽 한 조각이에요. facing 쪽에서만 보이는 면이고, fixed는 벽이 놓인 좌표,
 * from과 to는 벽을 따라가는 좌표예요.
 */
function wallPiece(
  facing: Facing,
  fixed: number,
  from: number,
  to: number,
  y1: number,
  y2: number,
): BufferGeometry {
  const middle = (from + to) / 2;
  const onX = facing === "+x" || facing === "-x";
  const geometry = new PlaneGeometry(Math.abs(to - from), y2 - y1);
  geometry.applyMatrix4(
    transform(onX ? fixed : middle, (y1 + y2) / 2, onX ? middle : fixed, FACING_ROTATION[facing]),
  );
  return geometry;
}

/** 병실 안쪽 네 면이에요. 병실 좌표로 만든 뒤 제자리로 옮겨요. */
function roomWallPieces(room: WardRoom): BufferGeometry[] {
  const pieces = [
    wallPiece("+x", ROOM.minX, ROOM.minZ, ROOM.maxZ, 0, WALL_HEIGHT),
    wallPiece("-x", ROOM.maxX, ROOM.minZ, ROOM.maxZ, 0, WALL_HEIGHT),
    // 창문 벽
    wallPiece("+z", ROOM.minZ, ROOM.minX, ROOM.maxX, 0, WINDOW.minY),
    wallPiece("+z", ROOM.minZ, ROOM.minX, WINDOW.minX, WINDOW.minY, WALL_HEIGHT),
    wallPiece("+z", ROOM.minZ, WINDOW.maxX, ROOM.maxX, WINDOW.minY, WALL_HEIGHT),
    wallPiece("+z", ROOM.minZ, WINDOW.minX, WINDOW.maxX, WINDOW.maxY, WALL_HEIGHT),
    // 문이 있는 벽
    wallPiece("-z", ROOM.maxZ, ROOM.minX, DOOR.minX, 0, WALL_HEIGHT),
    wallPiece("-z", ROOM.maxZ, DOOR.maxX, ROOM.maxX, 0, WALL_HEIGHT),
    wallPiece("-z", ROOM.maxZ, DOOR.minX, DOOR.maxX, DOOR.height, WALL_HEIGHT),
  ];
  const base = roomBase(room);
  for (const piece of pieces) piece.applyMatrix4(base);
  return pieces;
}

/** 복도 한쪽 벽이에요. 병실 문과 간호사실 입구 자리는 비워요. */
function corridorSidePieces(side: number): BufferGeometry[] {
  const fixed = side * CORRIDOR.maxX;
  const facing: Facing = side > 0 ? "-x" : "+x";
  const openings = [
    ...ROOMS.filter((room) => Math.sign(room.x) === side).map((room) => ({
      minZ: room.z + DOOR.minX,
      maxZ: room.z + DOOR.maxX,
      headerY: DOOR.height,
    })),
  ].sort((a, b) => a.minZ - b.minZ);

  const pieces: BufferGeometry[] = [];
  let z = CORRIDOR.minZ;
  for (const opening of openings) {
    pieces.push(wallPiece(facing, fixed, z, opening.minZ, 0, WALL_HEIGHT));
    pieces.push(wallPiece(facing, fixed, opening.minZ, opening.maxZ, opening.headerY, WALL_HEIGHT));
    z = opening.maxZ;
  }
  pieces.push(wallPiece(facing, fixed, z, CORRIDOR.maxZ, 0, WALL_HEIGHT));
  return pieces;
}

function buildInteriorWalls(parent: Object3D): void {
  const window = CORRIDOR_WINDOW;
  const pieces: BufferGeometry[] = [
    ...ROOMS.flatMap(roomWallPieces),
    ...corridorSidePieces(-1),
    ...corridorSidePieces(1),

    // 복도 끝의 큰 창이 있는 벽
    wallPiece("+z", CORRIDOR.minZ, CORRIDOR.minX, CORRIDOR.maxX, 0, window.minY),
    wallPiece("+z", CORRIDOR.minZ, CORRIDOR.minX, CORRIDOR.maxX, window.maxY, WALL_HEIGHT),
    wallPiece("+z", CORRIDOR.minZ, CORRIDOR.minX, window.minX, window.minY, window.maxY),
    wallPiece("+z", CORRIDOR.minZ, window.maxX, CORRIDOR.maxX, window.minY, window.maxY),

    // 복도와 로비 사이 위쪽 벽. 양쪽에서 보여요.
    wallPiece("+z", LOBBY.minZ, CORRIDOR.minX, CORRIDOR.maxX, HEADER_Y, WALL_HEIGHT),
    wallPiece("-z", LOBBY.minZ, CORRIDOR.minX, CORRIDOR.maxX, HEADER_Y, WALL_HEIGHT),

    // 로비 네 면
    wallPiece("+z", LOBBY.minZ, LOBBY.minX, CORRIDOR.minX, 0, WALL_HEIGHT),
    wallPiece("+z", LOBBY.minZ, CORRIDOR.maxX, LOBBY.maxX, 0, WALL_HEIGHT),
    wallPiece("+x", LOBBY.minX, LOBBY.minZ, LOBBY.maxZ, 0, WALL_HEIGHT),
    wallPiece("-x", LOBBY.maxX, LOBBY.minZ, LOBBY.maxZ, 0, WALL_HEIGHT),
    wallPiece("-z", LOBBY.maxZ, LOBBY.minX, ENTRANCE.minX, 0, WALL_HEIGHT),
    wallPiece("-z", LOBBY.maxZ, ENTRANCE.maxX, LOBBY.maxX, 0, WALL_HEIGHT),
    wallPiece("-z", LOBBY.maxZ, ENTRANCE.minX, ENTRANCE.maxX, ENTRANCE.height, WALL_HEIGHT),

  ];
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

function buildFloorsAndCeiling(parent: Object3D): {
  panel: MeshBasicMaterial;
  ceiling: MeshLambertMaterial;
} {
  const addMerged = (pieces: BufferGeometry[], color: string): void => {
    parent.add(new Mesh(mergeGeometries(pieces), lambert(color)));
  };

  // 벽이 서는 자리예요. 문틈이나 벽 사이로 바깥이 비치지 않게 막아요.
  addMerged(
    [floorPiece(BUILDING.minX, BUILDING.maxX, BUILDING.minZ, BUILDING.maxZ, FOUNDATION_Y)],
    "#ecebe6",
  );
  addMerged(
    ROOMS.map((room) => {
      const piece = floorPiece(ROOM.minX, ROOM.maxX, ROOM.minZ, ROOM.maxZ);
      piece.applyMatrix4(roomBase(room));
      return piece;
    }),
    "#d8d4c9",
  );
  addMerged(
    [
      ...DOOR_RECTS.map((door) => floorPiece(door.minX, door.maxX, door.minZ, door.maxZ)),
      floorPiece(ENTRANCE.minX, ENTRANCE.maxX, ENTRANCE.minZ, ENTRANCE.maxZ),
    ],
    "#c4c1b8",
  );
  addMerged(
    [
      floorPiece(CORRIDOR.minX, CORRIDOR.maxX, CORRIDOR.minZ, CORRIDOR.maxZ),
      floorPiece(LOBBY.minX, LOBBY.maxX, LOBBY.minZ, LOBBY.maxZ),
    ],
    "#cfcdc6",
  );

  // 건물 전체를 덮는 천장이에요. 아래에서만 보이는 면이에요.
  const ceilingGeometry = new PlaneGeometry(BUILDING.maxX - BUILDING.minX, BUILDING.maxZ - BUILDING.minZ);
  ceilingGeometry.rotateX(Math.PI / 2);
  ceilingGeometry.translate(0, WALL_HEIGHT, (BUILDING.minZ + BUILDING.maxZ) / 2);
  // 천장은 위에서 오는 빛을 받지 못해 어두워지므로, 시간대별로 스스로 밝혀요.
  const ceilingMaterial = new MeshLambertMaterial({ color: WALLPAPER_COLOR, emissive: "#ffffff" });
  parent.add(new Mesh(ceilingGeometry, ceilingMaterial));

  const panelMaterial = new MeshBasicMaterial({ color: "#fff3d6" });
  const panelGeometry = new CircleGeometry(0.42, 20);
  panelGeometry.rotateX(Math.PI / 2);
  const panelY = WALL_HEIGHT - 0.01;
  addInstances(parent, panelGeometry, panelMaterial, [
    ...inEveryRoom([transform(0, panelY, -2.5), transform(0, panelY, 2.5)]),
    transform(0, panelY, -7.2),
    transform(0, panelY, 0),
    transform(0, panelY, 7.2),
    transform(-6, panelY, (LOBBY.minZ + LOBBY.maxZ) / 2),
    transform(0, panelY, (LOBBY.minZ + LOBBY.maxZ) / 2),
    transform(6, panelY, (LOBBY.minZ + LOBBY.maxZ) / 2),
  ]);
  return { panel: panelMaterial, ceiling: ceilingMaterial };
}

function buildWindows(parent: Object3D): MeshBasicMaterial {
  const frame = lambert("#eef0f0");
  const width = WINDOW.maxX - WINDOW.minX;
  const height = WINDOW.maxY - WINDOW.minY;
  const centerY = (WINDOW.minY + WINDOW.maxY) / 2;
  const z = ROOM.minZ;

  // 병실 창틀
  addInstances(
    parent,
    new RoundedBoxGeometry(width + 0.2, 0.1, 0.14, 2, 0.04),
    frame,
    inEveryRoom([
      transform(0, WINDOW.maxY + 0.02, z),
      transform(0, WINDOW.minY - 0.02, z + 0.04),
    ]),
  );
  addInstances(
    parent,
    new RoundedBoxGeometry(0.1, height, 0.12, 2, 0.04),
    frame,
    inEveryRoom([
      transform(WINDOW.minX - 0.02, centerY, z),
      transform(WINDOW.maxX + 0.02, centerY, z),
      transform(-0.8, centerY, z, 0, 0.6, 1, 0.8),
      transform(0.8, centerY, z, 0, 0.6, 1, 0.8),
    ]),
  );

  // 복도 끝 창틀
  const corridor = CORRIDOR_WINDOW;
  const corridorCenterY = (corridor.minY + corridor.maxY) / 2;
  addInstances(
    parent,
    new RoundedBoxGeometry(corridor.maxX - corridor.minX + 0.2, 0.1, 0.14, 2, 0.04),
    frame,
    [
      transform(0, corridor.maxY + 0.02, CORRIDOR.minZ),
      transform(0, corridor.minY - 0.02, CORRIDOR.minZ + 0.04),
    ],
  );
  addInstances(
    parent,
    new RoundedBoxGeometry(0.1, corridor.maxY - corridor.minY, 0.12, 2, 0.04),
    frame,
    [
      transform(corridor.minX - 0.02, corridorCenterY, CORRIDOR.minZ),
      transform(corridor.maxX + 0.02, corridorCenterY, CORRIDOR.minZ),
    ],
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
    new PlaneGeometry(1, 1),
    glassMaterial,
    [
      ...inEveryRoom([transform(0, centerY, z - 0.01, 0, width, height, 1)]),
      transform(
        0,
        corridorCenterY,
        CORRIDOR.minZ - 0.01,
        0,
        corridor.maxX - corridor.minX,
        corridor.maxY - corridor.minY,
        1,
      ),
    ],
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
    plate.position.set(0, DOOR.height + 0.3, DOOR.maxZ + 0.01);
    plate.applyMatrix4(roomBase(room));
    parent.add(plate);
  }
}

/** 복도 양쪽 벽의 안전 손잡이예요. 문과 입구 자리는 비워요. */
function buildCorridorRails(parent: Object3D): void {
  const rails: Matrix4[] = [];
  for (const side of [-1, 1]) {
    const openings = [
      ...ROOMS.filter((room) => Math.sign(room.x) === side).map((room) => ({
        minZ: room.z + DOOR.minX,
        maxZ: room.z + DOOR.maxX,
      })),
    ].sort((a, b) => a.minZ - b.minZ);
    let z = CORRIDOR.minZ + 0.15;
    const add = (from: number, to: number): void => {
      if (to - from < 0.3) return;
      rails.push(
        transform(side * (CORRIDOR.maxX - 0.04), 0.9, (from + to) / 2, 0, 1, 1, to - from),
      );
    };
    for (const opening of openings) {
      add(z, opening.minZ - 0.15);
      z = opening.maxZ + 0.15;
    }
    add(z, CORRIDOR.maxZ - 0.15);
  }
  addInstances(parent, new RoundedBoxGeometry(0.08, 0.07, 1, 1, 0.03), lambert(RAIL_COLOR), rails);
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
  addInstances(
    parent,
    new SphereGeometry(0.075, 12, 8),
    lampMaterial,
    SLEEP_LAMPS.map((lamp) => transform(lamp.x, 1.3, lamp.z)),
  );
  return lampMaterial;
}

function buildTables(parent: Object3D): void {
  const top = lambert(FURNITURE_COLOR);
  const stand = lambert(RAIL_COLOR);
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

/** 병실마다 한 대씩 있는 작은 냉장고예요. 문은 병실 안쪽 좌표의 -x를 봐요. */
function buildFridges(parent: Object3D): void {
  const bases = FRIDGES.map((fridge) => transform(fridge.x, 0, fridge.z, fridge.rotationY));
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

/** 침대 둘레의 천장 레일과, 걷어서 묶어 둔 커튼이에요. 지금은 치지 않아요. */
function buildCurtains(parent: Object3D): void {
  const metal = lambert(RAIL_COLOR);
  const rails: Matrix4[] = [];
  const rods: Matrix4[] = [];
  for (const sign of [-1, 1]) {
    const wallX = sign * ROOM.maxX;
    const footX = sign * CURTAIN_RAIL_FOOT_X;
    const sideLength = Math.abs(wallX - footX);
    for (const z of BED_LOCAL_ROWS_Z) {
      // 벽에서 나와 침대 양옆을 지나 발치에서 만나는 ㄷ자 레일이에요.
      for (const offset of [-CURTAIN_RAIL_SIDE, CURTAIN_RAIL_SIDE]) {
        rails.push(transform((wallX + footX) / 2, CURTAIN_RAIL_Y, z + offset, 0, sideLength, 1, 1));
        rods.push(transform(footX, (CURTAIN_RAIL_Y + WALL_HEIGHT) / 2, z + offset));
      }
      rails.push(
        transform(footX, CURTAIN_RAIL_Y, z, Math.PI / 2, CURTAIN_RAIL_SIDE * 2 + 0.04, 1, 1),
      );
    }
  }
  addInstances(parent, new BoxGeometry(1, 0.035, 0.035), metal, inEveryRoom(rails));
  addInstances(
    parent,
    new CylinderGeometry(0.012, 0.012, WALL_HEIGHT - CURTAIN_RAIL_Y, 6),
    metal,
    inEveryRoom(rods),
  );

  // 주름이 잡히도록 세 겹을 나란히 두고, 가운데를 끈으로 묶어요.
  const top = CURTAIN_RAIL_Y;
  const bottom = 0.5;
  const height = top - bottom;
  const bases = CURTAIN_BUNCHES.map((bunch) => transform(bunch.x, 0, bunch.z, bunch.rotationY));
  addInstances(
    parent,
    new CylinderGeometry(0.075, 0.095, height, 8),
    lambert("#bcd6d0"),
    repeatAt(bases, [
      transform(-0.1, bottom + height / 2, 0),
      transform(0, bottom + height / 2, 0.02),
      transform(0.1, bottom + height / 2, 0),
    ]),
  );
  addInstances(
    parent,
    new RoundedBoxGeometry(0.4, 0.07, 0.24, 1, 0.02),
    lambert("#8fb3ab"),
    repeatAt(bases, [transform(0, 1.55, 0)]),
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
    ...BEDS.map((bed) => transform(bed.x, SHADOW_Y, bed.z, 0, BED_WIDTH + 0.8, 1, BED_LENGTH + 0.8)),
    ...NIGHTSTANDS.map((stand) => transform(stand.x, SHADOW_Y, stand.z, 0, 1.1)),
    ...TABLES.map((table) => transform(table.x, SHADOW_Y, table.z, 0, TABLE_RADIUS * 3)),
    ...FRIDGES.map((fridge) => transform(fridge.x, SHADOW_Y, fridge.z, 0, 1.2)),
    ...IV_STANDS.map((stand) => transform(stand.x, SHADOW_Y, stand.z, 0, 0.5)),
  ]);
}

/** 건물 안쪽을 만들어요. 병실 다섯 개, 가운데 복도, 로비예요. */
export function buildWard(parent: Object3D, softCircle: Texture): RoomHandles {
  const { panel: ceilingPanel, ceiling } = buildFloorsAndCeiling(parent);
  buildInteriorWalls(parent);
  const windowGlass = buildWindows(parent);
  buildDoorways(parent);
  buildCorridorRails(parent);
  buildBeds(parent);
  const sleepLamp = buildNightstands(parent);
  buildTables(parent);
  buildFridges(parent);
  buildIvStands(parent);
  buildCurtains(parent);
  buildContactShadows(parent, softCircle);
  return { ceiling, ceilingPanel, sleepLamp, windowGlass };
}
