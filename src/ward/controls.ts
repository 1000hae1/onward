import {
  CapsuleGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Plane,
  Raycaster,
  RingGeometry,
  TOUCH,
  Vector2,
  Vector3,
} from "three";
import type { PerspectiveCamera, Scene, Texture } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CAMERA_MAX_DISTANCE,
  FLOOR_AREAS,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_START,
  WALK_AREAS,
} from "./layout";
import { createNavGrid, stepAlong } from "./movement";
import type { Point } from "./movement";

const WALK_SPEED = 1.8;
const TARGET_HEIGHT = 0.8;
const TAP_MAX_MOVE_PX = 8;
const TAP_MAX_MS = 450;
const MARKER_SECONDS = 0.9;

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

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(PLAYER_START.x, TARGET_HEIGHT, PLAYER_START.z);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.minDistance = 2.5;
  controls.maxDistance = CAMERA_MAX_DISTANCE;
  controls.minPolarAngle = 0.45;
  controls.maxPolarAngle = 1.4;
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };

  let position: Point = { x: PLAYER_START.x, z: PLAYER_START.z };
  let path: Point[] = [];

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();

  const moveTo = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return;

    const tapped = { x: hit.x, z: hit.z };
    const onFloor = FLOOR_AREAS.some(
      (area) =>
        tapped.x >= area.minX &&
        tapped.x <= area.maxX &&
        tapped.z >= area.minZ &&
        tapped.z <= area.maxZ,
    );
    if (!onFloor) return;

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
  let tapStart: { x: number; y: number; time: number; id: number } | null = null;

  canvas.addEventListener("pointerdown", (event) => {
    activePointers.add(event.pointerId);
    tapStart =
      activePointers.size === 1 && event.button === 0
        ? { x: event.clientX, y: event.clientY, time: event.timeStamp, id: event.pointerId }
        : null;
  });
  canvas.addEventListener("pointerup", (event) => {
    activePointers.delete(event.pointerId);
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
        // 둘러보던 각도를 유지한 채 캐릭터를 따라가요.
        camera.position.x += dx;
        camera.position.z += dz;
        controls.target.x += dx;
        controls.target.z += dz;
      }
      if (marker.visible) {
        markerAge += dt;
        const t = markerAge / MARKER_SECONDS;
        markerMaterial.opacity = Math.max(0, 0.9 * (1 - t));
        marker.scale.setScalar(1 + t * 0.5);
        if (t >= 1) marker.visible = false;
      }
      controls.update(dt);
    },
  };
}
