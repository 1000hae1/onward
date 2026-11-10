import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Plane,
  Raycaster,
  RingGeometry,
  TOUCH,
  Vector2,
  Vector3,
} from "three";
import type { Scene, Texture } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createAvatar } from "../avatar/avatar";
import { AVATAR_HEIGHT, HAND_HEIGHT, HAND_REACH } from "../avatar/kit";
import {
  advanceBreath,
  SLEEP_BREATH_AMOUNT,
  SLEEP_BREATH_SECONDS,
  BED_TRANSITION_SECONDS,
  composePose,
  createPose,
  gestureDuration,
  STRIDE_LENGTH,
} from "../avatar/pose";
import type { Gesture } from "../avatar/pose";
import type { AvatarChoice } from "../avatar/species";
import {
  arrivedAtBed,
  becomeVisitor,
  bedProgress,
  bedTapIntent,
  canStartGesture,
  FREE,
  getUp,
  tapBed,
  tapFloor,
  tickFlow,
} from "./bed-flow";
import type { BedFlow, FlowStep, WalkOrder } from "./bed-flow";
import {
  arrivedAtSeat,
  headToSeat,
  isSeated,
  NO_SEAT,
  rise,
  seatAllowsGesture,
  seatInUse,
  seatProgress,
  tickSeat,
} from "./seat-flow";
import type { SeatFlow } from "./seat-flow";
import { benchTap } from "../../shared/bench-rules";
import {
  cameraAngleToSee,
  easeDistance,
  enteredThroughFront,
  firstBlocked,
  glancePhase,
  pickBox,
  pullCamera,
  turnToward,
} from "./camera-view";
import {
  BED_BOXES,
  BENCH_BOXES,
  bedApproach,
  bedRest,
  bedRestYaw,
  BEDS,
  FLOOR_AREAS,
  LOBBY,
  NURSE_STATION,
  NURSE_STATION_CENTER_X,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_START,
  seatApproach,
  seatRest,
  seatYaw,
  WALK_AREAS,
  WALL_BOXES,
  YARD_BENCH,
} from "../../shared/ward-layout";
import { createNavGrid, stepAlong } from "./movement";
import type { NavGrid, Point } from "./movement";

const WALK_SPEED = 1.8;
/** 카메라가 바라보는 높이예요. 아바타 키보다 조금 위예요. */
const TARGET_HEIGHT = AVATAR_HEIGHT + 0.2;
/** 걷는 방향으로 몸을 돌리는 빠르기예요. */
const BODY_TURN_RATE = 10;
/** 걷기 동작이 시작되고 잦아드는 빠르기예요. */
const WALK_BLEND_RATE = 9;
/** 눕는 동안 카메라가 침대 발치 쪽으로 돌아가는 빠르기예요. */
const BED_CAMERA_TURN_RATE = 2.6;
const FLOOR_SHADOW_Y = 0.014;
/** 침대에 누우면 그림자가 이불 위로 올라와요. */
const BED_SHADOW_Y = 0.655;
const CAMERA_START_BACK = 4.6;
const CAMERA_START_UP = 0.55;
const CAMERA_MIN_DISTANCE = 1.4;
const CAMERA_MAX_DISTANCE = 8;
/** 벽 앞으로 당긴 카메라가 벽에서 떨어지는 거리예요. */
const CAMERA_WALL_CLEARANCE = 0.25;
/** 카메라가 이만큼 가까워지면 캐릭터에 가리지 않게 캐릭터를 숨겨요. */
const HIDE_PLAYER_DISTANCE = 0.6;
/** 걷는 동안 카메라가 캐릭터 뒤로 돌아가는 빠르기예요. */
const FOLLOW_TURN_RATE = 1.7;
/** 벽에서 벗어난 카메라가 원래 거리로 물러나는 빠르기예요. */
const CAMERA_RELEASE_RATE = 2.5;
/** 로비에 들어설 때 간호사실을 비추는 시간과 빠르기예요. */
const GLANCE_LOOK_SECONDS = 2.4;
const GLANCE_RETURN_SECONDS = 1.6;
const GLANCE_TURN_RATE = 2.6;
const NURSE_STATION_SPOT = {
  x: NURSE_STATION_CENTER_X,
  z: (NURSE_STATION.minZ + NURSE_STATION.maxZ) / 2,
};
const TAP_MAX_MOVE_PX = 8;
const TAP_MAX_MS = 450;
/** 손가락으로 이만큼 누르고 있으면 길게 누른 거예요. */
export const LONG_PRESS_MS = 500;
const MARKER_SECONDS = 0.9;
/** 누른 방향으로 살펴보는 거리예요. 앞마당 끝에서 건물 안쪽까지 닿아요. */
const TAP_REACH = 80;

/**
 * 쓰고 있거나 눕으러 가는 침대예요. 일어나서 다른 침대로 가는 중이면 그 침대예요.
 * 서버에는 침대가 하나뿐이라, 이 값이 비는 순간에만 일어났다고 알려요.
 */
function claimedOf(flow: BedFlow): number | null {
  switch (flow.kind) {
    case "heading":
      return flow.lie ? flow.bed : null;
    case "entering":
    case "lying":
      return flow.bed;
    case "leaving":
      return flow.next?.kind === "bed" && flow.next.lie ? flow.next.bed : null;
    default:
      return null;
  }
}

/** 내 동작을 병동 서버에 알리는 곳이에요. */
export interface PlayerNet {
  /** 내 침대에 눕겠다고 해요. */
  askBed(bed: number): Promise<boolean>;
  /** 이 침대를 내 침대로 달라고 해요. 서버가 먼저 온 사람에게 줘요. */
  claimBed(bed: number): Promise<boolean>;
  /** 다른 분이 배정받은 침대인지예요. 그분이 지금 걸어 다녀도 그분 것이에요. */
  isBedTaken(bed: number): boolean;
  /** 다른 분의 침대를 눌렀어요. 그분 메뉴를 보여 줘요. */
  othersBed(bed: number): void;
  walkTo(x: number, z: number): void;
  getUp(): void;
  /** 다른 분이 먼저 침대를 차지했을 때예요. moving이면 침대를 옮기려던 때예요. */
  bedRefused(moving: boolean): void;
  /** 앞마당 벤치 자리에 앉겠다고 해요. 서버가 먼저 온 사람을 앉혀요. */
  askSeat(seat: number): Promise<boolean>;
  /** 다른 분이 앉아 있는 자리인지예요. */
  isSeatTaken(seat: number): boolean;
  /** 벤치에서 일어났다고 알려요. 걸어가면 walkTo가 대신 알려요. */
  standUp(): void;
  /** 벤치에 앉지 못했을 때예요. full이면 누르기 전부터 두 자리가 다 차 있었어요. */
  seatRefused(full: boolean): void;
}

export interface PlayerControls {
  update(dt: number): void;
  /** 캐릭터의 현재 위치예요. 누워 있으면 침대 위 자리예요. */
  readonly x: number;
  readonly z: number;
  /** 손 모으기와 목례를 지금 할 수 있는지 알려 줘요. */
  readonly canGesture: boolean;
  setChoice(choice: AvatarChoice): void;
  playGesture(gesture: Gesture): void;
  /** 모습을 고르는 동안에는 얼굴이 보이도록 카메라 쪽을 바라봐요. */
  setFacingCamera(facing: boolean): void;
  /** 입장 전처럼 탭으로 움직이면 안 될 때 꺼요. 드래그로 둘러보기는 그대로예요. */
  setInputEnabled(enabled: boolean): void;
  /** 병동 서버와 이어지면 침대와 걷기를 서버에 알려요. 혼자 쓰는 화면이면 null이에요. */
  setNet(net: PlayerNet | null): void;
  /** 서버가 목적지를 고쳐 주면 그쪽으로 다시 걸어요. 서버에는 다시 알리지 않아요. */
  correctDestination(x: number, z: number): void;
  /** 서버가 침대를 내주지 않으면 일어나요. 다시 이어졌을 때 침대를 잃었을 때예요. */
  forceGetUp(): void;
  /** 수면 모드에서는 카메라를 지금 자리에 고정해요. 드래그와 확대를 받지 않아요. */
  setCameraLocked(locked: boolean): void;
  /** 수면 모드예요. 눈을 감고 이불을 덮고 아주 느리게 숨쉬어요. 누워 있을 때만 그렇게 보여요. */
  setAsleep(asleep: boolean): void;
  /** 길찾기 격자예요. 다른 사람의 걸음을 그릴 때 함께 써요. */
  readonly nav: NavGrid;
  /** 고른 침대로 이동해요. 기존 확인 절차와 서버 점유 검사를 거쳐요. */
  chooseBed(bed: number): void;
  /** 다른 침대를 고르는 동안 침대 탭을 받아요. 이때 바닥을 눌러도 걷지 않아요. */
  setBedPicker(picker: ((bed: number) => void) | null): void;
  /**
   * 내 침대가 있는데 다른 빈 침대를 누르면 옮길지 묻는 곳이에요. 옮기기로 하면 proceed를 불러요.
   * null이면 묻지 않고 바로 옮겨요.
   */
  setMoveConfirm(ask: ((bed: number, proceed: () => void) => void) | null): void;
  /**
   * 아직 내 침대가 없을 때 빈 침대를 누르면 "이 침대를 쓰시겠어요?"를 묻는 곳이에요. 쓰기로 하면 proceed를 불러요.
   * null이면 묻지 않고 바로 받아요.
   */
  setClaimConfirm(ask: ((bed: number, proceed: () => void) => void) | null): void;
  /** 서버가 알려 준 내 침대예요. 다르게 누워 있었으면 일어나요. */
  setOwnedBed(bed: number | null): void;
  /** 현관으로 병동에 들어설 때마다 불러요. 간호사가 인사해요. */
  setLobbyListener(listener: (() => void) | null): void;
  /** 침대와 바닥보다 먼저 탭을 살펴봐요. true를 돌려주면 걷지 않아요. 고양이가 써요. */
  setTapFilter(filter: ((origin: Vector3, reach: Vector3) => boolean) | null): void;
  /** 휴대폰에서 길게 누르면 불러요. true를 돌려주면 손을 뗄 때 탭으로 보지 않아요. */
  setLongPress(handler: ((origin: Vector3, reach: Vector3) => boolean) | null): void;
  /** 누워 있으면 일어난 뒤에, 아니면 바로 action을 해요. */
  whenUp(action: () => void): void;
  faceToward(x: number, z: number): void;
  /**
   * 서버가 정한 자리로 걸어가요. 서버에는 다시 알리지 않아요(안아 주기처럼 서버가 이미 자리를 옮겨 둔 때예요).
   * 다 도착하면 then을 불러요. 누르면 다른 곳으로 가니 then도 잊어요.
   */
  walkToSpot(x: number, z: number, then: () => void, tellServer?: boolean): void;
  /** 방명록 링크로 들어오면 주인 침대 곁에서 바로 시작해요. 카메라도 함께 옮겨 침대를 바라봐요. */
  placeAt(x: number, z: number, faceX: number, faceZ: number): void;
  /** 빛과 선물이 떠나는 손 앞 자리예요. */
  handSpot(): { x: number; y: number; z: number };
  /** 화면에 보이면 머리 자리를 target에 쓰고, 숨어 있으면 null을 돌려줘요. */
  headWorld(target: Vector3): Vector3 | null;
  /** 머리 위 등불 자리를 target에 쓰고 발밑 높이를 돌려줘요. 아바타가 보이지 않으면 null이에요. */
  lanternWorld(target: Vector3): number | null;
  /** 걸어 다니는 자리예요. 누워 있어도 침대 곁 자리예요. */
  readonly walkX: number;
  readonly walkZ: number;
  /** 다 누운 침대예요. */
  readonly lyingBed: number | null;
  /** 쓰고 있거나 눕으러 가는 침대예요. */
  readonly claimedBed: number | null;
  /** 배정받은 내 침대예요. 걸어 다녀도 그대로예요. 문병객이거나 아직 고르지 않았으면 null이에요. */
  readonly ownedBed: number | null;
  /** 앉아 있거나 앉으러 가는 벤치 자리예요. */
  readonly seat: number | null;
  /** 벤치에 앉는 중이거나 앉아 있거나 일어나는 중이에요. */
  readonly seated: boolean;
  /** 벤치에서 일어나요. 서버가 이미 자리를 비웠을 때(안아 주기, 다시 이었을 때) 써요. */
  leaveSeat(): void;
}

/** 아바타와 3인칭 카메라예요. 드래그는 둘러보기, 짧은 탭은 이동, 침대를 탭하면 눕기예요. */
export function createPlayerControls(
  scene: Scene,
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  softCircle: Texture,
  initialChoice: AvatarChoice,
): PlayerControls {
  const nav = createNavGrid({
    areas: WALK_AREAS,
    obstacles: OBSTACLES,
    radius: PLAYER_RADIUS,
    cellSize: 0.2,
  });

  const avatar = createAvatar(initialChoice);
  scene.add(avatar.root);

  const shadowGeometry = new PlaneGeometry(0.8, 0.8);
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadow = new Mesh(
    shadowGeometry,
    new MeshBasicMaterial({
      map: softCircle,
      color: "#3a2a1c",
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  shadow.position.set(PLAYER_START.x, 0.014, PLAYER_START.z);
  scene.add(shadow);

  const markerMaterial = new MeshBasicMaterial({
    color: "#fff3d6",
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const markerGeometry = new RingGeometry(0.14, 0.2, 24);
  markerGeometry.rotateX(-Math.PI / 2);
  const marker = new Mesh(markerGeometry, markerMaterial);
  marker.position.y = 0.016;
  marker.visible = false;
  scene.add(marker);
  let markerAge = MARKER_SECONDS;

  // 드래그와 확대·축소는 입력 전용 카메라가 받아요. OrbitControls는 입력을 받는 즉시 카메라를
  // 옮기기 때문에, 벽에 맞춰 조정되는 화면 카메라와 나눠 두어야 입력이 지워지지 않아요.
  const rig = new PerspectiveCamera();
  rig.position.set(
    PLAYER_START.x,
    TARGET_HEIGHT + CAMERA_START_UP,
    PLAYER_START.z + CAMERA_START_BACK,
  );
  /** 벽 때문에 당겨지기 전의, 사용자가 바라는 카메라 자리예요. */
  const desired = rig.position;
  camera.position.copy(desired);

  const controls = new OrbitControls(rig, canvas);
  controls.target.set(PLAYER_START.x, TARGET_HEIGHT, PLAYER_START.z);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.minDistance = CAMERA_MIN_DISTANCE;
  controls.maxDistance = CAMERA_MAX_DISTANCE;
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = 1.75;
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /** 화면에 실제로 보이는 카메라 거리예요. 벽에 막히면 바라는 거리보다 짧아요. */
  let viewDistance = desired.distanceTo(controls.target);

  /** 확대는 지금 보이는 거리부터 시작해요. 벽에 막혀 있어도 바로 반응하게 해요. */
  const startZoomFromView = (): void => {
    if (viewDistance >= desired.distanceTo(controls.target)) return;
    desired.sub(controls.target).setLength(viewDistance).add(controls.target);
  };
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY < 0) startZoomFromView();
    },
    // OrbitControls가 확대를 적용하기 전에 시작 거리를 맞춰요.
    { passive: true, capture: true },
  );

  /** 걸어 다니는 자리예요. 누워 있는 동안에는 침대 곁 자리에 머물러요. */
  let position: Point = { x: PLAYER_START.x, z: PLAYER_START.z };
  /** 화면에 보이는 자리예요. 침대에 오르내리는 동안 position과 달라요. */
  let shownX = position.x;
  let shownZ = position.z;
  let path: Point[] = [];

  /** 배정받은 내 침대예요. 서버에 이어져 있으면 서버가 정한 값이고, 혼자일 때는 이 화면에서 정해요. */
  let ownedBed: number | null = null;
  let flow: BedFlow = FREE;
  let seatFlow: SeatFlow = NO_SEAT;
  /** 벤치에서 다 일어난 뒤 할 일이에요. 없으면 일어났다고 서버에 알려요. */
  let afterRise: (() => void) | null = null;
  /** 가장 최근에 벤치 자리를 물어본 askToken이에요. */
  let lastSeatAsk = 0;
  let outfit = initialChoice.outfit;
  /** 처음에는 현관을 바라봐요. */
  let yaw = Math.PI;
  /** 멈춘 뒤 돌아볼 곳이 있으면 그 각도예요. */
  let yawGoal: number | null = null;
  let walkPhase = 0;
  let walkWeight = 0;
  let breathPhase = 0;
  let asleep = false;
  let gesture: Gesture | null = null;
  let gestureElapsed = 0;
  let facingCamera = false;
  let inputEnabled = true;
  let bedPicker: ((bed: number) => void) | null = null;
  let tapFilter: ((origin: Vector3, reach: Vector3) => boolean) | null = null;
  let longPress: ((origin: Vector3, reach: Vector3) => boolean) | null = null;
  let afterUp: (() => void) | null = null;
  /** walkToSpot으로 가는 중이면 도착해서 할 일이에요. */
  let afterWalk: (() => void) | null = null;
  let net: PlayerNet | null = null;
  let moveConfirm: ((bed: number, proceed: () => void) => void) | null = null;
  let claimConfirm: ((bed: number, proceed: () => void) => void) | null = null;
  let lobbyListener: (() => void) | null = null;
  /** 가장 최근에 침대를 물어본 번호예요. 답이 늦게 오면 이미 다른 곳을 눌렀는지 견줘요. */
  let askToken = 0;
  let lastClaimed: number | null = null;
  const pose = createPose();
  /** 로비에 들어서며 간호사실을 비추는 중이면 경과 시간과 돌아갈 각도를 담아요. */
  let glance: { elapsed: number; returnAngle: number } | null = null;

  const cameraAngle = (): number =>
    Math.atan2(desired.x - controls.target.x, desired.z - controls.target.z);

  /** 카메라를 캐릭터 둘레로 돌려요. 높이와 거리는 그대로예요. */
  const orbitToward = (goal: number, amount: number): void => {
    const offsetX = desired.x - controls.target.x;
    const offsetZ = desired.z - controls.target.z;
    const radius = Math.hypot(offsetX, offsetZ);
    const angle = turnToward(Math.atan2(offsetX, offsetZ), goal, amount);
    desired.x = controls.target.x + Math.sin(angle) * radius;
    desired.z = controls.target.z + Math.cos(angle) * radius;
  };

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();

  /** 누른 곳에서 걸어갈 자리를 찾아요. 벽이나 건물을 누르면 그 앞으로 가요. 하늘을 누르면 없어요. */
  const tappedSpot = (origin: Vector3, direction: Vector3): Point | null => {
    const reach = origin.clone().addScaledVector(direction, TAP_REACH);
    const blocked = firstBlocked(origin, reach, WALL_BOXES);
    const floorHit = raycaster.ray.intersectPlane(floorPlane, hit);
    const floorDistance = floorHit ? origin.distanceTo(floorHit) : Infinity;

    if (blocked * TAP_REACH < floorDistance) {
      if (blocked >= 1) return null;
      const wallSpot = origin.clone().addScaledVector(direction, blocked * TAP_REACH - 0.05);
      return { x: wallSpot.x, z: wallSpot.z };
    }
    const onFloor = FLOOR_AREAS.some(
      (area) =>
        hit.x >= area.minX && hit.x <= area.maxX && hit.z >= area.minZ && hit.z <= area.maxZ,
    );
    return onFloor ? { x: hit.x, z: hit.z } : null;
  };

  /** 벤치에서 일어나기 시작해요. 다 일어나면 then을 해요. */
  const riseThen = (then: (() => void) | null): void => {
    seatFlow = rise(seatFlow, BED_TRANSITION_SECONDS);
    afterRise = then;
  };

  /**
   * 정해진 곳까지 길을 찾아 걷기 시작해요. 길이 없으면 그 자리에 머물러요.
   * 벤치에 앉아 있으면 먼저 일어나요. seat가 있으면 그 자리에 앉으러 가는 길이에요.
   */
  const startWalk = (order: WalkOrder, tellServer = true, seat?: number): void => {
    if (isSeated(seatFlow)) {
      riseThen(() => startWalk(order, tellServer, seat));
      return;
    }
    const spot = order.kind === "bed" ? bedApproach(BEDS[order.bed]) : order.point;
    const goal = nav.nearestFree(spot);
    const nextPath = goal ? nav.findPath(position, goal) : [];
    seatFlow = NO_SEAT;
    if (!goal || nextPath.length === 0) {
      if (flow.kind === "heading") flow = FREE;
      return;
    }
    if (seat !== undefined) seatFlow = headToSeat(seat);
    // 눕으러 가는 길은 서버가 침대를 내줄 때 이미 알고 있어요. 그 밖의 걸음만 목적지를 알려요.
    if (tellServer && !(order.kind === "bed" && order.lie)) net?.walkTo(goal.x, goal.z);
    path = nextPath;
    gesture = null;
    yawGoal = null;
    marker.position.x = goal.x;
    marker.position.z = goal.z;
    marker.visible = true;
    markerAge = 0;
  };

  const applyStep = (step: FlowStep): void => {
    flow = step.flow;
    if (step.walk) startWalk(step.walk);
    if (step.bowAtBed !== undefined) {
      const bed = BEDS[step.bowAtBed];
      yawGoal = Math.atan2(bed.x - position.x, bed.z - position.z);
      gesture = "bow";
      gestureElapsed = 0;
    }
  };

  /** 내 침대로 가서 누워요. 이미 누워 있으면 일어나요. 서버에 이어져 있으면 먼저 알리고, 허락받으면 걸어가요. */
  const lieOnOwnBed = (bed: number, token: number): void => {
    const already =
      (flow.kind === "heading" || flow.kind === "entering" || flow.kind === "lying") && flow.bed === bed;
    if (!net || already) {
      applyStep(tapBed(flow, bed, { canLie: true, isFree: true }, BED_TRANSITION_SECONDS));
      return;
    }
    const asking = net;
    void asking.askBed(bed).then((granted) => {
      if (token !== askToken) {
        // 그사이 다른 곳을 눌렀어요. 서버는 누운 줄 아니 일어났다고 알려요. 침대는 그대로 내 것이에요.
        if (granted && claimedOf(flow) !== bed) asking.getUp();
        return;
      }
      if (granted) applyStep(tapBed(flow, bed, { canLie: true, isFree: true }, BED_TRANSITION_SECONDS));
    });
  };

  /** 침대를 내 침대로 받고 누우러 가요. 서버가 먼저 온 사람에게 주고, 받은 뒤에야 걸어가요. */
  const claimAndLie = (bed: number, token: number, moving: boolean): void => {
    if (!net) {
      ownedBed = bed;
      lieOnOwnBed(bed, token);
      return;
    }
    const asking = net;
    void asking.claimBed(bed).then((granted) => {
      if (!granted) {
        // 서버는 침대를 내주지 않을 때 원래 침대를 그대로 둬요. 여기서도 그대로예요.
        asking.bedRefused(moving);
        return;
      }
      ownedBed = bed;
      // 그사이 다른 곳을 눌렀어도 받은 침대는 내 것이에요. 걸어가지만 않아요.
      if (token !== askToken) return;
      lieOnOwnBed(bed, token);
    });
  };

  const chooseBed = (bed: number): void => {
    afterUp = null;
    afterWalk = null;
    const token = ++askToken;
    const intent = bedTapIntent(bed, {
      canLie: outfit === "patient",
      ownedBed,
      takenByOther: net ? net.isBedTaken(bed) : false,
    });
    switch (intent) {
      case "visit":
        applyStep(tapBed(flow, bed, { canLie: false, isFree: true }, BED_TRANSITION_SECONDS));
        return;
      case "own":
        lieOnOwnBed(bed, token);
        return;
      case "others":
        net?.othersBed(bed);
        return;
      case "claim":
      case "move": {
        const moving = intent === "move";
        const ask = moving ? moveConfirm : claimConfirm;
        // 묻는 사이 다른 곳을 누르면 잊어요.
        const proceed = (): void => {
          if (token !== askToken || outfit !== "patient") return;
          claimAndLie(bed, token, moving);
        };
        if (ask) ask(bed, proceed);
        else proceed();
        return;
      }
    }
  };

  /** 벤치 자리로 가서 앉아요. 누워 있거나 다른 자리에 앉아 있으면 먼저 일어나요. 서버는 이미 허락했어요. */
  const goToSeat = (seat: number): void => {
    if (isSeated(seatFlow)) {
      riseThen(() => goToSeat(seat));
      return;
    }
    if (!canStartGesture(flow)) {
      // 침대에서 일어난 뒤에 가요. 일어난 뒤 가려던 곳은 잊어요.
      if (flow.kind === "leaving") flow = { ...flow, next: null };
      afterUp = () => goToSeat(seat);
      applyStep(getUp(flow, BED_TRANSITION_SECONDS));
      return;
    }
    flow = FREE;
    gesture = null;
    const spot = seatApproach(seat);
    if (Math.hypot(spot.x - position.x, spot.z - position.z) < 0.15) {
      path = [];
      seatFlow = arrivedAtSeat(headToSeat(seat));
      yawGoal = seatYaw(seat);
      return;
    }
    startWalk({ kind: "spot", point: spot }, false, seat);
  };

  /** 벤치에서 일어나요. 앉으러 가던 중이면 그만둬요. 서버에도 알려요. */
  const standFromSeat = (): void => {
    if (seatFlow.kind === "heading") {
      seatFlow = NO_SEAT;
      path = [];
    } else if (isSeated(seatFlow)) {
      riseThen(null);
    }
    net?.standUp();
  };

  /** 벤치를 눌렀을 때예요. 빈자리를 서버에 먼저 묻고, 허락받으면 걸어가요. */
  const chooseBench = (bench: number, token: number): void => {
    const tap = benchTap(bench, { seat: seatInUse(seatFlow), x: position.x, z: position.z }, (seat) =>
      net ? net.isSeatTaken(seat) : false,
    );
    if (tap.kind === "stand") {
      standFromSeat();
      return;
    }
    if (tap.kind === "full") {
      net?.seatRefused(true);
      return;
    }
    if (!net) {
      goToSeat(tap.seat);
      return;
    }
    const asking = net;
    lastSeatAsk = token;
    void asking.askSeat(tap.seat).then((granted) => {
      if (!granted) {
        if (token === askToken) asking.seatRefused(false);
        return;
      }
      if (token !== askToken) {
        // 그사이 다른 곳을 눌렀어요. 서버는 앉은 줄 아니 일어났다고 알려요. 다른 벤치를 다시 물었으면 그대로 둬요.
        if (lastSeatAsk === token && seatInUse(seatFlow) === null) asking.standUp();
        return;
      }
      goToSeat(tap.seat);
    });
  };

  /** 화면의 한 점에서 병실로 뻗는 시선이에요. */
  const rayAt = (clientX: number, clientY: number): { origin: Vector3; direction: Vector3; reach: Vector3 } => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const { origin, direction } = raycaster.ray;
    return { origin, direction, reach: origin.clone().addScaledVector(direction, TAP_REACH) };
  };

  const handleTap = (clientX: number, clientY: number): void => {
    if (!inputEnabled) return;
    const { origin, direction, reach } = rayAt(clientX, clientY);
    const bed = pickBox(origin, reach, BED_BOXES, WALL_BOXES);
    if (bedPicker) {
      if (bed !== null) bedPicker(bed);
      return;
    }
    if (tapFilter?.(origin, reach)) return;
    // 새로 누른 곳으로 가요. 일어난 뒤에 하려던 동작은 잊어요.
    afterUp = null;
    afterWalk = null;
    const token = ++askToken;
    if (bed !== null) {
      chooseBed(bed);
      return;
    }
    const bench = pickBox(origin, reach, BENCH_BOXES, WALL_BOXES);
    if (bench !== null) {
      chooseBench(bench, token);
      return;
    }

    const tapped = tappedSpot(origin, direction);
    const goal = tapped && nav.nearestFree(tapped);
    if (!goal) return;
    applyStep(tapFloor(flow, goal, BED_TRANSITION_SECONDS));
  };

  // 여러 손가락이 닿았던 제스처는 탭으로 보지 않아요.
  const activePointers = new Set<number>();
  let dragging = false;
  let tapStart: { x: number; y: number; time: number; id: number } | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPress = (): void => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };

  canvas.addEventListener("pointerdown", (event) => {
    activePointers.add(event.pointerId);
    dragging = true;
    if (activePointers.size === 2) startZoomFromView();
    tapStart =
      activePointers.size === 1 && event.button === 0
        ? { x: event.clientX, y: event.clientY, time: event.timeStamp, id: event.pointerId }
        : null;
    cancelPress();
    // 손가락으로 길게 누르면 바로 하는 동작이 있어요(고양이 쓰다듬기).
    const start = tapStart;
    if (start && event.pointerType === "touch" && longPress) {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (tapStart !== start || !inputEnabled || !longPress) return;
        const { origin, reach } = rayAt(start.x, start.y);
        if (longPress(origin, reach)) tapStart = null;
      }, LONG_PRESS_MS);
    }
  });
  // 길게 누르는 동안 브라우저 메뉴가 뜨지 않게 해요.
  canvas.addEventListener("contextmenu", (event) => {
    if (longPress) event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pressTimer === null || !tapStart || tapStart.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > TAP_MAX_MOVE_PX) cancelPress();
  });
  canvas.addEventListener("pointerup", (event) => {
    cancelPress();
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) dragging = false;
    const start = tapStart;
    if (!start || start.id !== event.pointerId) return;
    tapStart = null;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved <= TAP_MAX_MOVE_PX && event.timeStamp - start.time <= TAP_MAX_MS) {
      handleTap(event.clientX, event.clientY);
    }
  });
  canvas.addEventListener("pointercancel", (event) => {
    cancelPress();
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) dragging = false;
    tapStart = null;
  });

  return {
    get x() {
      return shownX;
    },
    get z() {
      return shownZ;
    },
    get canGesture() {
      return canStartGesture(flow) && seatAllowsGesture(seatFlow);
    },
    setChoice(choice) {
      avatar.setChoice(choice);
      outfit = choice.outfit;
      if (outfit === "visitor") {
        // 문병객으로 바꾸면 서버가 침대를 반납해요. 여기서도 비워요.
        ownedBed = null;
        applyStep(becomeVisitor(flow, BED_TRANSITION_SECONDS));
      }
    },
    playGesture(next) {
      if (!canStartGesture(flow) || !seatAllowsGesture(seatFlow)) return;
      // 걷던 중이면 멈춰 서서 해요. 다른 사람 화면에서도 여기서 멈추게 알려요. 벤치로 가던 길이면 앉지 않아요.
      if (path.length > 0) {
        net?.walkTo(position.x, position.z);
        if (seatFlow.kind === "heading") seatFlow = NO_SEAT;
      }
      flow = FREE;
      path = [];
      gesture = next;
      gestureElapsed = 0;
    },
    setFacingCamera(facing) {
      facingCamera = facing;
    },
    setInputEnabled(enabled) {
      inputEnabled = enabled;
    },
    setNet(next) {
      net = next;
    },
    correctDestination(x, z) {
      if (path.length === 0 || flow.kind !== "free" || seatFlow.kind !== "none") return;
      startWalk({ kind: "spot", point: { x, z } }, false);
    },
    forceGetUp() {
      afterUp = null;
      if (flow.kind === "heading") {
        flow = FREE;
        path = [];
        return;
      }
      applyStep(getUp(flow, BED_TRANSITION_SECONDS));
    },
    nav,
    setCameraLocked(locked) {
      controls.enabled = !locked;
    },
    setAsleep(next) {
      asleep = next;
    },
    setMoveConfirm(ask) {
      moveConfirm = ask;
    },
    setClaimConfirm(ask) {
      claimConfirm = ask;
    },
    setOwnedBed(bed) {
      ownedBed = bed;
      const using = claimedOf(flow);
      if (using === null || using === bed) return;
      // 서버가 아는 내 침대와 다른 침대에 있거나 가는 중이었어요. 일어나요.
      afterUp = null;
      if (flow.kind === "heading") {
        flow = FREE;
        path = [];
        return;
      }
      applyStep(getUp(flow, BED_TRANSITION_SECONDS));
    },
    setLobbyListener(listener) {
      lobbyListener = listener;
    },
    chooseBed,
    setBedPicker(picker) {
      bedPicker = picker;
    },
    setLongPress(handler) {
      longPress = handler;
    },
    setTapFilter(filter) {
      tapFilter = filter;
    },
    whenUp(action) {
      if (canStartGesture(flow)) {
        action();
        return;
      }
      afterUp = action;
      applyStep(getUp(flow, BED_TRANSITION_SECONDS));
    },
    faceToward(x, z) {
      yawGoal = Math.atan2(x - position.x, z - position.z);
    },
    walkToSpot(x, z, then, tellServer = false) {
      afterUp = null;
      if (isSeated(seatFlow)) {
        // 벤치에서 일어난 뒤에 걸어가요.
        afterWalk = null;
        riseThen(() => this.walkToSpot(x, z, then, tellServer));
        return;
      }
      seatFlow = NO_SEAT;
      const goal = nav.nearestFree({ x, z });
      if (!goal || Math.hypot(goal.x - position.x, goal.z - position.z) < 0.05) {
        afterWalk = null;
        then();
        return;
      }
      flow = FREE;
      startWalk({ kind: "spot", point: goal }, tellServer);
      if (path.length === 0) {
        then();
        return;
      }
      afterWalk = then;
    },
    placeAt(x, z, faceX, faceZ) {
      const dx = x - position.x;
      const dz = z - position.z;
      afterUp = null;
      afterRise = null;
      flow = FREE;
      seatFlow = NO_SEAT;
      path = [];
      glance = null;
      position = { x, z };
      shownX = x;
      shownZ = z;
      desired.x += dx;
      desired.z += dz;
      controls.target.x += dx;
      controls.target.z += dz;
      yaw = Math.atan2(faceX - x, faceZ - z);
      yawGoal = yaw;
      // 카메라는 캐릭터 뒤에서 침대 쪽을 봐요.
      orbitToward(yaw + Math.PI, 1);
      avatar.place(x, z, yaw);
      shadow.position.x = x;
      shadow.position.z = z;
    },
    handSpot() {
      return {
        x: shownX + Math.sin(yaw) * HAND_REACH * avatar.size,
        y: HAND_HEIGHT * avatar.size,
        z: shownZ + Math.cos(yaw) * HAND_REACH * avatar.size,
      };
    },
    headWorld(target) {
      return avatar.root.visible ? avatar.headWorld(target) : null;
    },
    lanternWorld(target) {
      return avatar.root.visible ? avatar.lanternWorld(target) : null;
    },
    get walkX() {
      return position.x;
    },
    get walkZ() {
      return position.z;
    },
    get lyingBed() {
      return flow.kind === "lying" ? flow.bed : null;
    },
    get claimedBed() {
      return claimedOf(flow);
    },
    get ownedBed() {
      return ownedBed;
    },
    get seat() {
      return seatInUse(seatFlow);
    },
    get seated() {
      return isSeated(seatFlow);
    },
    leaveSeat() {
      if (seatFlow.kind === "heading") {
        seatFlow = NO_SEAT;
        path = [];
      } else if (isSeated(seatFlow) && seatFlow.kind !== "rising") {
        riseThen(null);
      }
    },
    update(dt) {
      const stillMotion = reduceMotion.matches;
      applyStep(tickFlow(flow, stillMotion ? BED_TRANSITION_SECONDS : dt, BED_TRANSITION_SECONDS));
      if (afterUp && flow.kind === "free") {
        const action = afterUp;
        afterUp = null;
        action();
      }
      const seatStep = tickSeat(seatFlow, stillMotion ? BED_TRANSITION_SECONDS : dt, BED_TRANSITION_SECONDS);
      seatFlow = seatStep.flow;
      if (seatStep.stood) {
        const action = afterRise;
        afterRise = null;
        // 다른 곳으로 가지 않고 일어나기만 했으면 서버에 알려요. 이미 알렸으면 서버가 그냥 넘겨요.
        if (action) action();
        else net?.standUp();
      }
      // 쓰던 침대를 내놓았으면 서버에 알려요.
      const claimed = claimedOf(flow);
      if (lastClaimed !== null && claimed === null) net?.getUp();
      lastClaimed = claimed;

      let walked = 0;
      if (path.length > 0) {
        const step = stepAlong(position, path, WALK_SPEED * dt);
        const dx = step.position.x - position.x;
        const dz = step.position.z - position.z;
        position = step.position;
        path = step.path;
        walked = Math.hypot(dx, dz);
        if (walked > 0) {
          yawGoal = Math.atan2(dx, dz);
          walkPhase += (walked / STRIDE_LENGTH) * Math.PI * 2;
        }

        // 걷는 동안 카메라가 캐릭터 뒤로 천천히 돌아가요. 드래그 중이면 사용자의 시선을 따라요.
        const glancing =
          glance !== null &&
          glancePhase(glance.elapsed, GLANCE_LOOK_SECONDS, GLANCE_RETURN_SECONDS) === "look";
        if (walked > 0 && !dragging && !glancing && !stillMotion) {
          orbitToward(Math.atan2(-dx, -dz), 1 - Math.exp(-dt * FOLLOW_TURN_RATE));
        }

        if (enteredThroughFront(position.z - dz, position.z, LOBBY.maxZ)) {
          if (!stillMotion) glance = { elapsed: 0, returnAngle: cameraAngle() };
          lobbyListener?.();
        }

        if (path.length === 0 && flow.kind === "heading") {
          const granted = flow.lie && flow.bed === ownedBed;
          applyStep(arrivedAtBed(flow, granted));
        }
        if (path.length === 0 && seatFlow.kind === "heading") {
          yawGoal = seatYaw(seatFlow.seat);
          seatFlow = arrivedAtSeat(seatFlow);
        }
        if (path.length === 0 && afterWalk) {
          const action = afterWalk;
          afterWalk = null;
          action();
        }
      }

      if (facingCamera && path.length === 0 && flow.kind === "free") yawGoal = cameraAngle();
      if (yawGoal !== null) yaw = turnToward(yaw, yawGoal, 1 - Math.exp(-dt * BODY_TURN_RATE));

      const walkGoal = path.length > 0 && !stillMotion ? 1 : 0;
      walkWeight += (walkGoal - walkWeight) * (1 - Math.exp(-dt * WALK_BLEND_RATE));

      if (gesture) {
        gestureElapsed += dt;
        if (gestureElapsed >= gestureDuration(gesture)) gesture = null;
      }

      const sleeping = asleep && flow.kind === "lying";
      avatar.setAsleep(sleeping);
      breathPhase = advanceBreath(breathPhase, dt, stillMotion, sleeping ? SLEEP_BREATH_SECONDS : undefined);
      composePose(pose, {
        walkPhase,
        breathPhase,
        walkWeight,
        gesture,
        gestureElapsed,
        bedProgress: bedProgress(flow, BED_TRANSITION_SECONDS),
        seatProgress: seatProgress(seatFlow, BED_TRANSITION_SECONDS),
        carrying: outfit === "visitor",
        breathAmount: sleeping ? SLEEP_BREATH_AMOUNT : 1,
      });

      // 침대에 오르내리는 동안에는 곁 자리와 침대 위 자리 사이를 옮겨 가요.
      let nextX = position.x;
      let nextZ = position.z;
      let shownYaw = yaw;
      if (flow.kind === "entering" || flow.kind === "lying" || flow.kind === "leaving") {
        const bed = BEDS[flow.bed];
        const rest = bedRest(bed);
        nextX += (rest.x - nextX) * pose.bedTravel;
        nextZ += (rest.z - nextZ) * pose.bedTravel;
        shownYaw = turnToward(yaw, bedRestYaw(bed), pose.bedTurn);
      }
      // 벤치에 앉는 동안에는 앞자리와 앉는 자리 사이를 옮겨 가요.
      if (isSeated(seatFlow) && seatFlow.kind !== "none") {
        const rest = seatRest(seatFlow.seat);
        nextX += (rest.x - nextX) * pose.seatTravel;
        nextZ += (rest.z - nextZ) * pose.seatTravel;
        shownYaw = turnToward(shownYaw, seatYaw(seatFlow.seat), pose.seatTurn);
      }
      const movedX = nextX - shownX;
      const movedZ = nextZ - shownZ;
      shownX = nextX;
      shownZ = nextZ;
      avatar.place(shownX, shownZ, shownYaw);
      avatar.apply(pose);
      shadow.position.x = shownX;
      shadow.position.z = shownZ;
      shadow.position.y =
        FLOOR_SHADOW_Y + (BED_SHADOW_Y - FLOOR_SHADOW_Y) * pose.bedLift + YARD_BENCH.seatY * pose.seatLift;
      desired.x += movedX;
      desired.z += movedZ;
      controls.target.x += movedX;
      controls.target.z += movedZ;

      // 눕는 동안 머리 뒤에 붙지 않게, 카메라가 발치 쪽에서 얼굴을 보도록 돌아가요.
      if (flow.kind === "entering" && !dragging && !stillMotion) {
        // 로비에서 시작한 간호사실 보기가 남아 있으면 카메라를 도로 돌려놓으니 끝내요.
        glance = null;
        orbitToward(bedRestYaw(BEDS[flow.bed]), 1 - Math.exp(-dt * BED_CAMERA_TURN_RATE));
      }

      // 드래그하면 사용자의 시선을 바로 따라요.
      if (glance && dragging) glance = null;
      if (glance) {
        const phase = glancePhase(glance.elapsed, GLANCE_LOOK_SECONDS, GLANCE_RETURN_SECONDS);
        const amount = 1 - Math.exp(-dt * GLANCE_TURN_RATE);
        if (phase === "look") {
          orbitToward(cameraAngleToSee(position, NURSE_STATION_SPOT), amount);
        } else if (phase === "return" && path.length === 0) {
          orbitToward(glance.returnAngle, amount);
        }
        glance = phase === "done" ? null : { ...glance, elapsed: glance.elapsed + dt };
      }

      if (marker.visible) {
        markerAge += dt;
        const t = markerAge / MARKER_SECONDS;
        markerMaterial.opacity = Math.max(0, 0.9 * (1 - t));
        marker.scale.setScalar(1 + t * 0.5);
        if (t >= 1) marker.visible = false;
      }

      controls.update(dt);

      const pulled = pullCamera(controls.target, desired, WALL_BOXES, CAMERA_WALL_CLEARANCE);
      camera.position.set(pulled.x, pulled.y, pulled.z);
      viewDistance = easeDistance(
        viewDistance,
        camera.position.distanceTo(controls.target),
        dt,
        CAMERA_RELEASE_RATE,
      );
      camera.position.sub(controls.target).setLength(viewDistance).add(controls.target);
      camera.quaternion.copy(rig.quaternion);
      avatar.root.visible = viewDistance > HIDE_PLAYER_DISTANCE;
    },
  };
}
