import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { createPlayerControls } from "./ward/controls";
import { nearestRoomIndex, PLAYER_START, ROOMS } from "./ward/layout";
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
const PORTRAIT_FOV = 62;
const LANDSCAPE_FOV = 48;
/** 캐릭터를 화면 아래쪽에 두어 병실이 잘 보이게 해요. 화면 높이에 대한 비율이에요. */
const PORTRAIT_VIEW_SHIFT = 0.24;
const LANDSCAPE_VIEW_SHIFT = 0.12;

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
  const camera = new PerspectiveCamera(PORTRAIT_FOV, 1, 0.3, 520);
  // 하늘과 먼 산까지 보이도록 조금 낮은 각도에서 시작해요.
  camera.position.set(PLAYER_START.x, 6.2, PLAYER_START.z + 11.5);

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
    ceilingPanel: room.ceilingPanel,
    sleepLamp: room.sleepLamp,
    windowGlass: room.windowGlass,
    snowMaterial: winter.snowMaterial,
    steamMaterials: winter.steamMaterials,
    hospital,
    landscape,
    sky,
  });
  const player = createPlayerControls(scene, camera, canvas, softCircle);

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
    const shift = portrait ? PORTRAIT_VIEW_SHIFT : LANDSCAPE_VIEW_SHIFT;
    // setViewOffset이 투영 행렬까지 갱신해요. 탭 위치 계산도 같은 행렬을 쓰니 그대로 맞아요.
    camera.setViewOffset(width, height, 0, -height * shift, width, height);
  };
  window.addEventListener("resize", resize);
  resize();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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

    player.update(dt);
    const motionDt = reduceMotion.matches ? 0 : dt;
    winter.update(motionDt, player.x, player.z);
    sky.update(motionDt);
    lighting.setFocusX(ROOMS[nearestRoomIndex(player.x)].x);
    lighting.update(dt);
    renderer.render(scene, camera);
  });
}
