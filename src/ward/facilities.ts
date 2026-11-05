import {
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
} from "three";
import type { BufferGeometry, Matrix4, Object3D } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  ENTRANCE,
  ENTRANCE_PLANTERS,
  HEADER_Y,
  LOBBY,
  LOBBY_BENCH,
  LOBBY_BENCHES,
  LOBBY_TREE,
  NURSE_STATION,
  NURSE_STATION_CENTER_X,
  NURSES,
  WALL_HEIGHT,
} from "./layout";
import { addInstances, createRandom, repeatAt, transform } from "./parts";

const lambert = (color: string): MeshLambertMaterial => new MeshLambertMaterial({ color });

const COUNTER_HEIGHT = 1;
const COUNTER_DEPTH = 0.5;

function createSignTexture(text: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#3f6f6b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fbfaf4";
    context.font = '600 52px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 표지판이에요. 소등 뒤에도 읽히도록 조명의 영향을 받지 않아요. */
function addSign(parent: Object3D, text: string, x: number, y: number, z: number, width: number): void {
  const sign = new Mesh(
    new PlaneGeometry(width, width / 5),
    new MeshBasicMaterial({ map: createSignTexture(text) }),
  );
  sign.position.set(x, y, z);
  parent.add(sign);
}

/** 로비 오른쪽의 간호사실이에요. 낮은 카운터 너머로 병아리 간호사들이 보여요. */
function buildNurseStation(parent: Object3D): void {
  const station = NURSE_STATION;
  const centerX = NURSE_STATION_CENTER_X;
  const width = station.maxX - station.minX;
  const depth = station.maxZ - station.minZ;
  const centerZ = (station.minZ + station.maxZ) / 2;
  const frontZ = station.maxZ - COUNTER_DEPTH / 2;
  const counter = lambert("#f4efe5");
  const accent = lambert("#7fa8a3");

  // 현관을 향한 긴 카운터와 양옆으로 꺾이는 짧은 카운터예요.
  addInstances(parent, new RoundedBoxGeometry(width, COUNTER_HEIGHT, COUNTER_DEPTH, 2, 0.05), counter, [
    transform(centerX, COUNTER_HEIGHT / 2, frontZ),
  ]);
  addInstances(parent, new RoundedBoxGeometry(COUNTER_DEPTH, COUNTER_HEIGHT, depth, 2, 0.05), counter, [
    transform(station.minX + COUNTER_DEPTH / 2, COUNTER_HEIGHT / 2, centerZ),
    transform(station.maxX - COUNTER_DEPTH / 2, COUNTER_HEIGHT / 2, centerZ),
  ]);
  addInstances(parent, new RoundedBoxGeometry(width + 0.1, 0.06, COUNTER_DEPTH + 0.12, 2, 0.025), accent, [
    transform(centerX, COUNTER_HEIGHT + 0.03, frontZ),
  ]);
  // 카운터 앞면의 청록색 띠예요.
  addInstances(parent, new RoundedBoxGeometry(width + 0.02, 0.14, 0.03, 1, 0.01), accent, [
    transform(centerX, 0.28, station.maxZ + 0.005),
  ]);

  // 카운터 위 모니터는 안쪽을 봐요.
  const monitorSpots = [-1.05, 1.05];
  addInstances(
    parent,
    new RoundedBoxGeometry(0.5, 0.32, 0.04, 2, 0.015),
    lambert("#3a4148"),
    monitorSpots.map((x) => transform(centerX + x, COUNTER_HEIGHT + 0.3, frontZ - 0.05)),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.03, 0.05, 0.14, 8),
    lambert("#8d959b"),
    monitorSpots.map((x) => transform(centerX + x, COUNTER_HEIGHT + 0.11, frontZ - 0.05)),
  );

  // 뒤쪽의 낮은 수납장이에요.
  const cabinetSpots = [-2.2, -0.75, 0.75, 2.2];
  addInstances(
    parent,
    new RoundedBoxGeometry(1.35, 0.9, 0.34, 2, 0.03),
    lambert("#ece8de"),
    cabinetSpots.map((x) => transform(centerX + x, 0.45, station.minZ + 0.18)),
  );

  // 카운터 끝의 작은 화분이에요.
  const plantX = station.maxX - 0.4;
  addInstances(parent, new CylinderGeometry(0.1, 0.07, 0.14, 10), lambert("#d9d5ca"), [
    transform(plantX, COUNTER_HEIGHT + 0.13, frontZ),
  ]);
  addInstances(parent, new SphereGeometry(0.15, 10, 8), lambert("#5f9272"), [
    transform(plantX, COUNTER_HEIGHT + 0.3, frontZ),
  ]);

  // 천장에서 내려온 간판이에요.
  const signY = 2.75;
  const signZ = station.maxZ - 0.3;
  addSign(parent, "간호사실", centerX, signY, signZ, 3);
  addInstances(parent, new CylinderGeometry(0.012, 0.012, WALL_HEIGHT - signY, 6), lambert("#c9cdd0"), [
    transform(centerX - 1.2, (signY + WALL_HEIGHT) / 2, signZ),
    transform(centerX + 1.2, (signY + WALL_HEIGHT) / 2, signZ),
  ]);
}

/** 간호사 모자를 쓴 병아리들이에요. 카운터 너머로 머리와 어깨가 보여요. */
function buildChickNurses(parent: Object3D): void {
  const bases = NURSES.map((nurse) => transform(nurse.x, 0, nurse.z, nurse.rotationY));
  const yellow = lambert("#ffd65c");
  const add = (geometry: BufferGeometry, material: MeshLambertMaterial, locals: Matrix4[]): void => {
    addInstances(parent, geometry, material, repeatAt(bases, locals));
  };

  const sphere = new SphereGeometry(1, 16, 12);
  // 몸통과 머리
  add(sphere, yellow, [
    transform(0, 0.78, 0, 0, 0.36, 0.42, 0.34),
    transform(0, 1.34, 0.02, 0, 0.3),
  ]);
  // 양쪽 날개
  add(sphere, lambert("#f7c84a"), [
    transform(-0.34, 0.86, 0, 0, 0.09, 0.24, 0.18),
    transform(0.34, 0.86, 0, 0, 0.09, 0.24, 0.18),
  ]);
  // 간호복 앞치마
  add(new RoundedBoxGeometry(0.42, 0.3, 0.06, 2, 0.025), lambert("#fbfdfd"), [
    transform(0, 0.72, 0.31),
  ]);
  // 눈
  add(new SphereGeometry(0.038, 8, 6), lambert("#2c2a28"), [
    transform(-0.11, 1.4, 0.28),
    transform(0.11, 1.4, 0.28),
  ]);
  // 볼
  add(new SphereGeometry(0.05, 8, 6), lambert("#ffb09a"), [
    transform(-0.2, 1.3, 0.22, 0, 1, 0.6, 0.5),
    transform(0.2, 1.3, 0.22, 0, 1, 0.6, 0.5),
  ]);
  // 부리
  add(new ConeGeometry(0.055, 0.1, 7), lambert("#f08a2c"), [
    transform(0, 1.31, 0.33, 0, 1, 0.8, 1),
  ]);
  // 흰색 간호사 모자
  add(new CylinderGeometry(0.16, 0.19, 0.13, 12), lambert("#fbfdfd"), [transform(0, 1.66, 0)]);
}

/** 현관을 들어서면 보이는 로비예요. 성탄 나무와 긴 의자, 화분이 있어요. */
function buildLobby(parent: Object3D): void {
  // 성탄 나무
  const tree = LOBBY_TREE;
  addInstances(parent, new CylinderGeometry(0.32, 0.26, 0.3, 12), lambert("#9b7a58"), [
    transform(tree.x, 0.15, tree.z),
  ]);
  addInstances(parent, new ConeGeometry(1, 1, 9), lambert("#3f6f56"), [
    transform(tree.x, 0.85, tree.z, 0, 0.82, 1.1, 0.82),
    transform(tree.x, 1.45, tree.z, 0.4, 0.62, 0.95, 0.62),
    transform(tree.x, 1.95, tree.z, 0.8, 0.42, 0.8, 0.42),
  ]);
  addInstances(parent, new IcosahedronGeometry(0.075, 0), new MeshBasicMaterial({ color: "#ffd98a" }), [
    transform(tree.x, 2.42, tree.z),
  ]);
  const random = createRandom(31);
  const ornaments = Array.from({ length: 16 }, (_, index) => {
    const angle = index * 2.4;
    const height = 0.55 + (index / 16) * 1.5;
    const radius = 0.72 * (1 - (height - 0.45) / 1.75);
    return transform(
      tree.x + Math.cos(angle) * radius,
      height,
      tree.z + Math.sin(angle) * radius,
      0,
      0.8 + random() * 0.4,
    );
  });
  addInstances(parent, new SphereGeometry(0.05, 8, 6), lambert("#d65a4e"), ornaments.filter((_, i) => i % 2 === 0));
  addInstances(parent, new SphereGeometry(0.05, 8, 6), lambert("#efc15a"), ornaments.filter((_, i) => i % 2 === 1));

  // 대기 의자
  addInstances(
    parent,
    new RoundedBoxGeometry(LOBBY_BENCH.length, 0.1, LOBBY_BENCH.depth, 2, 0.04),
    lambert("#7fa8a3"),
    LOBBY_BENCHES.map((bench) => transform(bench.x, 0.44, bench.z)),
  );
  addInstances(
    parent,
    new RoundedBoxGeometry(LOBBY_BENCH.length, 0.45, 0.08, 2, 0.03),
    lambert("#7fa8a3"),
    LOBBY_BENCHES.map((bench) => transform(bench.x, 0.7, bench.z + LOBBY_BENCH.depth / 2 - 0.04)),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.03, 0.03, 0.42, 8),
    lambert("#8d959b"),
    LOBBY_BENCHES.flatMap((bench) => [
      transform(bench.x - 1, 0.21, bench.z),
      transform(bench.x + 1, 0.21, bench.z),
    ]),
  );

  // 현관 양옆 화분
  addInstances(
    parent,
    new CylinderGeometry(0.28, 0.2, 0.46, 12),
    lambert("#d9d5ca"),
    ENTRANCE_PLANTERS.map((planter) => transform(planter.x, 0.23, planter.z)),
  );
  addInstances(
    parent,
    new SphereGeometry(0.42, 10, 8),
    lambert("#5f9272"),
    ENTRANCE_PLANTERS.map((planter) => transform(planter.x, 0.85, planter.z)),
  );

  // 현관 틀과 발판
  const entranceZ = (ENTRANCE.minZ + ENTRANCE.maxZ) / 2;
  const depth = ENTRANCE.maxZ - ENTRANCE.minZ + 0.1;
  const trim = lambert("#dfdcd5");
  addInstances(parent, new RoundedBoxGeometry(0.14, ENTRANCE.height, depth, 2, 0.04), trim, [
    transform(ENTRANCE.minX - 0.05, ENTRANCE.height / 2, entranceZ),
    transform(ENTRANCE.maxX + 0.05, ENTRANCE.height / 2, entranceZ),
  ]);
  addInstances(parent, new RoundedBoxGeometry(ENTRANCE.maxX - ENTRANCE.minX + 0.24, 0.14, depth, 2, 0.04), trim, [
    transform(0, ENTRANCE.height + 0.04, entranceZ),
  ]);
  const mat = new PlaneGeometry(ENTRANCE.maxX - ENTRANCE.minX, 2);
  mat.rotateX(-Math.PI / 2);
  addInstances(parent, mat, lambert("#6f8580"), [transform(0, 0.008, LOBBY.maxZ - 0.9)]);

  // 복도 입구 위 안내판
  addSign(parent, "병실 101–106호", 0, (HEADER_Y + WALL_HEIGHT) / 2, LOBBY.minZ + 0.01, 2.2);
}

/** 간호사실과 로비예요. */
export function buildFacilities(parent: Object3D): void {
  buildNurseStation(parent);
  buildChickNurses(parent);
  buildLobby(parent);
}
