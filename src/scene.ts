import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { createCats } from "./cat/cats";
import { createActionBar } from "./ui/action-bar";
import type { ActionBar } from "./ui/action-bar";
import { createEntryScreen } from "./ui/entry-screen";
import { createHeadLabels } from "./ui/head-labels";
import { defaultProfile, loadProfile, saveProfile } from "./ui/profile";
import type { Profile } from "./ui/profile";
import { createSettings } from "./ui/settings";
import { createOfferings } from "./ward/offerings";
import { createPlayerControls } from "./ward/controls";
import { createLighting } from "./ward/lighting";
import { buildFacilities } from "./ward/facilities";
import { buildHospital } from "./ward/hospital";
import { buildLandscape } from "./ward/landscape";
import { buildWard } from "./ward/room";
import { buildSky } from "./ward/sky";
import { createSoftCircleTexture } from "./ward/soft-texture";
import { currentSlot } from "./ward/time-of-day";
import { buildWinter } from "./ward/winter";

const MAX_FRAME_SECONDS = 0.05;
const SLOT_CHECK_SECONDS = 60;
const PORTRAIT_FOV = 68;
const LANDSCAPE_FOV = 54;
/** 캐릭터를 화면 아래쪽에 두어 앞이 잘 보이게 해요. 화면 높이에 대한 비율이에요. */
const PORTRAIT_VIEW_SHIFT = 0.14;
const LANDSCAPE_VIEW_SHIFT = 0.08;
/** 고르는 패널이 펼쳐지면 아바타가 가리지 않게 화면 위쪽으로 올려요. 입장 화면은 패널이 더 커요. */
const PICKER_VIEW_SHIFT = -0.09;
const ENTRY_VIEW_SHIFT = -0.2;
const VIEW_SHIFT_RATE = 6;

/** 휴대폰이면 눈 입자와 해상도를 줄여서 버벅이지 않게 해요. */
function isPhoneLike(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    Math.min(window.innerWidth, window.innerHeight) < 600
  );
}

/** 병실을 만들고 화면에 그리기 시작해요. */
export function startScene(canvas: HTMLCanvasElement): void {
  const phone = isPhoneLike();
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 1.75 : 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(PORTRAIT_FOV, 1, 0.12, 520);

  const softCircle = createSoftCircleTexture();
  const room = buildWard(scene, softCircle);
  buildFacilities(scene);
  const hospital = buildHospital(scene);
  const landscape = buildLandscape(scene, {
    forestTrees: phone ? 140 : 320,
    ridgeSegments: phone ? 96 : 160,
  });
  const sky = buildSky(scene, softCircle, { starCount: phone ? 150 : 350 });
  const winter = buildWinter(scene, softCircle, {
    snowCount: phone ? 220 : 600,
    steamPerRoom: phone ? 3 : 5,
  });
  const lighting = createLighting(scene, {
    ceiling: room.ceiling,
    ceilingPanel: room.ceilingPanel,
    sleepLamp: room.sleepLamp,
    windowGlass: room.windowGlass,
    snowMaterial: winter.snowMaterial,
    steamMaterials: winter.steamMaterials,
    hospital,
    landscape,
    sky,
  });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const profile: Profile = loadProfile() ?? defaultProfile(Math.random());
  const player = createPlayerControls(scene, camera, canvas, softCircle, {
    species: profile.species,
    outfit: profile.outfit,
  });
  const cats = createCats(scene, player, false);
  player.setTapFilter((origin, reach) => cats.tap(origin, reach));
  const offerings = createOfferings(scene, softCircle);

  let pickerShift: number | null = ENTRY_VIEW_SHIFT;
  let viewShift: number | null = null;

  /** 지금 화면에 맞는 시선 높이로 옮겨요. 값이 그대로면 아무것도 하지 않아요. */
  const applyViewShift = (dt: number): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const rest = width < height ? PORTRAIT_VIEW_SHIFT : LANDSCAPE_VIEW_SHIFT;
    const goal = pickerShift ?? rest;
    if (viewShift === goal) return;
    const eased =
      viewShift === null || reduceMotion.matches
        ? goal
        : viewShift + (goal - viewShift) * (1 - Math.exp(-dt * VIEW_SHIFT_RATE));
    viewShift = Math.abs(eased - goal) < 0.001 ? goal : eased;
    // setViewOffset이 투영 행렬까지 갱신해요. 탭 위치 계산도 같은 행렬을 쓰니 그대로 맞아요.
    camera.setViewOffset(width, height, 0, -height * viewShift, width, height);
  };

  const stillMotion = (): boolean => reduceMotion.matches;
  const element = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`#${id}`);

  const labelsRoot = element("head-labels");
  const labels = labelsRoot ? createHeadLabels(labelsRoot) : null;
  let actionBar: ActionBar | null = null;

  const applyProfile = (next: Profile): void => {
    player.setChoice({ species: next.species, outfit: next.outfit });
    cats.setCompanion(next.withCat);
    labels?.setName(next.nickname);
  };

  const enterWard = (entered: Profile): void => {
    saveProfile(entered);
    applyProfile(entered);
    pickerShift = null;
    player.setFacingCamera(false);
    player.setInputEnabled(true);

    const settingsRoot = element("settings");
    if (settingsRoot) {
      createSettings(settingsRoot, {
        initial: entered,
        onChange: (next) => {
          saveProfile(next);
          applyProfile(next);
        },
        onOpenChange: (open) => {
          pickerShift = open ? PICKER_VIEW_SHIFT : null;
          player.setFacingCamera(open);
        },
      });
    }
    const barRoot = element("action-bar");
    const toast = element("toast");
    if (barRoot && toast && labels) {
      actionBar = createActionBar({ root: barRoot, toast, player, offerings, labels, stillMotion });
    }
  };

  player.setFacingCamera(true);
  player.setInputEnabled(false);
  const entryRoot = element("entry");
  if (entryRoot) {
    createEntryScreen(entryRoot, { initial: profile, onPreview: applyProfile, onEnter: enterWard });
  } else {
    enterWard(profile);
  }

  const readSlot = () => currentSlot(new Date(), window.location.search);
  let slot = readSlot();
  lighting.setSlot(slot, true);

  const resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // 세로 화면에서는 좌우가 좁아서 시야를 넓혀요.
    const portrait = width < height;
    camera.fov = portrait ? PORTRAIT_FOV : LANDSCAPE_FOV;
    // 화면 크기가 바뀌면 시선 높이를 곧바로 다시 맞춰요.
    viewShift = null;
    applyViewShift(0);
  };
  window.addEventListener("resize", resize);
  resize();

  const headPoint = new Vector3();
  let lastMs: number | null = null;
  let sinceSlotCheck = 0;

  renderer.setAnimationLoop((timeMs) => {
    const dt = lastMs === null ? 0 : Math.min(MAX_FRAME_SECONDS, (timeMs - lastMs) / 1000);
    lastMs = timeMs;

    sinceSlotCheck += dt;
    if (sinceSlotCheck >= SLOT_CHECK_SECONDS) {
      sinceSlotCheck = 0;
      const next = readSlot();
      if (next !== slot) {
        slot = next;
        lighting.setSlot(slot, reduceMotion.matches);
      }
    }

    applyViewShift(dt);
    player.update(dt);
    cats.update(dt, reduceMotion.matches);
    offerings.update(dt, reduceMotion.matches);
    actionBar?.update(dt);
    const motionDt = reduceMotion.matches ? 0 : dt;
    winter.update(motionDt, player.x, player.z);
    sky.update(motionDt);
    lighting.setFocus(player.x, player.z);
    lighting.update(dt);
    renderer.render(scene, camera);
    // 머리 위 글자는 카메라가 다 움직인 뒤에 맞춰요.
    labels?.update(dt, camera, player.headWorld(headPoint));
  });
}
