/**
 * 병동 치수와 배치예요. 단위는 미터이고, x는 복도를 따라가는 방향, z는 창문(-)에서 복도(+) 방향이에요.
 * ROOM, DOOR, WINDOW는 병실 하나의 중심을 기준으로 한 값이고, 나머지 목록은 병동 전체 좌표예요.
 */

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Placement {
  x: number;
  z: number;
  rotationY: number;
}

export interface WardRoom {
  /** 병실 번호예요. */
  number: number;
  index: number;
  /** 병실 중심의 x 좌표예요. */
  x: number;
}

export interface BedPlacement extends Placement {
  roomIndex: number;
  /** 병실 안에서의 침대 번호예요. 0~2번은 왼쪽 줄, 3~5번은 오른쪽 줄이에요. */
  index: number;
}

export const WALL_HEIGHT = 2.8;

export const ROOM: Rect = { minX: -3.5, maxX: 3.5, minZ: -5, maxZ: 5 };
export const DOOR = { minX: -0.7, maxX: 0.7, minZ: 5, maxZ: 5.2, height: 2.2 };
export const WINDOW = { minX: -2.4, maxX: 2.4, minY: 0.9, maxY: 2.4 };

/** 병실 사이에 칸막이 두께 0.2m가 있어요. */
const ROOM_PITCH = 7.2;
const ROOM_NUMBERS = [301, 302, 303, 304, 305];
const CENTER_ROOM_INDEX = (ROOM_NUMBERS.length - 1) / 2;

export const ROOMS: readonly WardRoom[] = ROOM_NUMBERS.map((number, index) => ({
  number,
  index,
  x: (index - CENTER_ROOM_INDEX) * ROOM_PITCH,
}));

export const CORRIDOR: Rect = {
  minX: ROOMS[0].x + ROOM.minX,
  maxX: ROOMS[ROOMS.length - 1].x + ROOM.maxX,
  minZ: DOOR.maxZ,
  maxZ: 7.4,
};

/** 복도 가운데 안쪽의 간호사실이에요. 들어갈 수는 없어요. */
export const NURSE_STATION: Rect = { minX: -3.5, maxX: 3.5, minZ: CORRIDOR.maxZ, maxZ: 10.4 };
/** 복도 오른쪽 끝의 엘리베이터 홀이에요. */
export const ELEVATOR_HALL: Rect = {
  minX: 14,
  maxX: CORRIDOR.maxX,
  minZ: CORRIDOR.maxZ,
  maxZ: 10.4,
};
export const ELEVATOR_DOOR_Z = [8.2, 9.6];

/** 병동 건물이 차지하는 자리예요. 눈은 이 안에 내리지 않아요. */
const WARD_FOOTPRINT: Rect = {
  minX: CORRIDOR.minX - 0.1,
  maxX: CORRIDOR.maxX + 0.1,
  minZ: ROOM.minZ - 0.3,
  maxZ: NURSE_STATION.maxZ + 0.3,
};

export function isInsideWard(x: number, z: number): boolean {
  return (
    x >= WARD_FOOTPRINT.minX &&
    x <= WARD_FOOTPRINT.maxX &&
    z >= WARD_FOOTPRINT.minZ &&
    z <= WARD_FOOTPRINT.maxZ
  );
}

export const CAMERA_MAX_DISTANCE = 24;

export interface HospitalBlock extends Rect {
  height: number;
}

/**
 * 병동을 둘러싼 병원 건물이에요. 창문 쪽은 정원과 숲을 향해 트여 있어요.
 * 크게 축소해 둘러봐도 카메라가 건물에 부딪히지 않을 만큼 떨어져 있어요.
 */
export const HOSPITAL_BLOCKS: readonly HospitalBlock[] = [
  { minX: -60, maxX: 60, minZ: 36, maxZ: 52, height: 34 },
  { minX: -60, maxX: -44, minZ: -12, maxZ: 36, height: 20 },
  { minX: 44, maxX: 60, minZ: -12, maxZ: 36, height: 20 },
];

/** 병동 복도와 양쪽 별관을 잇는 낮은 연결 통로예요. */
export const HOSPITAL_LINKS: readonly HospitalBlock[] = [
  { minX: -44, maxX: CORRIDOR.minX, minZ: CORRIDOR.minZ, maxZ: CORRIDOR.maxZ, height: 3.2 },
  { minX: CORRIDOR.maxX, maxX: 44, minZ: CORRIDOR.minZ, maxZ: CORRIDOR.maxZ, height: 3.2 },
];

export const BED_LENGTH = 2.1;
export const BED_WIDTH = 1;
export const NIGHTSTAND_SIZE = 0.56;
export const NIGHTSTAND_HEIGHT = 0.62;
export const TABLE_RADIUS = 0.55;
export const TABLE_HEIGHT = 0.7;

export const PLAYER_RADIUS = 0.22;
/** 가운데 병실(303호) 문 바로 앞에서 시작해요. 더 뒤로 가면 간호사실 카운터에 가려요. */
export const PLAYER_START = { x: 0, z: 5.6 };

const BED_ROWS_Z = [-3.2, 0, 3.2];
const BED_X = 2.3;
const NIGHTSTAND_X = 3.05;
const NIGHTSTAND_OFFSET_Z = -0.85;

/** 머리는 벽을, 발은 통로를 향해요. */
export const BEDS: readonly BedPlacement[] = ROOMS.flatMap((room) => [
  ...BED_ROWS_Z.map((z, row) => ({
    roomIndex: room.index,
    index: row,
    x: room.x - BED_X,
    z,
    rotationY: 0,
  })),
  ...BED_ROWS_Z.map((z, row) => ({
    roomIndex: room.index,
    index: row + 3,
    x: room.x + BED_X,
    z,
    rotationY: Math.PI,
  })),
]);

/** 침대마다 머리맡 창문 쪽에 협탁을 하나씩 둬요. */
export const NIGHTSTANDS: readonly Placement[] = BEDS.map((bed) => ({
  x: ROOMS[bed.roomIndex].x + (bed.index < 3 ? -NIGHTSTAND_X : NIGHTSTAND_X),
  z: bed.z + NIGHTSTAND_OFFSET_Z,
  rotationY: 0,
}));

/** 병실마다 가운데에 탁자가 하나씩 있어요. */
export const TABLES: readonly { x: number; z: number }[] = ROOMS.map((room) => ({
  x: room.x,
  z: 0,
}));

export const FRIDGE_WIDTH = 0.6;
export const FRIDGE_DEPTH = 0.6;
export const FRIDGE_HEIGHT = 1.35;

/** 병실마다 오른쪽 벽의 창가 침대와 가운데 협탁 사이에 냉장고를 하나씩 둬요. 문은 통로 쪽을 봐요. */
export const FRIDGES: readonly { x: number; z: number }[] = ROOMS.map((room) => ({
  x: room.x + ROOM.maxX - FRIDGE_DEPTH / 2 - 0.03,
  z: -1.9,
}));

export const IV_STAND_RADIUS = 0.13;
export const IV_POLE_HEIGHT = 1.8;
/** 수액 줄이 폴대에서 침대까지 뻗는 거리예요. */
export const IV_TUBE_REACH = Math.hypot(0.65, 0.33);

/** 침대마다 머리맡 복도 쪽에 링거 폴대를 둬요. rotationY는 수액 줄이 침대로 향하는 방향이에요. */
export const IV_STANDS: readonly Placement[] = BEDS.map((bed) => {
  const towardBedX = bed.index < 3 ? 0.65 : -0.65;
  const towardBedZ = -0.33;
  return {
    x: bed.x - towardBedX - (bed.index < 3 ? 0.1 : -0.1),
    z: bed.z + 0.68,
    rotationY: Math.atan2(-towardBedZ, towardBedX),
  };
});

function rectAround(x: number, z: number, halfX: number, halfZ: number): Rect {
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

export function roomRect(room: WardRoom): Rect {
  return {
    minX: room.x + ROOM.minX,
    maxX: room.x + ROOM.maxX,
    minZ: ROOM.minZ,
    maxZ: ROOM.maxZ,
  };
}

/** 지나갈 수 없는 가구들이에요. */
export const OBSTACLES: readonly Rect[] = [
  ...BEDS.map((bed) => rectAround(bed.x, bed.z, BED_LENGTH / 2, BED_WIDTH / 2)),
  ...NIGHTSTANDS.map((stand) =>
    rectAround(stand.x, stand.z, NIGHTSTAND_SIZE / 2, NIGHTSTAND_SIZE / 2),
  ),
  ...TABLES.map((table) => rectAround(table.x, table.z, TABLE_RADIUS, TABLE_RADIUS)),
  ...FRIDGES.map((fridge) => rectAround(fridge.x, fridge.z, FRIDGE_DEPTH / 2, FRIDGE_WIDTH / 2)),
  ...IV_STANDS.map((stand) => rectAround(stand.x, stand.z, IV_STAND_RADIUS, IV_STAND_RADIUS)),
];

/** 바닥을 눌렀을 때 이동 요청으로 받아 주는 영역이에요. */
export const FLOOR_AREAS: readonly Rect[] = [
  ...ROOMS.map(roomRect),
  ...ROOMS.map((room) => ({
    minX: room.x + DOOR.minX,
    maxX: room.x + DOOR.maxX,
    minZ: DOOR.minZ,
    maxZ: DOOR.maxZ,
  })),
  CORRIDOR,
  ELEVATOR_HALL,
];

function shrink(rect: Rect): Rect {
  return {
    minX: rect.minX + PLAYER_RADIUS,
    maxX: rect.maxX - PLAYER_RADIUS,
    minZ: rect.minZ + PLAYER_RADIUS,
    maxZ: rect.maxZ - PLAYER_RADIUS,
  };
}

/** 캐릭터 중심이 머물 수 있는 영역이에요. 벽에서 캐릭터 반지름만큼 떨어져 있어요. */
export const WALK_AREAS: readonly Rect[] = [
  ...ROOMS.map((room) => shrink(roomRect(room))),
  ...ROOMS.map((room) => ({
    minX: room.x + DOOR.minX + PLAYER_RADIUS,
    maxX: room.x + DOOR.maxX - PLAYER_RADIUS,
    minZ: ROOM.maxZ - PLAYER_RADIUS - 0.1,
    maxZ: CORRIDOR.minZ + PLAYER_RADIUS + 0.1,
  })),
  shrink(CORRIDOR),
  {
    minX: ELEVATOR_HALL.minX + PLAYER_RADIUS,
    maxX: ELEVATOR_HALL.maxX - PLAYER_RADIUS,
    minZ: CORRIDOR.maxZ - PLAYER_RADIUS - 0.1,
    maxZ: ELEVATOR_HALL.maxZ - PLAYER_RADIUS,
  },
];

/** x 좌표에서 가장 가까운 병실의 순번을 돌려줘요. */
export function nearestRoomIndex(x: number): number {
  const index = Math.round(x / ROOM_PITCH + CENTER_ROOM_INDEX);
  return Math.min(ROOMS.length - 1, Math.max(0, index));
}
