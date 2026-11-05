import {
  CapsuleGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
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
import {
  cameraAngleToSee,
  easeDistance,
  enteredThroughFront,
  firstBlocked,
  glancePhase,
  pullCamera,
  turnToward,
} from "./camera-view";
import {
  FLOOR_AREAS,
  LOBBY,
  NURSE_STATION,
  NURSE_STATION_CENTER_X,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_START,
  WALK_AREAS,
  WALL_BOXES,
} from "./layout";
import { createNavGrid, stepAlong } from "./movement";
import type { Point } from "./movement";

const WALK_SPEED = 1.8;
const TARGET_HEIGHT = 1.1;
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
const MARKER_SECONDS = 0.9;
/** 누른 방향으로 살펴보는 거리예요. 앞마당 끝에서 건물 안쪽까지 닿아요. */
const TAP_REACH = 80;

export interface PlayerControls {
  update(dt: number): void;
  /** 캐릭터의 현재 위치예요. */
  readonly x: number;
  readonly z: number;
}

/** 임시 캐릭터와 3인칭 카메라예요. 드래그는 둘러보기, 짧은 탭은 이동이에요. */
export function createPlayerControls(
  scene: Scene,
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  softCircle: Texture,
): PlayerControls {
  const nav = createNavGrid({
    areas: WALK_AREAS,
    obstacles: OBSTACLES,
    radius: PLAYER_RADIUS,
    cellSize: 0.2,
  });

  const player = new Mesh(
    new CapsuleGeometry(PLAYER_RADIUS - 0.02, 0.42, 4, 14),
    new MeshLambertMaterial({ color: "#7fb3a6", emissive: "#20403a" }),
  );
  player.position.set(PLAYER_START.x, 0.41, PLAYER_START.z);
  scene.add(player);

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

  let position: Point = { x: PLAYER_START.x, z: PLAYER_START.z };
  let path: Point[] = [];
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

  const moveTo = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const tapped = tappedSpot(raycaster.ray.origin, raycaster.ray.direction);
    if (!tapped) return;

    const goal = nav.nearestFree(tapped);
    if (!goal) return;
    const nextPath = nav.findPath(position, goal);
    if (nextPath.length === 0) return;

    path = nextPath;
    marker.position.x = goal.x;
    marker.position.z = goal.z;
    marker.visible = true;
    markerAge = 0;
  };

  // 여러 손가락이 닿았던 제스처는 탭으로 보지 않아요.
  const activePointers = new Set<number>();
  let dragging = false;
  let tapStart: { x: number; y: number; time: number; id: number } | null = null;

  canvas.addEventListener("pointerdown", (event) => {
    activePointers.add(event.pointerId);
    dragging = true;
    if (activePointers.size === 2) startZoomFromView();
    tapStart =
      activePointers.size === 1 && event.button === 0
        ? { x: event.clientX, y: event.clientY, time: event.timeStamp, id: event.pointerId }
        : null;
  });
  canvas.addEventListener("pointerup", (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) dragging = false;
    const start = tapStart;
    if (!start || start.id !== event.pointerId) return;
    tapStart = null;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved <= TAP_MAX_MOVE_PX && event.timeStamp - start.time <= TAP_MAX_MS) {
      moveTo(event.clientX, event.clientY);
    }
  });
  canvas.addEventListener("pointercancel", (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) dragging = false;
    tapStart = null;
  });

  return {
    get x() {
      return position.x;
    },
    get z() {
      return position.z;
    },
    update(dt) {
      if (path.length > 0) {
        const step = stepAlong(position, path, WALK_SPEED * dt);
        const dx = step.position.x - position.x;
        const dz = step.position.z - position.z;
        position = step.position;
        path = step.path;
        player.position.x = position.x;
        player.position.z = position.z;
        shadow.position.x = position.x;
        shadow.position.z = position.z;
        desired.x += dx;
        desired.z += dz;
        controls.target.x += dx;
        controls.target.z += dz;

        // 걷는 동안 카메라가 캐릭터 뒤로 천천히 돌아가요. 드래그 중이면 사용자의 시선을 따라요.
        const walked = Math.hypot(dx, dz);
        const glancing =
          glance !== null &&
          glancePhase(glance.elapsed, GLANCE_LOOK_SECONDS, GLANCE_RETURN_SECONDS) === "look";
        if (walked > 0 && !dragging && !glancing && !reduceMotion.matches) {
          orbitToward(Math.atan2(-dx, -dz), 1 - Math.exp(-dt * FOLLOW_TURN_RATE));
        }

        if (
          !reduceMotion.matches &&
          enteredThroughFront(position.z - dz, position.z, LOBBY.maxZ)
        ) {
          glance = { elapsed: 0, returnAngle: cameraAngle() };
        }
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
      player.visible = viewDistance > HIDE_PLAYER_DISTANCE;
    },
  };
}
