import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { nicknameMessage } from "../shared/nickname";
import { WARD_CAPACITY } from "../shared/protocol";
import type { WardEvent } from "../shared/protocol";
import { createCats } from "./cat/cats";
import { createRemoteGuests } from "./net/remote-guests";
import { createWardClient } from "./net/ward-client";
import { loadGuestId, readWardParams, wardLabel } from "./net/ward-params";
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

/** 서버가 동작을 받지 않았을 때의 안내예요. */
const DENIED_TEXT: Record<"out-of-season" | "gift-limit" | "lamp-full" | "not-in-room" | "no-target" | "too-fast", string> = {
  "out-of-season": "귤·홍시·호빵은 11월부터 2월까지 놓을 수 있어요.",
  "gift-limit": "오늘은 선물을 넉넉히 놓았어요. 내일 또 놓아 주세요.",
  "lamp-full": "창가가 불빛으로 가득해요.",
  "not-in-room": "병실에 들어가면 놓을 수 있어요.",
  "no-target": "그곳에는 보낼 수 없어요.",
  "too-fast": "조금 천천히 눌러 주세요.",
};

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
  const remoteLabels = document.querySelector<HTMLElement>("#remote-labels");
  const offerings = createOfferings(scene, softCircle);
  const myHeadPoint = new Vector3();
  const myHead = () => {
    const head = player.headWorld(myHeadPoint);
    return head ? { x: head.x, y: head.y, z: head.z } : { x: player.x, y: 1, z: player.z };
  };
  const remotes = createRemoteGuests(scene, player.nav, remoteLabels, offerings, myHead);
  const cats = createCats(
    scene,
    {
      get walkX() {
        return player.walkX;
      },
      get walkZ() {
        return player.walkZ;
      },
      get lyingBed() {
        return player.lyingBed;
      },
      get claimedBed() {
        return player.claimedBed;
      },
      othersInRoom: (roomIndex) => remotes.othersInRoom(roomIndex),
    },
    false,
  );
  player.setTapFilter((origin, reach) => cats.tap(origin, reach));

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
  let current = profile;
  let entered = false;

  const params = readWardParams(window.location.search);
  const hud = element("hud");
  const setHud = (count: number | null): void => {
    if (hud) hud.textContent = wardLabel(params.ward, count, WARD_CAPACITY);
  };
  setHud(null);
  const toast = (text: string): void => actionBar?.showToast(text);
  let warnedOffline = false;

  const client = createWardClient(params, loadGuestId(), {
    onSnapshot(snapshot, reconnected) {
      remotes.reset(snapshot.guests, snapshot.you);
      offerings.loadGifts(snapshot.gifts);
      offerings.setLamps(snapshot.lamps);
      setHud(remotes.count + 1);
      warnedOffline = false;
      // 다시 이어졌으면 서버는 나를 앞마당에 두었으니, 지금 자리와 침대를 다시 알려요.
      client.send({ type: "walk-to", x: player.walkX, z: player.walkZ });
      const bed = player.claimedBed;
      if (reconnected && bed !== null) {
        void client.askBed(bed).then((granted) => {
          if (!granted) {
            player.forceGetUp();
            toast("다시 이어지는 사이 다른 분이 침대에 누웠어요.");
          }
        });
      }
    },
    onEvent(event: WardEvent) {
      if (event.kind === "gift") {
        const from = remotes.handSpot(event.id) ?? player.handSpot();
        offerings.placeGift(from, event.gift.stand, event.gift.slot, event.gift.item, stillMotion());
        return;
      }
      if (event.kind === "lamp") {
        offerings.setLampCount(event.room, event.count);
        return;
      }
      remotes.apply(event);
      if (event.kind === "join" || event.kind === "leave") setHud(remotes.count + 1);
    },
    onCorrected(x, z) {
      player.correctDestination(x, z);
    },
    onNicknameRejected(problem) {
      reopenEntry(nicknameMessage(problem));
    },
    onDenied(denied) {
      toast(DENIED_TEXT[denied.reason]);
    },
    onStatus(status) {
      if (status === "online") return;
      setHud(null);
      remotes.reset([], "");
      if (status === "replaced") {
        toast("다른 창에서 병동에 들어와서 이 창은 쉬어요.");
      } else if (status === "full") {
        toast("병동이 모두 차서 혼자 머물러요.");
      } else if (status === "offline" && !warnedOffline) {
        warnedOffline = true;
        toast("병동 서버에 닿지 않아 혼자 머물러요. 다시 이어 볼게요.");
      }
    },
  });

  player.setNet({
    askBed: (bed) => client.askBed(bed),
    isBedTaken: (bed) => client.online && remotes.isBedTaken(bed),
    walkTo: (x, z) => client.send({ type: "walk-to", x, z }),
    getUp: () => client.send({ type: "get-up" }),
    bedRefused: () => toast("다른 분이 먼저 자리를 잡았어요."),
  });

  const applyProfile = (next: Profile): void => {
    current = next;
    player.setChoice({ species: next.species, outfit: next.outfit });
    cats.setCompanion(next.withCat);
    labels?.setName(next.nickname);
  };

  const enterWard = (chosen: Profile): void => {
    saveProfile(chosen);
    applyProfile(chosen);
    pickerShift = null;
    player.setFacingCamera(false);
    player.setInputEnabled(true);
    client.hello(chosen);
    if (entered) return;
    entered = true;

    const settingsRoot = element("settings");
    if (settingsRoot) {
      createSettings(settingsRoot, {
        initial: chosen,
        onChange: (next) => {
          saveProfile(next);
          applyProfile(next);
          client.hello(next);
        },
        onOpenChange: (open) => {
          pickerShift = open ? PICKER_VIEW_SHIFT : null;
          player.setFacingCamera(open);
        },
      });
    }
    const barRoot = element("action-bar");
    const toastRoot = element("toast");
    if (barRoot && toastRoot && labels) {
      actionBar = createActionBar({
        root: barRoot,
        toast: toastRoot,
        player,
        offerings,
        labels,
        stillMotion,
        sink: {
          online: () => client.online,
          bless: (bedId) => client.send({ type: "bless", bedId }),
          bow: (phrase) => client.send({ type: "bow", phrase }),
          gift: (bedId, item) => client.send({ type: "gift", bedId, item }),
          lamp: () => client.send({ type: "lamp" }),
        },
      });
    }
  };

  const entryRoot = element("entry");
  /** 서버가 닉네임을 받지 않으면 입장 화면을 다시 열어 고칠 수 있게 해요. */
  const reopenEntry = (message?: string): void => {
    if (!entryRoot) return;
    pickerShift = ENTRY_VIEW_SHIFT;
    player.setFacingCamera(true);
    player.setInputEnabled(false);
    createEntryScreen(entryRoot, {
      initial: { ...current, nicknameAuto: false },
      onPreview: applyProfile,
      onEnter: enterWard,
      message,
    });
  };

  if (entryRoot) {
    player.setFacingCamera(true);
    player.setInputEnabled(false);
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
    remotes.update(dt, { x: player.x, z: player.z }, camera, reduceMotion.matches);
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
