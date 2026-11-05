import { Color, DirectionalLight, Fog, HemisphereLight, PointLight } from "three";
import type { MeshBasicMaterial, PointsMaterial, Scene, SpriteMaterial } from "three";
import type { HospitalHandles } from "./hospital";
import type { LandscapeHandles } from "./landscape";
import { ROOM, WALL_HEIGHT } from "./layout";
import type { SkyHandles } from "./sky";
import type { TimeSlot } from "./time-of-day";

const TRANSITION_SECONDS = 6;
const FOCUS_FOLLOW_RATE = 2.5;
const FOG_NEAR = 50;
const FOG_FAR = 230;

const COLOR_KEYS = [
  "skyZenith",
  "skyHorizon",
  "ground",
  "ridgeFar",
  "ridgeMid",
  "ridgeNear",
  "cloud",
  "hemiSky",
  "hemiGround",
  "sun",
  "panel",
  "lamp",
  "gardenLamp",
  "windowDark",
  "windowEveningOnly",
  "windowAllNight",
  "snow",
  "steam",
] as const;

const NUMBER_KEYS = [
  "hemi",
  "sunIntensity",
  "ceiling",
  "sleep",
  "glass",
  "starOpacity",
  "sunGlowOpacity",
  "moonOpacity",
] as const;

type ColorKey = (typeof COLOR_KEYS)[number];
type NumberKey = (typeof NUMBER_KEYS)[number];
type LookValues = Record<ColorKey, string> & Record<NumberKey, number>;

interface Look {
  colors: Record<ColorKey, Color>;
  numbers: Record<NumberKey, number>;
}

function createLook(values: LookValues): Look {
  const colors = {} as Record<ColorKey, Color>;
  const numbers = {} as Record<NumberKey, number>;
  for (const key of COLOR_KEYS) colors[key] = new Color(values[key]);
  for (const key of NUMBER_KEYS) numbers[key] = values[key];
  return { colors, numbers };
}

function cloneLook(source: Look): Look {
  const colors = {} as Record<ColorKey, Color>;
  for (const key of COLOR_KEYS) colors[key] = source.colors[key].clone();
  return { colors, numbers: { ...source.numbers } };
}

function mixLook(from: Look, to: Look, t: number, out: Look): void {
  for (const key of COLOR_KEYS) out.colors[key].lerpColors(from.colors[key], to.colors[key], t);
  for (const key of NUMBER_KEYS) {
    out.numbers[key] = from.numbers[key] + (to.numbers[key] - from.numbers[key]) * t;
  }
}

const LOOKS: Record<TimeSlot, Look> = {
  day: createLook({
    skyZenith: "#6fa8d6",
    skyHorizon: "#dcebf3",
    ground: "#dfe9ee",
    ridgeFar: "#bfd2dc",
    ridgeMid: "#9fb9bf",
    ridgeNear: "#7f9f98",
    cloud: "#ffffff",
    hemiSky: "#ffffff",
    hemiGround: "#eae4da",
    hemi: 2.2,
    sun: "#fff8ec",
    sunIntensity: 0.8,
    ceiling: 2,
    sleep: 0,
    panel: "#fff6e0",
    lamp: "#d8cab8",
    gardenLamp: "#e8e6df",
    windowDark: "#90aabb",
    windowEveningOnly: "#90aabb",
    windowAllNight: "#90aabb",
    glass: 0.1,
    snow: "#ffffff",
    steam: "#ffffff",
    starOpacity: 0,
    sunGlowOpacity: 0.95,
    moonOpacity: 0,
  }),
  evening: createLook({
    skyZenith: "#2f3068",
    skyHorizon: "#eba684",
    ground: "#9a8fae",
    ridgeFar: "#a2849a",
    ridgeMid: "#74688c",
    ridgeNear: "#4f4f70",
    cloud: "#e9a897",
    hemiSky: "#ffd7ad",
    hemiGround: "#7a5f4c",
    hemi: 1.15,
    sun: "#ff9f6b",
    sunIntensity: 0.25,
    ceiling: 7,
    sleep: 0,
    panel: "#ffe2b0",
    lamp: "#c9b49c",
    gardenLamp: "#ffd48a",
    windowDark: "#3e4468",
    windowEveningOnly: "#ffd99c",
    windowAllNight: "#ffd99c",
    glass: 0.16,
    snow: "#e8e3f2",
    steam: "#fff0dc",
    starOpacity: 0.3,
    sunGlowOpacity: 0.85,
    moonOpacity: 0.25,
  }),
  night: createLook({
    skyZenith: "#060a18",
    skyHorizon: "#18233f",
    ground: "#1f2a42",
    ridgeFar: "#1d2946",
    ridgeMid: "#172038",
    ridgeNear: "#10172a",
    cloud: "#1a2340",
    hemiSky: "#4c5578",
    hemiGround: "#3a2f2c",
    hemi: 0.7,
    sun: "#6d80b0",
    sunIntensity: 0,
    ceiling: 0,
    sleep: 1.15,
    panel: "#2a2c3a",
    lamp: "#ffc27a",
    gardenLamp: "#ffc98a",
    windowDark: "#1a2138",
    windowEveningOnly: "#1a2138",
    windowAllNight: "#e9bd7d",
    glass: 0.08,
    snow: "#a9b8d6",
    steam: "#7c6f66",
    starOpacity: 1,
    sunGlowOpacity: 0,
    moonOpacity: 1,
  }),
};

export interface LightingTargets {
  ceilingPanel: MeshBasicMaterial;
  sleepLamp: MeshBasicMaterial;
  windowGlass: MeshBasicMaterial;
  snowMaterial: PointsMaterial;
  steamMaterials: readonly SpriteMaterial[];
  hospital: HospitalHandles;
  landscape: LandscapeHandles;
  sky: SkyHandles;
}

export interface Lighting {
  /** immediate가 true이면 전환 없이 바로 바꿔요. */
  setSlot(slot: TimeSlot, immediate: boolean): void;
  /** 빛이 비출 병실의 중심 x 좌표를 정해요. 빛은 그쪽으로 천천히 옮겨 가요. */
  setFocusX(x: number): void;
  update(dt: number): void;
}

/**
 * 낮, 저녁, 소등의 조명과 하늘, 풍경 색을 맡아요. 빛의 개수는 고정이고 밝기만 바꿔서 셰이더를 다시 만들지 않아요.
 * 병실마다 빛을 두면 휴대폰에 무거워서, 천장등과 수면등은 캐릭터가 있는 병실만 비춰요.
 */
export function createLighting(scene: Scene, targets: LightingTargets): Lighting {
  const current = cloneLook(LOOKS.day);
  let from = cloneLook(LOOKS.day);
  let to = LOOKS.day;
  let progress = 1;

  const background = new Color();
  scene.background = background;
  const fog = new Fog(background.getHex(), FOG_NEAR, FOG_FAR);
  scene.fog = fog;

  const hemi = new HemisphereLight();
  scene.add(hemi);

  // 창밖에서 들어오는 빛이에요.
  const sun = new DirectionalLight();
  sun.position.set(1.5, 6, ROOM.minZ - 6);
  scene.add(sun);

  const ceilingLights = [-2.5, 2.5].map((z) => {
    const light = new PointLight("#ffe2b8", 0, 0, 1.4);
    light.position.set(0, WALL_HEIGHT - 0.25, z);
    scene.add(light);
    return light;
  });

  // 수면등은 빛 두 개로 양쪽 줄을 함께 비춰요.
  const sleepOffsets = [ROOM.minX + 1.4, ROOM.maxX - 1.4];
  const sleepLights = sleepOffsets.map((x) => {
    const light = new PointLight("#ffb56b", 0, 0, 0.8);
    light.position.set(x, 1.9, 0);
    scene.add(light);
    return light;
  });

  let focusX = 0;
  let targetFocusX = 0;
  const placeLights = (): void => {
    for (const light of ceilingLights) light.position.x = focusX;
    sleepLights.forEach((light, index) => {
      light.position.x = focusX + sleepOffsets[index];
    });
  };

  const apply = (): void => {
    const { colors, numbers } = current;
    background.copy(colors.skyHorizon);
    fog.color.copy(colors.skyHorizon);
    targets.sky.zenith.copy(colors.skyZenith);
    targets.sky.horizon.copy(colors.skyHorizon);
    targets.sky.clouds.color.copy(colors.cloud);
    targets.sky.stars.opacity = numbers.starOpacity;
    targets.sky.sun.color.copy(colors.sun);
    targets.sky.sun.opacity = numbers.sunGlowOpacity;
    targets.sky.moon.opacity = numbers.moonOpacity;

    hemi.color.copy(colors.hemiSky);
    hemi.groundColor.copy(colors.hemiGround);
    hemi.intensity = numbers.hemi;
    sun.color.copy(colors.sun);
    sun.intensity = numbers.sunIntensity;
    for (const light of ceilingLights) light.intensity = numbers.ceiling;
    for (const light of sleepLights) light.intensity = numbers.sleep;

    targets.ceilingPanel.color.copy(colors.panel);
    targets.sleepLamp.color.copy(colors.lamp);
    targets.windowGlass.opacity = numbers.glass;
    targets.snowMaterial.color.copy(colors.snow);
    for (const material of targets.steamMaterials) material.color.copy(colors.steam);

    targets.landscape.ground.color.copy(colors.ground);
    const [far, mid, near] = targets.landscape.ridges;
    far.color.copy(colors.ridgeFar);
    mid.color.copy(colors.ridgeMid);
    near.color.copy(colors.ridgeNear);
    targets.landscape.gardenLamp.color.copy(colors.gardenLamp);

    targets.hospital.windowDark.color.copy(colors.windowDark);
    targets.hospital.windowEveningOnly.color.copy(colors.windowEveningOnly);
    targets.hospital.windowAllNight.color.copy(colors.windowAllNight);
  };

  apply();

  return {
    setSlot(slot, immediate) {
      to = LOOKS[slot];
      if (immediate) {
        progress = 1;
        mixLook(to, to, 1, current);
        apply();
        return;
      }
      from = cloneLook(current);
      progress = 0;
    },
    setFocusX(x) {
      targetFocusX = x;
    },
    update(dt) {
      if (focusX !== targetFocusX) {
        focusX += (targetFocusX - focusX) * (1 - Math.exp(-dt * FOCUS_FOLLOW_RATE));
        if (Math.abs(targetFocusX - focusX) < 0.01) focusX = targetFocusX;
        placeLights();
      }
      if (progress >= 1) return;
      progress = Math.min(1, progress + dt / TRANSITION_SECONDS);
      const eased = progress * progress * (3 - 2 * progress);
      mixLook(from, to, eased, current);
      apply();
    },
  };
}
