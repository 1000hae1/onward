/**
 * 병원 건물의 치수와 배치예요. 단위는 미터이고, 현관은 +z 쪽, 복도 끝 창은 -z 쪽이에요.
 * 복도는 z축을 따라 가운데로 나 있고, 병실은 복도 양옆(x의 +와 -)에 있어요.
 *
 * ROOM, DOOR, WINDOW는 병실 하나의 안쪽 좌표예요. 이 좌표에서 +z는 복도 쪽 문, -z는 창문이에요.
 * 나머지 목록은 모두 건물 전체 좌표예요.
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

export interface WardRoom extends Placement {
  /** 병실 번호예요. */
  number: number;
  index: number;
}

export interface BedPlacement extends Placement {
  roomIndex: number;
  /** 병실 안에서의 침대 번호예요. 0~2번과 3~5번이 서로 마주 봐요. */
  index: number;
}

/** 카메라 시선을 막는 벽과 천장이에요. */
export interface WallBox extends Rect {
  minY: number;
  maxY: number;
}

export const WALL_HEIGHT = 3.6;
export const WALL_THICKNESS = 0.2;
export const FLOOR_HEIGHT = 4;
export const FLOOR_COUNT = 4;
/** 밖에서 보이는 건물 높이예요. 들어갈 수 있는 곳은 1층뿐이에요. */
export const BUILDING_HEIGHT = FLOOR_HEIGHT * FLOOR_COUNT;

export const ROOM: Rect = { minX: -3.5, maxX: 3.5, minZ: -5, maxZ: 5 };
export const DOOR = { minX: -0.7, maxX: 0.7, minZ: 5, maxZ: 5.2, height: 2.4 };
export const WINDOW = { minX: -2.4, maxX: 2.4, minY: 0.9, maxY: 2.9 };

const CORRIDOR_HALF_WIDTH = 1.4;
const ROOM_CENTER_X = CORRIDOR_HALF_WIDTH + WALL_THICKNESS + ROOM.maxZ;
const OUTER_WALL_X = ROOM_CENTER_X + ROOM.maxZ;
export const ROW_PITCH = 7.2;
const ROWS_Z = [-ROW_PITCH, 0, ROW_PITCH];
const FAR_ROOM_EDGE_Z = ROWS_Z[0] + ROOM.minX;
const NEAR_ROOM_EDGE_Z = ROWS_Z[2] + ROOM.maxX;

export const CORRIDOR: Rect = {
  minX: -CORRIDOR_HALF_WIDTH,
  maxX: CORRIDOR_HALF_WIDTH,
  minZ: FAR_ROOM_EDGE_Z - 0.1,
  maxZ: NEAR_ROOM_EDGE_Z + WALL_THICKNESS,
};
export const LOBBY: Rect = {
  minX: -OUTER_WALL_X,
  maxX: OUTER_WALL_X,
  minZ: CORRIDOR.maxZ,
  maxZ: 16.8,
};
/** 건물 바깥벽까지 포함한 자리예요. */
export const BUILDING: Rect = {
  minX: -OUTER_WALL_X - WALL_THICKNESS,
  maxX: OUTER_WALL_X + WALL_THICKNESS,
  minZ: CORRIDOR.minZ - WALL_THICKNESS,
  maxZ: LOBBY.maxZ + WALL_THICKNESS,
};
/** 활짝 열린 현관이에요. */
export const ENTRANCE = { minX: -1.5, maxX: 1.5, minZ: LOBBY.maxZ, maxZ: BUILDING.maxZ, height: 2.9 };
/** 현관 앞마당이에요. 지금은 이 안에서만 걸을 수 있어요. */
export const YARD: Rect = { minX: -9, maxX: 9, minZ: BUILDING.maxZ, maxZ: 42 };
/** 복도 끝의 큰 창이에요. x와 높이 범위예요. */
export const CORRIDOR_WINDOW = { minX: -1.1, maxX: 1.1, minY: 0.6, maxY: 3 };
/** 복도와 로비 사이 위쪽 벽이 시작되는 높이예요. */
export const HEADER_Y = 3;

const ROOM_SLOTS = [
  { number: 101, side: -1, z: ROWS_Z[0] },
  { number: 102, side: -1, z: ROWS_Z[1] },
  { number: 103, side: -1, z: ROWS_Z[2] },
  { number: 104, side: 1, z: ROWS_Z[0] },
  { number: 105, side: 1, z: ROWS_Z[1] },
  { number: 106, side: 1, z: ROWS_Z[2] },
];

export const ROOMS: readonly WardRoom[] = ROOM_SLOTS.map((slot, index) => ({
  number: slot.number,
  index,
  x: slot.side * ROOM_CENTER_X,
  z: slot.z,
  // 병실 안쪽 좌표의 +z(문)가 복도를 향하도록 돌려요.
  rotationY: (-slot.side * Math.PI) / 2,
}));

/**
 * 로비 오른쪽의 간호사실이에요. 카운터가 현관 쪽을 보고 있고, 복도 입구는 막지 않아요.
 * 카운터 안쪽으로는 들어갈 수 없어요.
 */
export const NURSE_STATION: Rect = {
  minX: 1.9,
  maxX: 8.7,
  minZ: LOBBY.minZ + 1.05,
  maxZ: LOBBY.minZ + 2.75,
};
export const NURSE_STATION_CENTER_X = (NURSE_STATION.minX + NURSE_STATION.maxX) / 2;

const nurseAt = (offsetX: number, offsetZ: number): Placement => {
  const x = NURSE_STATION_CENTER_X + offsetX;
  const z = NURSE_STATION.minZ + offsetZ;
  // 현관에서 들어오는 사람을 바라봐요. rotationY 0은 +z 쪽이에요.
  return { x, z, rotationY: Math.atan2(-x, ENTRANCE.minZ - z) };
};

/** 카운터 안쪽의 병아리 간호사예요. */
export const NURSES: readonly Placement[] = [
  nurseAt(-2.1, 0.75),
  nurseAt(0, 0.65),
  nurseAt(2.1, 0.75),
];

/** 병실 안쪽 좌표를 건물 전체 좌표로 바꿔요. */
export function roomToWorld(room: Placement, localX: number, localZ: number): { x: number; z: number } {
  const cos = Math.cos(room.rotationY);
  const sin = Math.sin(room.rotationY);
  return {
    x: room.x + localX * cos + localZ * sin,
    z: room.z - localX * sin + localZ * cos,
  };
}

export const BED_LENGTH = 2.1;
export const BED_WIDTH = 1;
export const NIGHTSTAND_SIZE = 0.56;
export const NIGHTSTAND_HEIGHT = 0.62;
export const TABLE_RADIUS = 0.55;
export const TABLE_HEIGHT = 0.7;
export const FRIDGE_WIDTH = 0.6;
export const FRIDGE_DEPTH = 0.6;
export const FRIDGE_HEIGHT = 1.35;
/** 침대 둘레 커튼 레일의 높이예요. 그 위는 천장까지 막대로 이어져요. */
export const CURTAIN_RAIL_Y = 2.8;
/** 침대 가운데에서 레일까지의 거리예요. */
export const CURTAIN_RAIL_SIDE = 1.35;
/** 레일이 끝나는 침대 발치 쪽 위치예요. 병실 가운데에서 잰 거리예요. */
export const CURTAIN_RAIL_FOOT_X = 1.05;
const CURTAIN_BUNCH_HALF = 0.2;
export const IV_STAND_RADIUS = 0.13;
export const IV_POLE_HEIGHT = 1.8;
/** 수액 줄이 폴대에서 침대까지 뻗는 거리예요. */
export const IV_TUBE_REACH = Math.hypot(0.65, 0.33);

export const PLAYER_RADIUS = 0.26;
/** 앞마당에서 현관을 바라보며 시작해요. */
export const PLAYER_START = { x: 0, z: 36 };

export const BED_LOCAL_ROWS_Z = [-3.2, 0, 3.2];
const BED_LOCAL_X = 2.3;
const NIGHTSTAND_LOCAL_X = 3.05;
const NIGHTSTAND_OFFSET_Z = -0.85;
const SLEEP_LAMP_LOCAL_X = ROOM.maxX - 0.07;
const BED_APPROACH_LOCAL_X = 1.9;
const BED_APPROACH_OFFSET_Z = 0.8;
const BED_REST_LOCAL_X = -0.19;
const BED_TAP_HEIGHT = 1.1;

const placeInRoom = (
  room: WardRoom,
  localX: number,
  localZ: number,
  localRotationY = 0,
): Placement => ({
  ...roomToWorld(room, localX, localZ),
  rotationY: room.rotationY + localRotationY,
});

/** 머리는 벽을, 발은 병실 가운데를 향해요. */
export const BEDS: readonly BedPlacement[] = ROOMS.flatMap((room) => [
  ...BED_LOCAL_ROWS_Z.map((z, row) => ({
    roomIndex: room.index,
    index: row,
    ...placeInRoom(room, -BED_LOCAL_X, z),
  })),
  ...BED_LOCAL_ROWS_Z.map((z, row) => ({
    roomIndex: room.index,
    index: row + 3,
    ...placeInRoom(room, BED_LOCAL_X, z, Math.PI),
  })),
]);

const bedLocal = (index: number): { sign: number; z: number } => ({
  sign: index < 3 ? -1 : 1,
  z: BED_LOCAL_ROWS_Z[index % 3],
});

/** 침대마다 머리맡 창문 쪽에 협탁을 하나씩 둬요. */
export const NIGHTSTANDS: readonly Placement[] = BEDS.map((bed) => {
  const { sign, z } = bedLocal(bed.index);
  return placeInRoom(ROOMS[bed.roomIndex], sign * NIGHTSTAND_LOCAL_X, z + NIGHTSTAND_OFFSET_Z);
});

/** 침대마다 머리맡 벽에 수면등이 있어요. */
export const SLEEP_LAMPS: readonly Placement[] = BEDS.map((bed) => {
  const { sign, z } = bedLocal(bed.index);
  return placeInRoom(ROOMS[bed.roomIndex], sign * SLEEP_LAMP_LOCAL_X, z + NIGHTSTAND_OFFSET_Z);
});

/** 침대마다 머리맡 문 쪽에 링거 폴대를 둬요. rotationY는 수액 줄이 침대로 향하는 방향이에요. */
export const IV_STANDS: readonly Placement[] = BEDS.map((bed) => {
  const { sign, z } = bedLocal(bed.index);
  const towardBedX = -sign * 0.65;
  const towardBedZ = -0.33;
  return placeInRoom(
    ROOMS[bed.roomIndex],
    sign * (BED_LOCAL_X + 0.75),
    z + 0.68,
    Math.atan2(-towardBedZ, towardBedX),
  );
});

/** 침대마다 걷어 묶은 커튼 다발이에요. 머리맡 벽 쪽 모서리에 있어서 지나다니는 데 걸리지 않아요. */
export const CURTAIN_BUNCHES: readonly Placement[] = BEDS.map((bed) => {
  const { sign, z } = bedLocal(bed.index);
  return placeInRoom(
    ROOMS[bed.roomIndex],
    sign * (ROOM.maxX - CURTAIN_BUNCH_HALF - 0.02),
    z - CURTAIN_RAIL_SIDE,
  );
});

/** 병실마다 가운데에 탁자가 하나씩 있어요. */
export const TABLES: readonly { x: number; z: number }[] = ROOMS.map((room) => ({
  x: room.x,
  z: room.z,
}));

/** 병실마다 창가 침대와 가운데 협탁 사이의 벽에 냉장고를 둬요. 문은 병실 가운데를 봐요. */
export const FRIDGES: readonly Placement[] = ROOMS.map((room) =>
  placeInRoom(room, ROOM.maxX - FRIDGE_DEPTH / 2 - 0.03, -1.9),
);

/** 로비의 성탄 나무와 긴 의자, 현관 양옆 화분이에요. */
export const LOBBY_TREE = { x: -8, z: 15.2, radius: 0.85 };
export const LOBBY_BENCHES: readonly { x: number; z: number }[] = [
  { x: 8, z: 14.4 },
  { x: 8, z: 15.9 },
];
export const LOBBY_BENCH = { length: 2.4, depth: 0.55 };
export const ENTRANCE_PLANTERS: readonly { x: number; z: number }[] = [
  { x: -4.6, z: 16.3 },
  { x: 4.6, z: 16.3 },
];
/** 현관 양옆의 겨울 정원이에요. 눈 덮인 화단이라 들어갈 수는 없어요. */
export const ENTRANCE_GARDENS: readonly Rect[] = [-1, 1].map((side) => ({
  minX: side > 0 ? 3.9 : -8.6,
  maxX: side > 0 ? 8.6 : -3.9,
  minZ: BUILDING.maxZ + 1,
  maxZ: BUILDING.maxZ + 8.5,
}));
export const YARD_LAMPS: readonly { x: number; z: number }[] = [
  { x: -3.4, z: 21 },
  { x: 3.4, z: 21 },
  { x: -3.4, z: 28 },
  { x: 3.4, z: 28 },
  { x: -3.4, z: 35 },
  { x: 3.4, z: 35 },
];

/** 눕기 전에 서는 침대 곁 자리예요. 문 쪽 옆면이라 링거와 협탁에 걸리지 않아요. */
export function bedApproach(bed: BedPlacement): { x: number; z: number } {
  const { sign, z } = bedLocal(bed.index);
  return roomToWorld(ROOMS[bed.roomIndex], sign * BED_APPROACH_LOCAL_X, z + BED_APPROACH_OFFSET_Z);
}

/** 누웠을 때 엉덩이가 놓이는 자리예요. 머리가 베개에 닿도록 침대 머리 쪽으로 치우쳐요. */
export function bedRest(bed: BedPlacement): { x: number; z: number } {
  return roomToWorld(bed, BED_REST_LOCAL_X, 0);
}

/** 눕는 방향이에요. 얼굴의 정면 방향이 침대 발치를 향해요. */
export function bedRestYaw(bed: BedPlacement): number {
  return bed.rotationY + Math.PI / 2;
}

/** 탭으로 침대를 고르는 상자예요. 누운 아바타를 눌러도 잡히도록 위로 넉넉해요. */
export const BED_BOXES: readonly WallBox[] = BEDS.map((bed) => ({
  minX: bed.x - BED_WIDTH / 2,
  maxX: bed.x + BED_WIDTH / 2,
  minZ: bed.z - BED_LENGTH / 2,
  maxZ: bed.z + BED_LENGTH / 2,
  minY: 0,
  maxY: BED_TAP_HEIGHT,
}));

/** 침대 위 이불의 높이예요. 고양이가 앉는 높이예요. */
export const BED_SURFACE_Y = 0.645;
const BED_FOOT_LOCAL_X = 0.72;
const BED_MIDDLE_LOCAL_X = 0.2;
const CAT_CURL_LOCAL_X = 2.45;
const CAT_CURL_OFFSET_Z = 0.85;

/** 고양이가 침대 위에 앉는 자리예요. 찾아왔을 때는 발치, 혼자 쉴 때는 가운데예요. */
export function bedCatSeat(bed: BedPlacement, atFoot: boolean): { x: number; z: number } {
  return roomToWorld(bed, atFoot ? BED_FOOT_LOCAL_X : BED_MIDDLE_LOCAL_X, 0);
}

/** 침대 위 고양이가 머리맡 쪽을 보는 방향이에요. */
export function bedCatYaw(bed: BedPlacement): number {
  return bed.rotationY - Math.PI / 2;
}

/** 내가 누웠을 때 데리고 온 고양이가 웅크리는 침대 옆 바닥이에요. */
export function bedCurlSpot(bed: BedPlacement): { x: number; z: number } {
  const { sign, z } = bedLocal(bed.index);
  return roomToWorld(ROOMS[bed.roomIndex], sign * CAT_CURL_LOCAL_X, z + CAT_CURL_OFFSET_Z);
}

/** 평안의 빛이 닿는 침대 머리맡이에요. */
export function bedHeadSpot(bed: BedPlacement): { x: number; y: number; z: number } {
  return { ...roomToWorld(bed, -BED_LENGTH / 2 + 0.22, 0), y: 1.08 };
}

/** 협탁에 선물을 놓는 칸이에요. 귤 바구니와 홍시 접시가 쓰지 않는 두 모서리예요. */
const GIFT_SLOT_OFFSETS = [
  { x: 0.13, z: -0.13 },
  { x: -0.13, z: 0.13 },
] as const;

export function giftSpot(standIndex: number, slot: number): { x: number; y: number; z: number } {
  const stand = NIGHTSTANDS[standIndex];
  const offset = GIFT_SLOT_OFFSETS[slot];
  return { x: stand.x + offset.x, y: NIGHTSTAND_HEIGHT, z: stand.z + offset.z };
}

const WINDOW_SILL_LOCAL_Z = ROOM.minZ + 0.08;
const WINDOW_SILL_TOP_Y = WINDOW.minY + 0.03;
const WINDOW_LAMP_REACH = (WINDOW.maxX - WINDOW.minX) / 2 - 0.15;

/** 창틀 끝 화분 자리예요. 램프 자리보다 바깥쪽이라 겹치지 않아요. */
const PLANTER_LOCAL_X = WINDOW.maxX - 0.1;
export function planterSpot(room: WardRoom): { x: number; y: number; z: number } {
  return { ...roomToWorld(room, PLANTER_LOCAL_X, WINDOW_SILL_LOCAL_Z), y: WINDOW_SILL_TOP_Y };
}

/** 병실 문 바로 안쪽과 바깥 복도 자리예요. 퇴원할 때 걸어 나가고, 고양이가 반길 때 다가와요. */
export function doorSpots(room: WardRoom): { inside: { x: number; z: number }; outside: { x: number; z: number } } {
  return {
    inside: roomToWorld(room, 0, ROOM.maxZ - 0.45),
    outside: roomToWorld(room, 0, ROOM.maxZ + WALL_THICKNESS + 0.6),
  };
}

/** 창틀 위 램프 자리예요. position은 창 폭을 -1~1로 본 값이에요. */
export function windowLampSpot(
  room: WardRoom,
  position: number,
): { x: number; y: number; z: number } {
  return {
    ...roomToWorld(room, position * WINDOW_LAMP_REACH, WINDOW_SILL_LOCAL_Z),
    y: WINDOW_SILL_TOP_Y,
  };
}

/** 고양이가 병실에서 걸어 다니는 자리들이에요. 병실 안쪽 좌표이고 가구를 피한 곳이에요. */
const CAT_SPOTS_LOCAL = [
  { x: 0, z: -3.2 },
  { x: 0, z: 3.2 },
  { x: -1.1, z: -1.6 },
  { x: 1.1, z: 1.6 },
  { x: -1.1, z: 1.6 },
  { x: 1.1, z: -3.8 },
] as const;

export function catSpots(room: WardRoom): { x: number; z: number }[] {
  return CAT_SPOTS_LOCAL.map((spot) => roomToWorld(room, spot.x, spot.z));
}

/** 이 자리가 있는 병실이에요. 병실 밖이면 null이에요. */
export function roomAt(x: number, z: number): WardRoom | null {
  return (
    ROOMS.find((room) => {
      const rect = roomRect(room);
      return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
    }) ?? null
  );
}

function rectAround(x: number, z: number, halfX: number, halfZ: number): Rect {
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

export function roomRect(room: WardRoom): Rect {
  return rectAround(room.x, room.z, ROOM.maxZ, ROOM.maxX);
}

/** 지나갈 수 없는 가구들이에요. 병실이 90도 돌아 있어서 침대의 긴 쪽은 z축을 따라요. */
export const OBSTACLES: readonly Rect[] = [
  ...BEDS.map((bed) => rectAround(bed.x, bed.z, BED_WIDTH / 2, BED_LENGTH / 2)),
  ...NIGHTSTANDS.map((stand) =>
    rectAround(stand.x, stand.z, NIGHTSTAND_SIZE / 2, NIGHTSTAND_SIZE / 2),
  ),
  ...TABLES.map((table) => rectAround(table.x, table.z, TABLE_RADIUS, TABLE_RADIUS)),
  ...FRIDGES.map((fridge) => rectAround(fridge.x, fridge.z, FRIDGE_WIDTH / 2, FRIDGE_DEPTH / 2)),
  ...IV_STANDS.map((stand) => rectAround(stand.x, stand.z, IV_STAND_RADIUS, IV_STAND_RADIUS)),
  ...CURTAIN_BUNCHES.map((bunch) =>
    rectAround(bunch.x, bunch.z, CURTAIN_BUNCH_HALF, CURTAIN_BUNCH_HALF),
  ),
  NURSE_STATION,
  ...ENTRANCE_GARDENS,
  rectAround(LOBBY_TREE.x, LOBBY_TREE.z, LOBBY_TREE.radius, LOBBY_TREE.radius),
  ...LOBBY_BENCHES.map((bench) =>
    rectAround(bench.x, bench.z, LOBBY_BENCH.length / 2, LOBBY_BENCH.depth / 2),
  ),
  ...ENTRANCE_PLANTERS.map((planter) => rectAround(planter.x, planter.z, 0.3, 0.3)),
  ...YARD_LAMPS.map((lamp) => rectAround(lamp.x, lamp.z, 0.1, 0.1)),
];

const doorRectOf = (room: WardRoom): Rect => {
  const side = Math.sign(room.x);
  const inner = CORRIDOR_HALF_WIDTH;
  const outer = CORRIDOR_HALF_WIDTH + WALL_THICKNESS;
  return {
    minX: side > 0 ? inner : -outer,
    maxX: side > 0 ? outer : -inner,
    minZ: room.z + DOOR.minX,
    maxZ: room.z + DOOR.maxX,
  };
};

export const DOOR_RECTS: readonly Rect[] = ROOMS.map(doorRectOf);

const CORRIDOR_LOBBY_LINK: Rect = {
  minX: CORRIDOR.minX,
  maxX: CORRIDOR.maxX,
  minZ: CORRIDOR.maxZ - 0.01,
  maxZ: LOBBY.minZ + 0.01,
};
const ENTRANCE_RECT: Rect = {
  minX: ENTRANCE.minX,
  maxX: ENTRANCE.maxX,
  minZ: ENTRANCE.minZ,
  maxZ: ENTRANCE.maxZ,
};

/** 바닥을 눌렀을 때 이동 요청으로 받아 주는 영역이에요. */
export const FLOOR_AREAS: readonly Rect[] = [
  ...ROOMS.map(roomRect),
  ...DOOR_RECTS,
  CORRIDOR,
  CORRIDOR_LOBBY_LINK,
  LOBBY,
  ENTRANCE_RECT,
  YARD,
];

function shrink(rect: Rect): Rect {
  return {
    minX: rect.minX + PLAYER_RADIUS,
    maxX: rect.maxX - PLAYER_RADIUS,
    minZ: rect.minZ + PLAYER_RADIUS,
    maxZ: rect.maxZ - PLAYER_RADIUS,
  };
}

const CONNECTOR_REACH = PLAYER_RADIUS + 0.1;

/** 캐릭터 중심이 머물 수 있는 영역이에요. 벽에서 캐릭터 반지름만큼 떨어져 있어요. */
export const WALK_AREAS: readonly Rect[] = [
  ...ROOMS.map((room) => shrink(roomRect(room))),
  ...DOOR_RECTS.map((door) => ({
    minX: door.minX - CONNECTOR_REACH,
    maxX: door.maxX + CONNECTOR_REACH,
    minZ: door.minZ + PLAYER_RADIUS,
    maxZ: door.maxZ - PLAYER_RADIUS,
  })),
  shrink(CORRIDOR),
  {
    minX: CORRIDOR.minX + PLAYER_RADIUS,
    maxX: CORRIDOR.maxX - PLAYER_RADIUS,
    minZ: CORRIDOR.maxZ - CONNECTOR_REACH,
    maxZ: LOBBY.minZ + CONNECTOR_REACH,
  },
  shrink(LOBBY),
  {
    minX: ENTRANCE.minX + PLAYER_RADIUS,
    maxX: ENTRANCE.maxX - PLAYER_RADIUS,
    minZ: ENTRANCE.minZ - CONNECTOR_REACH,
    maxZ: ENTRANCE.maxZ + CONNECTOR_REACH,
  },
  shrink(YARD),
];

/** 건물이 차지하는 자리예요. 눈은 이 안에 내리지 않아요. */
export function isInsideWard(x: number, z: number): boolean {
  return x >= BUILDING.minX && x <= BUILDING.maxX && z >= BUILDING.minZ && z <= BUILDING.maxZ;
}

const wallBox = (
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY = 0,
  maxY = WALL_HEIGHT,
): WallBox => ({ minX, maxX, minZ, maxZ, minY, maxY });

/** 왼쪽(-1)이나 오른쪽(1)의 x 범위를 작은 값부터 돌려줘요. */
const mirrored = (side: number, from: number, to: number): [number, number] =>
  side > 0 ? [from, to] : [-to, -from];

function corridorWallBoxes(side: number): WallBox[] {
  const [minX, maxX] = mirrored(side, CORRIDOR_HALF_WIDTH, CORRIDOR_HALF_WIDTH + WALL_THICKNESS);
  const openings = [
    ...ROOMS.filter((room) => Math.sign(room.x) === side).map((room) => ({
      minZ: room.z + DOOR.minX,
      maxZ: room.z + DOOR.maxX,
      headerY: DOOR.height,
    })),
  ].sort((a, b) => a.minZ - b.minZ);

  const boxes: WallBox[] = [];
  let z = CORRIDOR.minZ;
  for (const opening of openings) {
    boxes.push(wallBox(minX, maxX, z, opening.minZ));
    boxes.push(wallBox(minX, maxX, opening.minZ, opening.maxZ, opening.headerY));
    z = opening.maxZ;
  }
  boxes.push(wallBox(minX, maxX, z, CORRIDOR.maxZ));
  return boxes;
}

function buildWallBoxes(): WallBox[] {
  const boxes: WallBox[] = [...corridorWallBoxes(-1), ...corridorWallBoxes(1)];
  for (const side of [-1, 1]) {
    const [partitionMinX, partitionMaxX] = mirrored(
      side,
      CORRIDOR_HALF_WIDTH + WALL_THICKNESS,
      OUTER_WALL_X,
    );
    for (const z of [ROWS_Z[0] + ROOM.maxX, ROWS_Z[1] + ROOM.maxX]) {
      boxes.push(wallBox(partitionMinX, partitionMaxX, z, z + WALL_THICKNESS));
    }
    // 로비와 병실 사이의 벽
    const [lobbyMinX, lobbyMaxX] = mirrored(side, CORRIDOR_HALF_WIDTH, OUTER_WALL_X);
    boxes.push(wallBox(lobbyMinX, lobbyMaxX, NEAR_ROOM_EDGE_Z, LOBBY.minZ));
    // 바깥벽
    const [outerMinX, outerMaxX] = mirrored(side, OUTER_WALL_X, BUILDING.maxX);
    boxes.push(wallBox(outerMinX, outerMaxX, BUILDING.minZ, BUILDING.maxZ, 0, BUILDING_HEIGHT));
  }
  // 복도 끝 바깥벽
  boxes.push(wallBox(BUILDING.minX, BUILDING.maxX, BUILDING.minZ, CORRIDOR.minZ, 0, BUILDING_HEIGHT));
  // 현관이 있는 앞벽과 현관 위쪽
  boxes.push(wallBox(BUILDING.minX, ENTRANCE.minX, LOBBY.maxZ, BUILDING.maxZ, 0, BUILDING_HEIGHT));
  boxes.push(wallBox(ENTRANCE.maxX, BUILDING.maxX, LOBBY.maxZ, BUILDING.maxZ, 0, BUILDING_HEIGHT));
  boxes.push(
    wallBox(ENTRANCE.minX, ENTRANCE.maxX, LOBBY.maxZ, BUILDING.maxZ, ENTRANCE.height, BUILDING_HEIGHT),
  );
  // 복도와 로비 사이 위쪽 벽
  boxes.push(wallBox(CORRIDOR.minX, CORRIDOR.maxX, NEAR_ROOM_EDGE_Z, LOBBY.minZ, HEADER_Y));
  // 천장과 그 위 건물
  boxes.push(
    wallBox(BUILDING.minX, BUILDING.maxX, BUILDING.minZ, BUILDING.maxZ, WALL_HEIGHT, BUILDING_HEIGHT),
  );
  return boxes;
}

export const WALL_BOXES: readonly WallBox[] = buildWallBoxes();

/** 빛 두 개를 둘 자리예요. 캐릭터가 있는 공간을 고르게 비추도록 정해요. */
export function lightSpots(x: number, z: number): readonly [
  { x: number; z: number },
  { x: number; z: number },
] {
  const room = ROOMS.find((candidate) => {
    const rect = roomRect(candidate);
    return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
  });
  if (room) {
    return [
      { x: room.x - 2.5, z: room.z },
      { x: room.x + 2.5, z: room.z },
    ];
  }
  if (z < CORRIDOR.maxZ) {
    return [
      { x: 0, z: z - 3 },
      { x: 0, z: z + 3 },
    ];
  }
  return [
    { x: -5, z: (LOBBY.minZ + LOBBY.maxZ) / 2 },
    { x: 5, z: (LOBBY.minZ + LOBBY.maxZ) / 2 },
  ];
}
