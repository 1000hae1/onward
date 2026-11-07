import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
} from "three";
import type { Object3D, Texture } from "three";
import { blobs, merged } from "../avatar/shapes.ts";
import { getAvatarMaterial } from "../avatar/kit";
import type { BlobSpec } from "../avatar/species";
import { giftSpot, NIGHTSTANDS, ROOMS, windowLampSpot } from "../../shared/ward-layout";
import type { WardRoom } from "../../shared/ward-layout";
import {
  canAddLamp,
  chooseGiftSlot,
  GIFT_SLOTS_PER_STAND,
  lampSlotPosition,
  LAMPS_PER_WINDOW,
} from "../../shared/offering-rules";
import type { PlacedGift } from "../../shared/offering-rules";
import { transform } from "./parts";

interface Spot {
  x: number;
  y: number;
  z: number;
}

const LIGHT_FLIGHT_SECONDS = 1.5;
const LIGHT_GLOW_SECONDS = 1.6;
const LIGHT_ARC = 0.7;
const LIGHT_POOL = 4;
const GIFT_FLIGHT_SECONDS = 0.9;
const GIFT_ARC = 0.5;
const LAMP_COUNT = ROOMS.length * LAMPS_PER_WINDOW;
const GIFT_CAPACITY = NIGHTSTANDS.length * GIFT_SLOTS_PER_STAND;

const STEM = "#5f9a58";
const LEAF = "#6fb56a";

/** 잎이 count장인 클로버예요. 위에서 잘 보이게 줄기 끝에 납작한 잎을 빙 둘러요. */
function clover(count: number): BlobSpec[] {
  const leaves: BlobSpec[] = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      shape: "ball",
      color: LEAF,
      at: [Math.cos(angle) * 0.04, 0.12, Math.sin(angle) * 0.04],
      size: [0.034, 0.011, 0.026],
      tilt: [0, -angle, 0],
      small: true,
    };
  });
  return [{ shape: "pill", color: STEM, at: [0, 0.058, 0], size: [0.006, 0.1, 1], small: true }, ...leaves];
}

/** 선물의 생김새예요. 번호는 shared/gestures.ts의 GIFTS 순서와 같아요. */
const GIFT_SHAPES: readonly BlobSpec[][] = [
  clover(4),
  clover(5),
  [
    { shape: "ball", color: "#f08a1d", at: [0, 0.052, 0], size: [0.062, 0.053, 0.062] },
    { shape: "ball", color: "#3f8f45", at: [0.02, 0.106, 0], size: [0.024, 0.006, 0.012], small: true },
  ],
  [
    { shape: "ball", color: "#e4602a", at: [0, 0.055, 0], size: [0.064, 0.056, 0.064] },
    { shape: "ball", color: "#5a6b3a", at: [0, 0.11, 0], size: [0.026, 0.006, 0.026], small: true },
  ],
  [{ shape: "ball", color: "#fff4e0", at: [0, 0.055, 0], size: [0.078, 0.058, 0.078] }],
];

const LAMP_SHAPE: BlobSpec[] = [
  { shape: "ball", color: "#b98a56", at: [0, 0.012, 0], size: [0.03, 0.012, 0.03], small: true },
  { shape: "ball", color: "#ffd98a", at: [0, 0.05, 0], size: [0.03, 0.036, 0.03] },
];

export interface Offerings {
  update(dt: number, stillMotion: boolean): void;
  /** 작은 빛이 from에서 to로 날아가요. 침대 머리맡이나 사람의 머리예요. */
  sendLight(from: Spot, to: Spot, stillMotion: boolean): void;
  /** 혼자 쓸 때예요. 빈 칸을 골라 선물을 그 침대의 협탁으로 보내요. */
  sendGift(from: Spot, bed: number, gift: number, stillMotion: boolean): void;
  /** 서버가 정한 칸으로 선물을 보내요. */
  placeGift(from: Spot, stand: number, slot: number, gift: number, stillMotion: boolean): void;
  /** 들어올 때 받은 선물들로 협탁을 채워요. */
  loadGifts(gifts: readonly { stand: number; slot: number; item: number }[]): void;
  /** 혼자 쓸 때예요. 병실 창틀에 램프를 하나 놓아요. 가득 찼으면 false예요. */
  addLamp(room: WardRoom): boolean;
  /** 서버가 알려 준 병실별 램프 수로 맞춰요. */
  setLamps(counts: readonly number[]): void;
  setLampCount(room: number, count: number): void;
}

interface LightFlight {
  sprite: Sprite;
  material: SpriteMaterial;
  from: Spot;
  to: Spot;
  age: number;
  busy: boolean;
}

interface GiftFlight {
  mesh: Mesh;
  gift: number;
  from: Spot;
  to: Spot;
  age: number;
  placed: PlacedGift;
}

/** 평안의 빛, 협탁 선물, 창가 램프예요. 아직 서버가 없어 내 화면에만 보여요. */
export function createOfferings(parent: Object3D, softCircle: Texture): Offerings {
  // 빛은 실제 광원이 아니라 스스로 빛나는 그림 한 장이라 가벼워요.
  const lights: LightFlight[] = Array.from({ length: LIGHT_POOL }, () => {
    const material = new SpriteMaterial({
      map: softCircle,
      color: "#ffc24d",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const sprite = new Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 4;
    parent.add(sprite);
    const origin = { x: 0, y: 0, z: 0 };
    return { sprite, material, from: origin, to: origin, age: 0, busy: false };
  });

  const material = getAvatarMaterial();
  const giftGeometries = GIFT_SHAPES.map((shape) => merged(blobs(shape)));
  const giftMeshes = giftGeometries.map((geometry) => {
    const mesh = new InstancedMesh(geometry, material, GIFT_CAPACITY);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  });
  const slots: (PlacedGift | null)[][] = NIGHTSTANDS.map(() =>
    Array.from({ length: GIFT_SLOTS_PER_STAND }, () => null),
  );
  const flying = new Set<PlacedGift>();
  const giftFlights: GiftFlight[] = [];
  let giftOrder = 0;

  /** 놓인 선물로 인스턴스를 다시 채워요. 선물을 놓을 때만 불러요. */
  const refreshGifts = (): void => {
    const counts = giftMeshes.map(() => 0);
    slots.forEach((stand, standIndex) => {
      stand.forEach((placed, slot) => {
        if (!placed || flying.has(placed)) return;
        const spot = giftSpot(standIndex, slot);
        const mesh = giftMeshes[placed.gift];
        mesh.setMatrixAt(counts[placed.gift], transform(spot.x, spot.y, spot.z));
        counts[placed.gift]++;
      });
    });
    giftMeshes.forEach((mesh, index) => {
      mesh.count = counts[index];
      mesh.visible = counts[index] > 0;
      mesh.instanceMatrix.needsUpdate = true;
    });
  };

  const lampGeometry = merged(blobs(LAMP_SHAPE));
  const lampMesh = new InstancedMesh(
    lampGeometry,
    new MeshBasicMaterial({ vertexColors: true }),
    LAMP_COUNT,
  );
  lampMesh.count = 0;
  lampMesh.visible = false;
  lampMesh.frustumCulled = false;
  parent.add(lampMesh);

  const haloPositions = new Float32Array(LAMP_COUNT * 3);
  const haloGeometry = new BufferGeometry();
  haloGeometry.setAttribute("position", new BufferAttribute(haloPositions, 3));
  haloGeometry.setDrawRange(0, 0);
  const halos = new Points(
    haloGeometry,
    new PointsMaterial({
      map: softCircle,
      color: "#ffd38a",
      size: 0.3,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      fog: false,
    }),
  );
  halos.frustumCulled = false;
  halos.visible = false;
  halos.renderOrder = 3;
  parent.add(halos);
  const lampCounts = ROOMS.map(() => 0);

  /** 병실별 램프 수대로 창틀을 다시 채워요. 램프가 늘어날 때만 불러요. */
  const refreshLamps = (): void => {
    let total = 0;
    ROOMS.forEach((room) => {
      for (let slot = 0; slot < lampCounts[room.index]; slot++) {
        const spot = windowLampSpot(room, lampSlotPosition(slot));
        lampMesh.setMatrixAt(total, transform(spot.x, spot.y, spot.z));
        haloPositions.set([spot.x, spot.y + 0.05, spot.z], total * 3);
        total++;
      }
    });
    lampMesh.instanceMatrix.needsUpdate = true;
    haloGeometry.getAttribute("position").needsUpdate = true;
    lampMesh.count = total;
    lampMesh.visible = total > 0;
    haloGeometry.setDrawRange(0, total);
    halos.visible = total > 0;
  };

  const setLampCount = (room: number, count: number): void => {
    if (room < 0 || room >= lampCounts.length) return;
    lampCounts[room] = Math.min(count, LAMPS_PER_WINDOW);
    refreshLamps();
  };

  const placeGift = (from: Spot, stand: number, slot: number, gift: number, stillMotion: boolean): void => {
    if (!slots[stand] || slot >= GIFT_SLOTS_PER_STAND || !giftGeometries[gift]) return;
    const placed: PlacedGift = { order: giftOrder++, gift };
    slots[stand][slot] = placed;
    if (stillMotion) {
      refreshGifts();
      return;
    }
    const flight: GiftFlight = {
      mesh: new Mesh(giftGeometries[gift], material),
      gift,
      from,
      to: giftSpot(stand, slot),
      age: 0,
      placed,
    };
    flying.add(placed);
    parent.add(flight.mesh);
    flight.mesh.position.set(from.x, from.y, from.z);
    giftFlights.push(flight);
    // 밀려난 선물을 지우려고 다시 채워요. 날아가는 선물은 도착한 뒤에 들어가요.
    refreshGifts();
  };

  const landGift = (flight: GiftFlight): void => {
    flying.delete(flight.placed);
    flight.mesh.visible = false;
    refreshGifts();
  };

  return {
    sendLight(from, to, stillMotion) {
      const light = lights.find((candidate) => !candidate.busy) ?? lights[0];
      // 움직임을 줄이면 날아가지 않고 닿는 곳에서 바로 빛나요.
      light.from = stillMotion ? to : from;
      light.to = to;
      light.age = stillMotion ? LIGHT_FLIGHT_SECONDS : 0;
      light.busy = true;
      light.sprite.visible = true;
    },
    sendGift(from, bed, gift, stillMotion) {
      placeGift(from, bed, chooseGiftSlot(slots[bed]), gift, stillMotion);
    },
    placeGift,
    loadGifts(gifts) {
      for (const stand of slots) stand.fill(null);
      for (const gift of gifts) {
        if (slots[gift.stand] && gift.slot < GIFT_SLOTS_PER_STAND) {
          slots[gift.stand][gift.slot] = { order: giftOrder++, gift: gift.item };
        }
      }
      refreshGifts();
    },
    addLamp(room) {
      const count = lampCounts[room.index];
      if (!canAddLamp(count)) return false;
      setLampCount(room.index, count + 1);
      return true;
    },
    setLamps(counts) {
      counts.forEach((count, room) => {
        if (room < lampCounts.length) lampCounts[room] = Math.min(count, LAMPS_PER_WINDOW);
      });
      refreshLamps();
    },
    setLampCount,
    update(dt) {
      for (const light of lights) {
        if (!light.busy) continue;
        light.age += dt;
        const { from, to, sprite, material: lightMaterial } = light;
        if (light.age < LIGHT_FLIGHT_SECONDS) {
          const t = light.age / LIGHT_FLIGHT_SECONDS;
          const eased = t * t * (3 - 2 * t);
          sprite.position.set(
            from.x + (to.x - from.x) * eased,
            from.y + (to.y - from.y) * eased + Math.sin(t * Math.PI) * LIGHT_ARC,
            from.z + (to.z - from.z) * eased,
          );
          sprite.scale.setScalar(0.32 + Math.sin(t * Math.PI * 6) * 0.04);
          lightMaterial.opacity = Math.min(1, t * 6);
        } else {
          const t = (light.age - LIGHT_FLIGHT_SECONDS) / LIGHT_GLOW_SECONDS;
          sprite.position.set(to.x, to.y, to.z);
          sprite.scale.setScalar(0.32 + Math.sin(Math.min(1, t) * Math.PI) * 0.4);
          lightMaterial.opacity = Math.max(0, 1 - t);
          if (t >= 1) {
            light.busy = false;
            sprite.visible = false;
          }
        }
      }
      for (let index = giftFlights.length - 1; index >= 0; index--) {
        const flight = giftFlights[index];
        flight.age += dt;
        const t = Math.min(1, flight.age / GIFT_FLIGHT_SECONDS);
        const eased = t * t * (3 - 2 * t);
        flight.mesh.position.set(
          flight.from.x + (flight.to.x - flight.from.x) * eased,
          flight.from.y + (flight.to.y - flight.from.y) * eased + Math.sin(t * Math.PI) * GIFT_ARC,
          flight.from.z + (flight.to.z - flight.from.z) * eased,
        );
        if (t >= 1) {
          parent.remove(flight.mesh);
          landGift(flight);
          giftFlights.splice(index, 1);
        }
      }
    },
  };
}
