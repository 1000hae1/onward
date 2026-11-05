import {
  CanvasTexture,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
} from "three";
import type { Object3D } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ELEVATOR_DOOR_Z, ELEVATOR_HALL, NURSE_STATION } from "./layout";
import { addInstances, transform } from "./parts";

const lambert = (color: string): MeshLambertMaterial => new MeshLambertMaterial({ color });

const COUNTER_HEIGHT = 1.08;
const COUNTER_FRONT_Z = NURSE_STATION.minZ + 0.32;
const ELEVATOR_DOOR_WIDTH = 1.05;
const ELEVATOR_DOOR_HEIGHT = 2.15;

function createSignTexture(text: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#3f6f6b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fbfaf4";
    context.font = '600 44px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 표지판이에요. 소등 뒤에도 읽히도록 조명의 영향을 받지 않아요. */
function addSign(
  parent: Object3D,
  text: string,
  x: number,
  y: number,
  z: number,
  rotationY: number,
): void {
  const sign = new Mesh(
    new PlaneGeometry(1.5, 0.375),
    new MeshBasicMaterial({ map: createSignTexture(text) }),
  );
  sign.position.set(x, y, z);
  sign.rotation.y = rotationY;
  parent.add(sign);
}

/** 복도 가운데 안쪽의 간호사실이에요. 카운터 너머로 책상과 수납장이 보여요. */
function buildNurseStation(parent: Object3D): void {
  const centerX = (NURSE_STATION.minX + NURSE_STATION.maxX) / 2;
  const width = NURSE_STATION.maxX - NURSE_STATION.minX;
  const innerZ = COUNTER_FRONT_Z + 1.25;

  // 복도를 향한 긴 카운터와 양옆으로 꺾이는 짧은 카운터예요.
  const counter = lambert("#f4efe5");
  addInstances(parent, new RoundedBoxGeometry(width - 0.5, COUNTER_HEIGHT, 0.5, 2, 0.05), counter, [
    transform(centerX, COUNTER_HEIGHT / 2, COUNTER_FRONT_Z + 0.25),
  ]);
  addInstances(parent, new RoundedBoxGeometry(0.5, COUNTER_HEIGHT, 1.3, 2, 0.05), counter, [
    transform(NURSE_STATION.minX + 0.5, COUNTER_HEIGHT / 2, COUNTER_FRONT_Z + 1),
    transform(NURSE_STATION.maxX - 0.5, COUNTER_HEIGHT / 2, COUNTER_FRONT_Z + 1),
  ]);
  addInstances(parent, new RoundedBoxGeometry(width - 0.35, 0.06, 0.62, 2, 0.025), lambert("#7fa8a3"), [
    transform(centerX, COUNTER_HEIGHT + 0.03, COUNTER_FRONT_Z + 0.25),
  ]);

  // 카운터 안쪽의 모니터 두 대와 의자예요.
  const monitorSpots = [-1.3, 1.3];
  addInstances(
    parent,
    new RoundedBoxGeometry(0.5, 0.32, 0.04, 2, 0.015),
    lambert("#3a4148"),
    monitorSpots.map((x) => transform(centerX + x, COUNTER_HEIGHT + 0.28, COUNTER_FRONT_Z + 0.32)),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.03, 0.05, 0.14, 8),
    lambert("#8d959b"),
    monitorSpots.map((x) => transform(centerX + x, COUNTER_HEIGHT + 0.1, COUNTER_FRONT_Z + 0.32)),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.22, 0.2, 0.09, 12),
    lambert("#7fa8a3"),
    monitorSpots.map((x) => transform(centerX + x, 0.5, innerZ)),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.03, 0.03, 0.46, 8),
    lambert("#8d959b"),
    monitorSpots.map((x) => transform(centerX + x, 0.23, innerZ)),
  );

  // 뒤쪽 벽을 따라 놓인 수납장이에요.
  // 처음 화면에서 카메라와 복도 사이에 놓이므로, 시야를 가리지 않게 낮게 만들어요.
  const cabinetSpots = [-2.2, -0.75, 0.75, 2.2];
  const cabinetHeight = 1;
  addInstances(
    parent,
    new RoundedBoxGeometry(1.35, cabinetHeight, 0.42, 2, 0.03),
    lambert("#ece8de"),
    cabinetSpots.map((x) => transform(centerX + x, cabinetHeight / 2, NURSE_STATION.maxZ - 0.24)),
  );
  addInstances(
    parent,
    new RoundedBoxGeometry(0.03, 0.22, 0.03, 1, 0.01),
    lambert("#8d959b"),
    cabinetSpots.map((x) => transform(centerX + x, cabinetHeight * 0.6, NURSE_STATION.maxZ - 0.46)),
  );

  // 카운터 끝의 작은 화분이에요.
  const plantX = centerX + 2.6;
  addInstances(parent, new CylinderGeometry(0.1, 0.07, 0.14, 10), lambert("#d9d5ca"), [
    transform(plantX, COUNTER_HEIGHT + 0.13, COUNTER_FRONT_Z + 0.2),
  ]);
  addInstances(parent, new SphereGeometry(0.15, 10, 8), lambert("#5f9272"), [
    transform(plantX, COUNTER_HEIGHT + 0.3, COUNTER_FRONT_Z + 0.2),
  ]);

  // 카운터 앞면과 뒷면에 표지판을 붙여요. 위에 달면 복도와 캐릭터를 가려요.
  addSign(parent, "간호사실", centerX, COUNTER_HEIGHT * 0.58, COUNTER_FRONT_Z - 0.01, Math.PI);
  addSign(parent, "간호사실", centerX, COUNTER_HEIGHT * 0.58, COUNTER_FRONT_Z + 0.51, 0);
}

/** 복도 오른쪽 끝의 엘리베이터 홀이에요. 오른쪽 벽에 엘리베이터 두 대가 있어요. */
function buildElevatorHall(parent: Object3D): void {
  const wallX = ELEVATOR_HALL.maxX;
  const doorY = ELEVATOR_DOOR_HEIGHT / 2;

  addInstances(
    parent,
    new RoundedBoxGeometry(0.08, ELEVATOR_DOOR_HEIGHT + 0.16, ELEVATOR_DOOR_WIDTH + 0.2, 2, 0.02),
    lambert("#8d959b"),
    ELEVATOR_DOOR_Z.map((z) => transform(wallX - 0.04, doorY + 0.08, z)),
  );
  // 문짝은 양쪽으로 갈라지는 두 장이에요.
  const leafWidth = ELEVATOR_DOOR_WIDTH / 2 - 0.008;
  addInstances(
    parent,
    new RoundedBoxGeometry(0.04, ELEVATOR_DOOR_HEIGHT, leafWidth, 1, 0.01),
    lambert("#c9cfd3"),
    ELEVATOR_DOOR_Z.flatMap((z) => [
      transform(wallX - 0.1, doorY, z - leafWidth / 2 - 0.008),
      transform(wallX - 0.1, doorY, z + leafWidth / 2 + 0.008),
    ]),
  );
  // 층 표시등
  addInstances(
    parent,
    new RoundedBoxGeometry(0.03, 0.14, 0.42, 1, 0.01),
    new MeshBasicMaterial({ color: "#ffb35c" }),
    ELEVATOR_DOOR_Z.map((z) => transform(wallX - 0.05, ELEVATOR_DOOR_HEIGHT + 0.3, z)),
  );
  // 호출 버튼 패널
  addInstances(parent, new RoundedBoxGeometry(0.03, 0.26, 0.12, 1, 0.01), lambert("#6f777d"), [
    transform(wallX - 0.03, 1.15, (ELEVATOR_DOOR_Z[0] + ELEVATOR_DOOR_Z[1]) / 2),
  ]);

  // 뒤쪽의 긴 의자와 화분이에요.
  const benchZ = ELEVATOR_HALL.maxZ - 0.32;
  const benchX = ELEVATOR_HALL.minX + 1.2;
  addInstances(parent, new RoundedBoxGeometry(1.6, 0.1, 0.46, 2, 0.04), lambert("#7fa8a3"), [
    transform(benchX, 0.44, benchZ),
  ]);
  addInstances(parent, new CylinderGeometry(0.03, 0.03, 0.42, 8), lambert("#8d959b"), [
    transform(benchX - 0.65, 0.21, benchZ),
    transform(benchX + 0.65, 0.21, benchZ),
  ]);
  addInstances(parent, new CylinderGeometry(0.2, 0.15, 0.36, 12), lambert("#d9d5ca"), [
    transform(ELEVATOR_HALL.minX + 0.3, 0.18, ELEVATOR_HALL.minZ + 0.35),
  ]);
  addInstances(parent, new SphereGeometry(0.34, 10, 8), lambert("#5f9272"), [
    transform(ELEVATOR_HALL.minX + 0.3, 0.72, ELEVATOR_HALL.minZ + 0.35),
  ]);

  // 엘리베이터 맞은편 벽에 표지판을 달아요.
  addSign(
    parent,
    "엘리베이터",
    ELEVATOR_HALL.minX + 0.01,
    2,
    (ELEVATOR_DOOR_Z[0] + ELEVATOR_DOOR_Z[1]) / 2,
    Math.PI / 2,
  );
}

/** 복도를 병원답게 채우는 시설들이에요. */
export function buildFacilities(parent: Object3D): void {
  buildNurseStation(parent);
  buildElevatorHall(parent);
}
