import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import type { Object3D, Texture } from "three";
import { isInsideWard, NIGHTSTAND_HEIGHT, NIGHTSTANDS, TABLE_HEIGHT, TABLES } from "../../shared/ward-layout";
import { addInstances, repeatAt, transform } from "./parts";

/** 눈은 캐릭터 둘레에만 내려요. 병원 전체에 뿌리면 입자가 너무 많이 필요해서요. */
const SNOW_HALF_WIDTH = 15;
const SNOW_MIN_Y = -0.1;
const SNOW_MAX_Y = 9;
const SNOW_HIDDEN_Y = -50;
const SNOW_SPEED_MIN = 0.22;
const SNOW_SPEED_MAX = 0.48;
const SNOW_SWAY_METERS = 0.18;

const STEAM_RISE_METERS = 0.55;
const STEAM_SECONDS = 3.4;

export interface WinterOptions {
  snowCount: number;
  /** 병실 하나의 호빵에서 피어오르는 김 입자 수예요. */
  steamPerRoom: number;
}

export interface WinterHandles {
  snowMaterial: PointsMaterial;
  steamMaterials: SpriteMaterial[];
  /** dt가 0이면 움직임 없이 그 자리에 머물러요. centerX, centerZ는 눈이 내리는 구역의 중심이에요. */
  update(dt: number, centerX: number, centerZ: number): void;
  /** 눈·김·겨울 간식을 한꺼번에 보이거나 숨겨요. */
  setVisible(visible: boolean): void;
}

const lambert = (color: string, flatShading = false): MeshLambertMaterial =>
  new MeshLambertMaterial({ color, flatShading });

/** 협탁 위의 귤 바구니와 홍시 한 접시예요. */
function buildNightstandTreats(parent: Object3D): void {
  const bases = NIGHTSTANDS.map((stand) => transform(stand.x, NIGHTSTAND_HEIGHT, stand.z));

  const basketX = -0.12;
  const basketZ = -0.12;
  addInstances(
    parent,
    new CylinderGeometry(0.125, 0.09, 0.09, 10),
    lambert("#b98a56", true),
    repeatAt(bases, [transform(basketX, 0.045, basketZ)]),
  );
  // 귤은 위아래가 살짝 납작해요. 아래 셋은 바깥쪽으로, 맨 위 하나는 앞쪽으로 잎이 나요.
  const tangerines = [
    { x: -0.058, y: 0.105, z: -0.03, leafX: -0.8, leafZ: -0.6 },
    { x: 0.058, y: 0.105, z: -0.04, leafX: 0.8, leafZ: -0.6 },
    { x: 0.005, y: 0.105, z: 0.062, leafX: 0.2, leafZ: 1 },
    { x: 0.002, y: 0.158, z: 0, leafX: 0.7, leafZ: 0.7 },
  ];
  const tangerineHalfHeight = 0.05;
  addInstances(
    parent,
    new IcosahedronGeometry(0.058, 2),
    lambert("#f08a1d", true),
    repeatAt(
      bases,
      tangerines.map((t) => transform(basketX + t.x, t.y, basketZ + t.z, 0, 1, 0.86, 1)),
    ),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.011, 0.015, 0.012, 6),
    lambert("#4a5a2a", true),
    repeatAt(
      bases,
      tangerines.map((t) => transform(basketX + t.x, t.y + tangerineHalfHeight, basketZ + t.z)),
    ),
  );
  addInstances(
    parent,
    new SphereGeometry(1, 8, 5),
    lambert("#3f8f45", true),
    repeatAt(
      bases,
      tangerines.map((t) => {
        const length = Math.hypot(t.leafX, t.leafZ);
        const dirX = t.leafX / length;
        const dirZ = t.leafZ / length;
        return transform(
          basketX + t.x + dirX * 0.042,
          t.y + tangerineHalfHeight + 0.002,
          basketZ + t.z + dirZ * 0.042,
          Math.atan2(-dirZ, dirX),
          0.045,
          0.008,
          0.021,
        );
      }),
    ),
  );

  const plateX = 0.12;
  const plateZ = 0.13;
  addInstances(
    parent,
    new CylinderGeometry(0.125, 0.09, 0.02, 14),
    lambert("#f6efe3"),
    repeatAt(bases, [transform(plateX, 0.012, plateZ)]),
  );
  const persimmons = [
    transform(plateX - 0.05, 0.062, plateZ, 0, 1, 0.82, 1),
    transform(plateX + 0.055, 0.062, plateZ + 0.02, 0, 1, 0.82, 1),
  ];
  addInstances(
    parent,
    new SphereGeometry(0.058, 10, 8),
    lambert("#e4602a"),
    repeatAt(bases, persimmons),
  );
  addInstances(
    parent,
    new CylinderGeometry(0.024, 0.03, 0.012, 6),
    lambert("#5a6b3a", true),
    repeatAt(bases, [
      transform(plateX - 0.05, 0.108, plateZ),
      transform(plateX + 0.055, 0.108, plateZ + 0.02),
    ]),
  );
}

/** 병실 가운데 탁자 위의 호빵 쟁반이에요. */
function buildHoppang(parent: Object3D): void {
  const tableTop = TABLE_HEIGHT;
  const bases = TABLES.map((table) => transform(table.x, 0, table.z));
  addInstances(
    parent,
    new CylinderGeometry(0.3, 0.25, 0.03, 18),
    lambert("#e8d9c0"),
    repeatAt(bases, [transform(0, tableTop + 0.015, 0)]),
  );
  const ring = 0.14;
  addInstances(
    parent,
    new SphereGeometry(0.1, 12, 9),
    lambert("#fff4e0"),
    repeatAt(bases, [
      transform(ring, tableTop + 0.08, 0, 0, 1, 0.78, 1),
      transform(-ring, tableTop + 0.08, 0, 0, 1, 0.78, 1),
      transform(0, tableTop + 0.08, ring, 0, 1, 0.78, 1),
      transform(0, tableTop + 0.08, -ring, 0, 1, 0.78, 1),
      transform(0, tableTop + 0.2, 0, 0, 1, 0.78, 1),
    ]),
  );
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function buildSnow(parent: Object3D, softCircle: Texture, count: number) {
  const positions = new Float32Array(count * 3);
  const baseX = new Float32Array(count);
  const baseZ = new Float32Array(count);
  const fallY = new Float32Array(count);
  const speed = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    baseX[i] = randomBetween(-SNOW_HALF_WIDTH, SNOW_HALF_WIDTH);
    baseZ[i] = randomBetween(-SNOW_HALF_WIDTH, SNOW_HALF_WIDTH);
    fallY[i] = randomBetween(SNOW_MIN_Y, SNOW_MAX_Y);
    speed[i] = randomBetween(SNOW_SPEED_MIN, SNOW_SPEED_MAX);
    phase[i] = Math.random() * Math.PI * 2;
  }
  const attribute = new BufferAttribute(positions, 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", attribute);

  const material = new PointsMaterial({
    map: softCircle,
    color: "#ffffff",
    size: 0.12,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  parent.add(points);

  let elapsed = 0;
  const fullWidth = SNOW_HALF_WIDTH * 2;
  const wrapAround = (value: number, center: number): number => {
    const fromEdge = value - (center - SNOW_HALF_WIDTH);
    return center - SNOW_HALF_WIDTH + (((fromEdge % fullWidth) + fullWidth) % fullWidth);
  };
  const update = (dt: number, centerX: number, centerZ: number): void => {
    elapsed += dt;
    for (let i = 0; i < count; i++) {
      fallY[i] -= speed[i] * dt;
      if (fallY[i] < SNOW_MIN_Y) fallY[i] = SNOW_MAX_Y;
      // 구역 밖으로 벗어난 눈송이는 반대쪽에서 다시 내려요.
      const sway = Math.sin(elapsed * 0.5 + phase[i]) * SNOW_SWAY_METERS;
      const x = wrapAround(baseX[i] + sway, centerX);
      const z = wrapAround(baseZ[i], centerZ);
      positions[i * 3] = x;
      // 지붕 없는 병동 안에는 눈이 내리지 않게 땅속으로 숨겨요.
      positions[i * 3 + 1] = isInsideWard(x, z) ? SNOW_HIDDEN_Y : fallY[i];
      positions[i * 3 + 2] = z;
    }
    attribute.needsUpdate = true;
  };
  return { material, update };
}

function buildSteam(parent: Object3D, softCircle: Texture, perRoom: number) {
  const originY = TABLE_HEIGHT + 0.3;
  const puffs = TABLES.flatMap((table) => Array.from({ length: perRoom }, (_, index) => {
    const material = new SpriteMaterial({
      map: softCircle,
      color: "#ffffff",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const sprite = new Sprite(material);
    sprite.renderOrder = 3;
    parent.add(sprite);
    return {
      sprite,
      material,
      age: (index / perRoom) * STEAM_SECONDS,
      originX: table.x,
      originZ: table.z,
      x: randomBetween(-0.12, 0.12),
      z: randomBetween(-0.12, 0.12),
    };
  }));

  const update = (dt: number): void => {
    for (const puff of puffs) {
      puff.age = (puff.age + dt) % STEAM_SECONDS;
      const t = puff.age / STEAM_SECONDS;
      const sway = Math.sin(t * Math.PI * 2 + puff.x * 20) * 0.04;
      puff.sprite.position.set(
        puff.originX + puff.x + sway,
        originY + t * STEAM_RISE_METERS,
        puff.originZ + puff.z,
      );
      puff.sprite.scale.setScalar(0.12 + t * 0.26);
      // 천천히 나타났다가 올라가며 사라져요.
      puff.material.opacity = Math.sin(t * Math.PI) * 0.5;
    }
  };
  return { materials: puffs.map((puff) => puff.material), update };
}

export function buildWinter(
  parent: Object3D,
  softCircle: Texture,
  options: WinterOptions,
): WinterHandles {
  // 겨울 연출을 한 묶음에 담아서 계절에 따라 한 번에 숨길 수 있게 해요.
  const group = new Group();
  parent.add(group);
  buildNightstandTreats(group);
  buildHoppang(group);
  const snow = buildSnow(group, softCircle, options.snowCount);
  const steam = buildSteam(group, softCircle, options.steamPerRoom);
  steam.update(0);
  return {
    snowMaterial: snow.material,
    steamMaterials: steam.materials,
    update(dt, centerX, centerZ) {
      if (!group.visible) return;
      snow.update(dt, centerX, centerZ);
      steam.update(dt);
    },
    setVisible(visible) {
      group.visible = visible;
    },
  };
}
