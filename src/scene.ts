import { NeutralToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { nicknameMessage } from "../shared/nickname";
import { BED_COUNT, PROTOCOL_VERSION, WARD_CAPACITY } from "../shared/protocol";
import type { WardEvent } from "../shared/protocol";
import { CAT_VISIT_AFTER_MS, readVersion } from "../shared/ward-rules";
import { BEDS } from "../shared/ward-layout";
import type { CatVisitPlan } from "./cat/cat-path";
import { createCats } from "./cat/cats";
import { createCatPlayFlow } from "./ward/cat-play-flow";
import type { CatPlayFlow } from "./ward/cat-play-flow";
import { createRemoteGuests } from "./net/remote-guests";
import { loadMetList, rememberPerson, saveMetList } from "./net/met-list";
import type { MetList } from "./net/met-list";
import { createBlessingCards } from "./ui/blessing-cards";
import { FIVE_LEAF_ITEM, inboxAckUpTo } from "../shared/left-blessings";
import { koreanDay } from "../shared/ward-rules";
import type { BlessingCardMessage, Guest } from "../shared/protocol";
import { createWardClient } from "./net/ward-client";
import { loadGuestToken, loadSeat, readWardParams, saveSeat, storageWorks, wardLabel } from "./net/ward-params";
import { bedGuide, bedGuideText } from "../shared/bed-rules";
import { BENCH_FULL_TEXT, SEAT_TAKEN_TEXT } from "../shared/bench-rules";
import { NO_STORAGE_TEXT } from "./ui/entry-text";
import { createButton } from "./ui/widgets";
import { followTopStack } from "./ui/top-stack";
import { createFiveLeafMemory } from "./net/five-leaf";
import { lampPlacedText, lampSlotPosition } from "../shared/offering-rules";
import { createGate } from "./ui/gate";
import { createActionBar } from "./ui/action-bar";
import type { ActionBar } from "./ui/action-bar";
import { createEntryScreen } from "./ui/entry-screen";
import { createHeadLabels } from "./ui/head-labels";
import { defaultProfile, loadProfile, saveProfile } from "./ui/profile";
import type { Profile } from "./ui/profile";
import { createSettings } from "./ui/settings";
import type { Settings } from "./ui/settings";
import { createOfferings } from "./ward/offerings";
import { createPlayerControls } from "./ward/controls";
import { createLighting } from "./ward/lighting";
import { buildFacilities } from "./ward/facilities";
import { bedPlates, createBedPlatesView } from "./ward/bed-plates";
import { createNurseGreeter } from "./ward/nurse-greeting";
import { buildHospital } from "./ward/hospital";
import { signLitFor } from "./ward/signboard-layout";
import { buildLandscape } from "./ward/landscape";
import { buildWard } from "./ward/room";
import { buildSky } from "./ward/sky";
import { createSoftCircleTexture } from "./ward/soft-texture";
import { currentSlot, parseSeasonOverride, parseTimeOverride } from "./ward/time-of-day";
import { createDebugPanel } from "./ui/debug-panel";
import {
  countNight,
  lightsOutText,
  nextSlotChange,
  NIGHT_STAY_MS,
  nightKey,
  nightsText,
  parseNightRecord,
  shouldPause,
  statsLine,
} from "../shared/daily";
import type { NightRecord } from "../shared/daily";
import type { WardStats } from "../shared/protocol";
import { createNotice } from "./ui/notice";
import { createSleepMode } from "./ui/sleep-mode";
import { KEPT_QUIET_TEXT, SLEEPING_PERSON_TEXT, SLEPT_LONG_TEXT, sleptSummaryText } from "../shared/sleep-rules";
import { readClockShiftMs, readDebugFlag } from "./net/ward-params";
import { buildWinter } from "./ward/winter";
import { fetchGuestbook, forgetVisitToken, takeVisitToken } from "./net/guestbook-api";
import type { GuestbookMessage, OwnerGuestbook } from "./guestbook/owner-panel";
import { createAppleTree } from "./ward/apple-tree-view";
import { VISIT_BUSY_TEXT, VISIT_CLOSED_TEXT, visitorArrivedText, visitTitle } from "../shared/visit-rules";
import type { DeniedReason } from "../shared/protocol";
import { CAT_NOT_LYING_TEXT, CAT_PET_ONLY_TEXT, CAT_REST_TEXT } from "../shared/cat-play-rules";
import { HUG_DECLINED_TEXT, HUG_DENIED_TEXT, hugMenuState, hugOfferText, hugSpot } from "../shared/hug-rules";
import type { HugDenied } from "../shared/hug-rules";
import { isMorningWindow } from "../shared/morning";
import { planterText } from "../shared/planter";
import { dischargeNoticeText, farewellCardText } from "../shared/discharge-rules";
import { WELCOME_BACK_TEXT } from "../shared/return-rules";
import { bedHeadSpot, doorSpots, roomAt, ROOMS, windowLampSpot } from "../shared/ward-layout";
import { createPlanters } from "./ward/planter-view";
import { createMorningWindows } from "./ward/morning-window";
import { createWarmGlows } from "./ward/warm-glow";
import { createHeadLanterns } from "./ward/head-lanterns";
import { createMoments } from "./ui/moments";
import { LIGHT_DELAY_SECONDS } from "./ui/action-bar";
import { BED_TRANSITION_SECONDS } from "./avatar/pose";
import {
  createFpsProbe,
  judgeQuality,
  pixelRatioFor,
  snowFraction,
  snowSpeed,
  startQuality,
} from "./ward/quality";
import type { DeviceHints, Quality, QualityChoice } from "./ward/quality";
import { applyLargeText, loadViewPrefs, saveViewPrefs } from "./ui/view-prefs";
import type { ViewPrefs } from "./ui/view-prefs";
import { createWebglFallback } from "./ui/webgl-fallback";
import { blessedMeText, bowText, createAnnouncer, giftForMeText } from "./ui/announcer";
import { blessingText, giftName } from "../shared/gestures";

const MAX_FRAME_SECONDS = 0.05;
/** 병아리 간호사 머리 꼭대기에서 등불까지의 높이예요. */
const NURSE_LANTERN_ABOVE = 0.28;
/** 수면 모드에서는 화면이 거의 검으니 초당 4번만 그려요. */
const SLEEP_FRAME_SECONDS = 0.25;
const SLEEP_MAX_FRAME_SECONDS = 0.3;
const NIGHTS_KEY = "onward.nights";
/** 침대를 옮기려는 사이 다른 분이 먼저 누웠을 때예요. */
const BED_MOVE_TAKEN_TEXT = "방금 다른 분이 누우셨어요.";
/** 침대를 받은 뒤 눕기 요청의 답을 이만큼 기다렸다가, 눕지 않으면 남겨진 평안을 그냥 보여 줘요. */
const PENDING_LEFT_WAIT_MS = 1500;
/** 처음 침대를 고르려는 사이 다른 분이 먼저 받았을 때예요. */
const BED_CLAIM_TAKEN_TEXT = "방금 다른 분이 자리를 잡았어요.";
/** 다시 이어지는 사이 내 침대를 잃었을 때예요(30초가 넘게 끊겼어요). */
const BED_LOST_TEXT = "다시 이어지는 사이 침대가 비워졌어요. 빈 침대를 다시 골라 주세요.";
const PORTRAIT_FOV = 68;
const LANDSCAPE_FOV = 54;
/** 캐릭터를 화면 아래쪽에 두어 앞이 잘 보이게 해요. 화면 높이에 대한 비율이에요. */
const PORTRAIT_VIEW_SHIFT = 0.14;
const LANDSCAPE_VIEW_SHIFT = 0.08;
/** 입장 화면이 펼쳐지면 아바타가 가리지 않게 화면 위쪽으로 올려요. */
const ENTRY_VIEW_SHIFT = -0.2;
const VIEW_SHIFT_RATE = 6;
/**
 * 넓은 가로 화면에서는 입장 패널이 왼쪽에 서요(style.css와 같은 조건). 아바타는 남은 오른쪽의
 * 가운데에 오도록 옆으로 비켜요. 패널 오른쪽 끝(px)의 절반만큼 옮기면 남은 공간의 가운데예요.
 */
const SIDE_ENTRY_QUERY = "(min-width: 900px) and (orientation: landscape)";
const SIDE_ENTRY_FALLBACK_PX = 440;
const SIDE_ENTRY_VIEW_SHIFT = -0.04;

/** 다른 사람이 걷는 빠르기예요. 안아 주러 다가가는 시간을 어림할 때 써요. */
const HUG_WALK_SPEED = 1.8;
const HUG_GLOW_HEIGHT = 0.85;

/** 서버가 동작을 받지 않았을 때의 안내예요. */
const DENIED_TEXT: Record<DeniedReason, string> = {
  "too-far": HUG_DENIED_TEXT["too-far"],
  "too-soon": HUG_DENIED_TEXT["too-soon"],
  unavailable: HUG_DENIED_TEXT.unavailable,
  "not-morning": "좋은 아침 인사는 아침 6시 30분부터 9시까지 건넬 수 있어요.",
  "no-bed": "내 침대를 고른 뒤 만들 수 있어요.",
  "once-a-day": "그분께는 오늘 이미 남겼어요. 내일 또 남겨 주세요.",
  "out-of-season": "귤·홍시·호빵은 11월부터 2월까지 놓을 수 있어요.",
  "gift-limit": "오늘은 선물을 넉넉히 놓았어요. 내일 또 놓아 주세요.",
  "lamp-full": "창가가 불빛으로 가득해요.",
  "not-in-room": "병실에 들어가면 놓을 수 있어요.",
  "no-target": "그곳에는 보낼 수 없어요.",
  "too-fast": "조금 천천히 눌러 주세요.",
  "pet-only": CAT_PET_ONLY_TEXT,
  "not-lying": CAT_NOT_LYING_TEXT,
  resting: CAT_REST_TEXT,
};

/** 휴대폰이면 눈 입자와 해상도를 줄여서 버벅이지 않게 해요. */
function isPhoneLike(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    Math.min(window.innerWidth, window.innerHeight) < 600
  );
}

/** 브라우저가 알려 주는 기기 정보예요. 모르면 비워 둬요. */
function deviceHints(): DeviceHints {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  return {
    ...(typeof memory === "number" && memory > 0 ? { deviceMemory: memory } : {}),
    ...(typeof cores === "number" && cores > 0 ? { cores } : {}),
  };
}

/** 테스트용 ?quality=light|normal이에요. 이번에만 쓰고 저장하지 않아요. */
function readQualityOverride(search: string): Quality | null {
  const value = new URLSearchParams(search).get("quality");
  return value === "light" || value === "normal" ? value : null;
}

/**
 * 병실을 만들고 화면에 그리기 시작해요. WebGL을 쓸 수 없으면 오류를 던져요.
 * health는 로딩 화면에서 받은 /api/health 대답이에요. 서버 버전을 견줄 때 써요.
 */
export function startScene(canvas: HTMLCanvasElement, health: string): void {
  const phone = isPhoneLike();
  let view: ViewPrefs = loadViewPrefs();
  const hints = deviceHints();
  const qualityOverride = readQualityOverride(window.location.search);
  const qualityChoice = (): QualityChoice => qualityOverride ?? view.quality;
  let quality: Quality = startQuality(qualityChoice(), hints, view.lastAuto);
  // 안티에일리어싱은 만들 때만 정할 수 있어요. 가볍게면 끄고 시작해요.
  const renderer = new WebGLRenderer({ canvas, antialias: quality === "normal", powerPreference: "low-power" });
  renderer.setPixelRatio(pixelRatioFor(quality, window.devicePixelRatio, phone));
  // 색은 sRGB로 내보내요. 톤 매핑은 아주 밝은 곳만 눌러 주는 Neutral이라 낮 화면의 색은 거의 그대로이고,
  // 밤에는 노출을 조금 올려도 색조와 채도가 흐려지지 않아요.
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new Scene();
  const camera = new PerspectiveCamera(PORTRAIT_FOV, 1, 0.12, 520);

  const softCircle = createSoftCircleTexture();
  const room = buildWard(scene, softCircle);
  const facilities = buildFacilities(scene);
  const hospital = buildHospital(scene, {
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  });
  const landscape = buildLandscape(scene, {
    forestTrees: phone ? 140 : 320,
    ridgeSegments: phone ? 96 : 160,
  });
  const sky = buildSky(scene, softCircle, { starCount: phone ? 150 : 350 });
  const winter = buildWinter(scene, softCircle, {
    snowCount: phone ? 220 : 600,
    steamPerRoom: phone ? 3 : 5,
  });
  // 테스트용 ?season=이 겨울이 아니면 눈과 김을 숨겨요. 값이 없으면 지금처럼 늘 보여요.
  const seasonOverride = parseSeasonOverride(window.location.search);
  if (seasonOverride !== null) winter.setVisible(seasonOverride === "winter");
  const lighting = createLighting(scene, {
    ceiling: room.ceiling,
    ceilingPanel: room.ceilingPanel,
    sleepLamp: room.sleepLamp,
    lampGlow: room.lampGlow,
    nurseLamp: facilities.nurseLamp,
    windowGlass: room.windowGlass,
    snowMaterial: winter.snowMaterial,
    steamMaterials: winter.steamMaterials,
    hospital,
    landscape,
    sky,
    setExposure: (exposure) => {
      renderer.toneMappingExposure = exposure;
    },
  });
  /** 캐릭터마다 머리 위에 떠 있는 작은 등불이에요. */
  const lanterns = createHeadLanterns(scene, softCircle);
  const nurseLanternPoint = new Vector3();
  const myLanternPoint = new Vector3();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  winter.setSnowAmount(snowFraction(quality, reduceMotion.matches));
  const savedProfile = loadProfile();
  const profile: Profile = savedProfile ?? defaultProfile(Math.random());
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
  remotes.setQuality(quality);
  lanterns.setRealLights(quality === "normal");
  /** 간판 별 반짝임과 빛 번짐은 보통 품질이고 움직임 줄이기가 아닐 때만 켜요. */
  const syncSignboard = (): void => hospital.signboard.setLively(quality === "normal" && !reduceMotion.matches);
  syncSignboard();
  /** 품질을 바꿔요. 안티에일리어싱만 빼고 바로 바뀌어요. */
  const applyQuality = (next: Quality): void => {
    quality = next;
    renderer.setPixelRatio(pixelRatioFor(quality, window.devicePixelRatio, phone));
    winter.setSnowAmount(snowFraction(quality, reduceMotion.matches));
    remotes.setQuality(quality);
    lanterns.setRealLights(quality === "normal");
    syncSignboard();
  };
  // 움직임 줄이기 설정을 바꾸면 눈의 양과 간판 반짝임도 바로 따라가요.
  reduceMotion.addEventListener("change", () => {
    winter.setSnowAmount(snowFraction(quality, reduceMotion.matches));
    syncSignboard();
  });
  const planters = createPlanters(scene);
  /** 내 침대 옆 작은 사과나무예요. 서버가 나에게만 알려 줄 때만 그려요. 다른 사람의 나무는 그릴 정보가 없어요. */
  const appleTree = createAppleTree(scene);
  /** 켜진 방명록 링크가 있는지와 사과 수예요. 나만 알아요. */
  let myTree: { active: boolean; count: number } | null = null;
  let ownerGuestbook: OwnerGuestbook | null = null;
  /** 아직 화면을 불러오는 중에 온 방명록이에요. 불러오면 바로 채워요. */
  let pendingGuestbook: GuestbookMessage | null = null;
  /** 방명록 화면은 처음 열 때 따로 불러와요. 방명록 링크 화면과 Three.js를 나눠 두려고요. */
  const openOwnerGuestbook = (): void => {
    if (ownerGuestbook) {
      ownerGuestbook.open();
      return;
    }
    const root = element("guestbook");
    if (!root) return;
    void import("./guestbook/owner-panel").then(({ createOwnerGuestbook }) => {
      ownerGuestbook ??= createOwnerGuestbook(root, {
        nickname: () => current.nickname,
        request: (action) => client.send({ type: "guestbook", action }),
        hide: (appleId) => client.send({ type: "hide-apple", appleId }),
        onClose: () => undefined,
      });
      if (pendingGuestbook) ownerGuestbook.update(pendingGuestbook);
      pendingGuestbook = null;
      ownerGuestbook.open();
    });
  };
  const morningWindows = createMorningWindows(scene);
  /** 테스트용 ?time=morning이면 이 화면에서만 모든 창문을 열어 둬요. 서버의 아침 판단은 그대로예요. */
  const morningPreview = parseTimeOverride(window.location.search) === "morning";
  const openMorningPreview = (): void => {
    if (morningPreview) ROOMS.forEach((_, roomIndex) => morningWindows.open(roomIndex, true));
  };
  openMorningPreview();
  /** ?debug=1일 때만 보이는 작은 연결 정보예요. */
  const debug = readDebugFlag(window.location.search) ? createDebugPanel() : null;
  debug?.setQuality(quality);
  const glows = createWarmGlows(scene, softCircle);
  /** 서버가 정한 병동 고양이 방문이에요. 병실 번호마다 하나예요. */
  const serverVisits = new Map<number, CatVisitPlan>();
  /** 서버에 닿지 않을 때 내 침대로 오는 방문이에요. 이 화면에서만 계산해요. */
  let localVisit: { room: number; plan: CatVisitPlan } | null = null;
  let lastLying: number | null = null;
  // 서버 시계는 아래에서 연결을 만든 뒤 이어 줘요.
  let serverNow = (): number => Date.now();
  /** 오잎클로버를 오늘 놓았는지예요. 서버가 알려 준 대로만 고쳐요. */
  const fiveLeaf = createFiveLeafMemory((() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })());
  const today = (): string => koreanDay(new Date(serverNow()));
  /** 자리에 없는 분께 오잎클로버를 남기는 중이면 true예요. left-saved가 오면 오늘 놓은 것으로 적어요. */
  let leavingFiveLeaf = false;
  let online = (): boolean => false;
  const cats = createCats(
    scene,
    player,
    {
      serverNow: () => serverNow(),
      isTaken: (bed) => player.claimedBed === bed || remotes.isBedTaken(bed),
      visitFor: (roomIndex) =>
        online() ? (serverVisits.get(roomIndex) ?? null) : localVisit?.room === roomIndex ? localVisit.plan : null,
      personAt: (id) => (online() && id !== myId ? remotes.position(id) : { x: player.walkX, z: player.walkZ }),
    },
    false,
  );
  /** 고양이와 놀기예요. 연결을 만든 뒤 이어 줘요. */
  let catFlow: CatPlayFlow | null = null;
  player.setLongPress((origin, reach) => catFlow?.longPress(origin, reach) ?? false);
  player.setTapFilter((origin, reach) => {
    if (catFlow?.tap(origin, reach)) return true;
    // 창가 화분을 누르면 이 병실에 모인 평안을 알려 줘요. 그 병실 안에 있을 때만이에요.
    const planterRoom = planters.tap(origin, reach);
    if (planterRoom !== null && roomAt(player.walkX, player.walkZ)?.index === planterRoom) {
      toast(planterText(planters.total(planterRoom)));
      return true;
    }
    // 다른 동물을 누르면 메뉴가 나와요. 서버에 닿아 있을 때만이에요.
    const guest = client.online ? remotes.tap(origin, reach) : null;
    if (!guest || !actionBar) return false;
    openPersonMenu(guest);
    return true;
  });
  /** 다른 동물 메뉴를 열어요. 그 동물을 누르거나, 그분의 침대를 눌렀을 때예요. */
  const openPersonMenu = (guest: Guest): void => {
    if (!actionBar) return;
    const where = remotes.position(guest.id) ?? { x: guest.x, z: guest.z };
    actionBar.openPerson({
      id: guest.id,
      nickname: guest.nickname,
      sleepingNote: remotes.isAsleep(guest.id) ? SLEEPING_PERSON_TEXT : null,
      hug: hugMenuState({
        online: client.online,
        leaving: dischargeUntil !== null,
        me: { x: player.walkX, z: player.walkZ },
        target: { x: where.x, z: where.z, hugOk: guest.hugOk },
        lastSentAt: hugSentAt.get(guest.id) ?? null,
        nowMs: Date.now(),
      }),
    });
  };

  let pickerShift: number | null = ENTRY_VIEW_SHIFT;
  let viewShift: number | null = null;
  /** 화면 너비에 대한 옆 비킴 비율이에요. 양수면 아바타가 오른쪽으로 가요. */
  let sideShift: number | null = null;
  const sideEntry = window.matchMedia(SIDE_ENTRY_QUERY);
  const entryPanel = document.querySelector<HTMLElement>("#entry");

  /** 넓은 화면에서 입장 패널이 열려 있으면 패널 오른쪽 끝의 절반만큼 비켜요. */
  const sideGoal = (width: number): number => {
    if (pickerShift !== ENTRY_VIEW_SHIFT || !sideEntry.matches) return 0;
    const right = entryPanel && !entryPanel.hidden ? entryPanel.getBoundingClientRect().right : 0;
    return (right > 0 ? right : SIDE_ENTRY_FALLBACK_PX) / 2 / width;
  };

  const ease = (from: number | null, goal: number, dt: number): number => {
    const eased =
      from === null || reduceMotion.matches ? goal : from + (goal - from) * (1 - Math.exp(-dt * VIEW_SHIFT_RATE));
    return Math.abs(eased - goal) < 0.001 ? goal : eased;
  };

  /** 지금 화면에 맞는 시선 자리로 옮겨요. 값이 그대로면 아무것도 하지 않아요. */
  const applyViewShift = (dt: number): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const rest = width < height ? PORTRAIT_VIEW_SHIFT : LANDSCAPE_VIEW_SHIFT;
    const side = sideGoal(width);
    const goal = pickerShift === ENTRY_VIEW_SHIFT && sideEntry.matches ? SIDE_ENTRY_VIEW_SHIFT : (pickerShift ?? rest);
    if (viewShift === goal && sideShift === side) return;
    viewShift = ease(viewShift, goal, dt);
    sideShift = ease(sideShift, side, dt);
    // setViewOffset이 투영 행렬까지 갱신해요. 탭 위치 계산도 같은 행렬을 쓰니 그대로 맞아요.
    camera.setViewOffset(width, height, -width * sideShift, -height * viewShift, width, height);
  };

  const stillMotion = (): boolean => reduceMotion.matches;
  const element = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`#${id}`);

  const labelsRoot = element("head-labels");
  const labels = labelsRoot ? createHeadLabels(labelsRoot) : null;
  let actionBar: ActionBar | null = null;
  let settings: Settings | null = null;
  let current = profile;
  let entered = false;

  const params = readWardParams(window.location.search, loadSeat(BED_COUNT));
  /** 방명록에서 [병실에 문병 가기]로 넘어온 토큰이에요. 링크를 미리 확인한 뒤에 입장 화면을 열어요. */
  const visitToken = takeVisitToken();
  /** 링크가 열려서 문병 온 주인의 닉네임이에요. 일반 입장이면 null이에요. */
  let visitOwner: string | null = null;
  /** 서버가 문병객으로 받아 준 동안 true예요. */
  let visitingNow = false;
  const hudMain = element("hud-main");
  const hudStats = element("hud-stats");
  /** count가 null이면 인원을 감춰요. solo면 서버에 닿지 않아 혼자 머무는 중이라고 알려요. */
  const setHud = (count: number | null, solo = false): void => {
    if (hudMain) hudMain.textContent = wardLabel(client.ward, client.instance, count, WARD_CAPACITY, solo);
  };
  /** 안아 주기를 이 화면에서 마지막으로 보낸 시각이에요. 같은 분께 10분에 한 번이에요. */
  const hugSentAt = new Map<string, number>();
  /** 오늘의 집계예요. 한국 날짜가 바뀌면 화면에서도 0부터 다시 세요. */
  let statsDay: string | null = null;
  const setStats = (stats: WardStats | null): void => {
    if (!hudStats) return;
    statsDay = stats ? koreanDay(new Date(serverNow())) : null;
    hudStats.textContent = stats ? statsLine(stats.visitors, stats.blessings) : "";
    hudStats.hidden = stats === null;
  };
  const noticeRoot = element("notice");
  const notice = noticeRoot ? createNotice(noticeRoot) : null;
  const toast = (text: string): void => actionBar?.showToast(text);
  const announcerRoot = element("announcer");
  const announcer = announcerRoot ? createAnnouncer(announcerRoot) : null;
  const momentsRoot = element("moments");
  const moments = momentsRoot ? createMoments(momentsRoot) : null;
  /** 퇴원하는 중이면 배웅을 모으는 끝 시각(서버 시각)이에요. */
  let dischargeUntil: number | null = null;
  let farewellsReceived = 0;
  /** 다가오는 사람을 마주 안을 때까지 남은 시간과 바라볼 곳이에요. */
  let hugBack: { left: number; face: { x: number; z: number } } | null = null;

  /** 두 동물이 안아요. 안아 주는 사람은 서버가 정한 자리로 다가가고, 안기는 사람은 다가오길 기다렸다가 마주 안아요. */
  const playHug = (event: Extract<WardEvent, { kind: "hug" }>): void => {
    const positionOf = (id: string): { x: number; z: number } | null =>
      id === myId ? { x: player.walkX, z: player.walkZ } : remotes.position(id);
    const a = positionOf(event.a);
    const b = positionOf(event.b);
    if (!a || !b) return;
    const spot = hugSpot(a, { ...b, bed: event.bed });
    const low = event.bed !== null;
    const face = low ? BEDS[event.bed as number] : b;
    const travel = Math.hypot(spot.x - a.x, spot.z - a.z) / HUG_WALK_SPEED;
    // 벤치에 앉아 있던 안기는 사람은 일어나서 기다려요. 서버는 이미 자리를 비웠어요.
    if (event.b === myId) player.leaveSeat();
    if (event.a === myId) {
      player.whenUp(() =>
        player.walkToSpot(spot.x, spot.z, () => {
          player.faceToward(face.x, face.z);
          player.playGesture(low ? "hug-low" : "hug");
        }),
      );
    } else {
      remotes.hugTo(event.a, spot, face, low);
    }
    if (!low) {
      if (event.b === myId) hugBack = { left: travel, face: spot };
      else remotes.hugBack(event.b, spot, travel);
    }
    const glowAt = low
      ? bedHeadSpot(BEDS[event.bed as number])
      : { x: (spot.x + b.x) / 2, y: HUG_GLOW_HEIGHT, z: (spot.z + b.z) / 2 };
    glows.show(glowAt, travel + BED_TRANSITION_SECONDS * 0.5);
  };

  /** 퇴원하는 분께 평안을 보내요. 평안 빌기와 같은 동작이고, 서버가 배웅으로 세요. */
  const sendFarewell = (id: string): void => {
    player.whenUp(() => {
      const head = remotes.headSpot(id);
      if (head) player.faceToward(head.x, head.z);
      player.playGesture("pray");
      client.send({ type: "bless", targetId: id });
      window.setTimeout(() => {
        const to = remotes.headSpot(id) ?? head;
        if (to) offerings.sendLight(player.handSpot(), to, stillMotion());
      }, LIGHT_DELAY_SECONDS * 1000);
    });
  };

  /** 퇴원을 받아 줬어요. 환자복을 벗고 문 쪽으로 천천히 걸어 나가요. */
  const beginDischarge = (until: number): void => {
    dischargeUntil = until;
    farewellsReceived = 0;
    sleep?.wake();
    actionBar?.setHidden(true);
    const settingsRoot = element("settings");
    if (settingsRoot) settingsRoot.hidden = true;
    const bed = player.claimedBed;
    const room = roomAt(player.walkX, player.walkZ) ?? (bed !== null ? ROOMS[BEDS[bed].roomIndex] : null);
    // 저장하지 않고 이번에만 문병객 모습이에요. 다음에 들어올 때는 원래 옷이에요.
    player.setChoice({ species: current.species, outfit: "visitor" });
    player.setInputEnabled(false);
    notice?.show("오늘 퇴원해요. 평안히 다녀가세요.", 5);
    if (!room) return;
    const door = doorSpots(room);
    player.whenUp(() =>
      player.walkToSpot(door.inside.x, door.inside.z, () => player.walkToSpot(door.outside.x, door.outside.z, () => {}, true), true),
    );
  };
  let warnedOffline = false;

  const cardsRoot = element("left-cards");
  const inboxRoot = element("inbox");
  const blessingCards = cardsRoot && inboxRoot ? createBlessingCards(cardsRoot, inboxRoot) : null;

  /** 오늘 같은 병실에서 만난 사람들이에요. 평안 주소와 닉네임, 동물만 이 브라우저에 둬요. */
  let metList: MetList = loadMetList(koreanDay(new Date()));
  const remember = (guests: readonly Guest[], me: string): void => {
    const today = koreanDay(new Date());
    for (const guest of guests) {
      if (guest.id === me) continue;
      metList = rememberPerson(metList, { address: guest.address, nickname: guest.nickname, animal: guest.animal }, today);
    }
    saveMetList(metList);
  };
  let myId = "";
  /** 침대를 받으면 서버가 남겨진 평안을 바로 보내 줘요. 걸어가서 다 누웠을 때 보여 줘요. */
  let pendingLeft: { bedId: number; cards: BlessingCardMessage[]; at: number } | null = null;

  const gateRoot = element("gate");
  const gate = gateRoot ? createGate(gateRoot) : null;
  const banner = element("connection-banner");
  if (banner) followTopStack(banner);
  const setBanner = (text: string | null, action?: { label: string; run: () => void }): void => {
    if (!banner) return;
    banner.textContent = text ?? "";
    if (text !== null && action) banner.append(createButton(action.label, action.run));
    banner.hidden = text === null;
  };
  /** 화면이 예전 번들이에요. 새로고침하면 새 버전을 받아요(index.html은 매번 다시 확인해요). */
  const showOutdated = (): void => {
    setBanner("새 버전이 나왔어요. 새로고침해 주세요.", { label: "새로고침", run: () => window.location.reload() });
  };
  // 들어가기 전에 서버 버전을 먼저 견줘요. 예전 번들을 캐시로 쓰고 있으면 바로 알려요.
  const serverVersion = readVersion(health);
  if (serverVersion !== null && serverVersion !== PROTOCOL_VERSION) showOutdated();

  const client = createWardClient(params, {
    onSnapshot(snapshot, reconnected) {
      myId = snapshot.you;
      debug?.setPublicId(snapshot.you);
      debug?.setPlace(client.ward, client.instance);
      visitingNow = snapshot.visit !== null;
      if (snapshot.visit && !snapshot.restored) {
        // 주인 침대 곁에서 바로 시작해요. 서버가 정한 자리예요.
        const me = snapshot.guests.find((guest) => guest.id === snapshot.you);
        const bed = BEDS[snapshot.visit.bed];
        if (me && bed) player.placeAt(me.x, me.z, bed.x, bed.z);
        const owner = snapshot.visit.ownerNickname;
        notice?.show(
          snapshot.visit.ownerPresent
            ? `${owner}님 곁에 왔어요.`
            : `${owner}님은 지금 자리에 없어요. 남긴 평안과 선물은 돌아오시면 전해져요.`,
        );
      }
      remotes.reset(snapshot.guests, snapshot.you);
      catFlow?.reset(snapshot.catPlays, snapshot.catRests);
      remember(snapshot.guests, snapshot.you);
      // 내가 없는 동안 도착한 평안이 있으면 들어오자마자 보여 줘요.
      blessingCards?.showInbox(snapshot.inbox, client.serverNow());
      // 받았다고 알려야 서버가 지워요. 그 전에 끊기면 다음에 들어올 때 다시 받아요.
      const ackUpTo = inboxAckUpTo(snapshot.inbox);
      if (ackUpTo !== null) client.send({ type: "inbox-ack", upTo: ackUpTo });
      offerings.loadGifts(snapshot.gifts);
      offerings.setLamps(snapshot.lamps);
      serverVisits.clear();
      for (const visit of snapshot.catVisits) serverVisits.set(visit.room, { bed: visit.bed, at: visit.at, until: null });
      setHud(remotes.count + 1);
      setStats(snapshot.stats);
      planters.setTotals(snapshot.planters);
      morningWindows.closeAll(true);
      for (const roomIndex of snapshot.morningRooms) morningWindows.open(roomIndex, true);
      openMorningPreview();
      // 자주 온 분이면 병동 고양이가 문 앞으로 나와 반겨요. 이 화면에서만 보여요.
      if (snapshot.greet) cats.welcome({ x: player.walkX, z: player.walkZ });
      if (snapshot.welcomeBack) notice?.show(WELCOME_BACK_TEXT, 5);
      if (snapshot.fiveLeafUsed === true) fiveLeaf.mark(today());
      else if (snapshot.fiveLeafUsed === false) fiveLeaf.clear();
      // 다시 이어졌으면 지금 잠들어 있는지를 서버에 다시 알려요. 같으면 서버는 아무것도 하지 않아요.
      client.send({ type: "sleep", sleeping: sleep?.sleeping ?? false });
      setBanner(null);
      warnedOffline = false;
      // 서버 시계를 받았으니 다음 시간대 바뀜도 다시 계산해요.
      refreshSlot(false);
      // 서버가 기억하는 내 자리와 이 화면의 자리가 다를 때만 맞춰요. 30초 안에 돌아왔으면 대개 같아요.
      const me = snapshot.guests.find((guest) => guest.id === snapshot.you);
      // 내 침대는 서버가 정해요. 30초 안에 돌아왔거나 예전 자리가 비어 있었으면 같은 침대예요.
      const hadBed = player.ownedBed;
      const serverBed = snapshot.visit ? null : (me?.bed ?? null);
      player.setOwnedBed(serverBed);
      if (reconnected && hadBed !== null && serverBed !== hadBed) toast(BED_LOST_TEXT);
      // 누운 자세만 맞춰요. 내 침대에 누워 있는데 서버는 모르면 다시 눕겠다고 알려요.
      const bed = player.claimedBed;
      if (bed !== null && !me?.lying) {
        void client.askBed(bed).then((granted) => {
          if (!granted) player.forceGetUp();
        });
      } else if (bed === null && me?.lying) {
        client.send({ type: "get-up" });
      }
      // 벤치 자리도 맞춰요. 내가 앉아 있는데 서버는 모르면 다시 앉겠다고 하고, 안 되면 일어나요.
      const seat = player.seat;
      const serverSeat = me?.bench ?? null;
      if (seat !== null && serverSeat !== seat) {
        void client.askSeat(seat).then((granted) => {
          if (!granted) player.leaveSeat();
        });
      } else if (seat === null && serverSeat !== null) {
        client.send({ type: "stand" });
      }
      if (bed === null && seat === null && me && Math.hypot(me.x - player.walkX, me.z - player.walkZ) > 0.3) {
        client.send({ type: "walk-to", x: player.walkX, z: player.walkZ });
      }
    },
    onEvent(event: WardEvent) {
      announce(event);
      if (event.kind === "gift") {
        if (event.id === myId && event.gift.item === FIVE_LEAF_ITEM) fiveLeaf.mark(today());
        const from = remotes.handSpot(event.id) ?? player.handSpot();
        // 잠든 동안 내 머리맡에 온 선물은 날아오지 않고 조용히 놓여 있어요. 깨어나면 숫자로 알려 줘요.
        const quiet = (sleep?.sleeping ?? false) && event.gift.stand === player.claimedBed;
        offerings.placeGift(from, event.gift.stand, event.gift.slot, event.gift.item, stillMotion() || quiet);
        return;
      }
      if (event.kind === "lamp") {
        offerings.setLampCount(event.room, event.count);
        if (event.id === myId) {
          // 내가 놓은 불빛이에요. 손에서 창틀로 빛이 날아가고 안내가 떠요. 창틀이 화면 밖이어도 알 수 있어요.
          if (player.lyingBed === null) player.playGesture("pray");
          const spot = windowLampSpot(ROOMS[event.room], lampSlotPosition(Math.max(0, event.count - 1)));
          window.setTimeout(() => offerings.sendLight(player.handSpot(), spot, stillMotion()), LIGHT_DELAY_SECONDS * 1000);
          toast(lampPlacedText(event.count));
        }
        return;
      }
      if (event.kind === "stats") {
        setStats(event.stats);
        return;
      }
      if (event.kind === "planter") {
        planters.setTotal(event.room, event.total);
        return;
      }
      if (event.kind === "window-open") {
        morningWindows.open(event.room, reduceMotion.matches);
        return;
      }
      if (event.kind === "hug") {
        playHug(event);
        return;
      }
      if (event.kind === "discharge") {
        const guest = remotes.guests().find((candidate) => candidate.id === event.id);
        if (guest && dischargeUntil === null) {
          moments?.farewell(event.id, dischargeNoticeText(guest.nickname), () => sendFarewell(event.id));
        }
        return;
      }
      if (event.kind === "leave") moments?.dismissFarewell(event.id);
      if (event.kind === "cat-play") {
        catFlow?.onPlay(event.play);
        return;
      }
      if (event.kind === "cat-rest") {
        catFlow?.onRest(event.catId, event.until);
        return;
      }
      if (event.kind === "cat-wake") {
        catFlow?.onWake(event.catId, event.until);
        return;
      }
      if (event.kind === "cat-visit") {
        const before = serverVisits.get(event.room);
        if (event.visit) {
          serverVisits.set(event.room, { bed: event.visit.bed, at: event.visit.at, until: null });
        } else if (before && before.at <= event.changedAt) {
          // 이미 찾아간 고양이는 그 시각부터 내려와 원래 길로 돌아가요.
          serverVisits.set(event.room, { ...before, until: event.changedAt });
        } else {
          serverVisits.delete(event.room);
        }
        return;
      }
      remotes.apply(event);
      if (event.kind === "join" || event.kind === "update") remember([event.guest], myId);
      // update로 새로 그린 사람도 있을 수 있어서 함께 세요.
      if (event.kind === "join" || event.kind === "leave" || event.kind === "update") setHud(remotes.count + 1);
    },
    onCorrected(x, z) {
      player.correctDestination(x, z);
    },
    onNicknameRejected(problem) {
      reopenEntry(nicknameMessage(problem));
    },
    onDenied(denied) {
      if (denied.action === "cat" && catFlow?.onDenied(denied.reason)) return;
      if (denied.action === "discharge") {
        toast("내 침대를 고른 뒤 퇴원할 수 있어요.");
        return;
      }
      if (denied.action === "hug" && denied.reason in HUG_DENIED_TEXT) {
        toast(HUG_DENIED_TEXT[denied.reason as HugDenied]);
        return;
      }
      if (denied.action === "gift") leavingFiveLeaf = false;
      if (denied.reason === "gift-limit" && denied.item === FIVE_LEAF_ITEM) {
        fiveLeaf.mark(today());
        toast("오잎클로버는 내일 다시 놓을 수 있어요.");
        return;
      }
      toast(DENIED_TEXT[denied.reason]);
    },
    onLeftBlessings(message) {
      pendingLeft = { bedId: message.bedId, cards: message.cards, at: performance.now() };
    },
    onLeftSaved() {
      if (leavingFiveLeaf) fiveLeaf.mark(today());
      leavingFiveLeaf = false;
      toast("남겨두었어요. 다음에 들어오시면 전해져요.");
    },
    onKeptQuiet() {
      toast(KEPT_QUIET_TEXT);
    },
    onSleptSummary(people, gifts) {
      notice?.show(sleptSummaryText(people, gifts), 8);
    },
    onVisitDenied(reason) {
      if (reason === "busy") {
        // 들어가지 않았어요. 입장 화면에서 조금 뒤에 다시 눌러 들어올 수 있어요.
        reopenEntry(VISIT_BUSY_TEXT);
        return;
      }
      // 링크가 그사이 꺼졌어요. 서버는 일반 입장으로 이어 줬어요.
      forgetVisitToken();
      visitOwner = null;
      notice?.show(VISIT_CLOSED_TEXT, 8);
    },
    onGuestbook(message) {
      myTree = { active: message.active, count: message.count };
      appleTree.setTree(myTree);
      if (ownerGuestbook) ownerGuestbook.update(message);
      else pendingGuestbook = message;
    },
    onMyTree(tree) {
      myTree = tree;
      appleTree.setTree(tree);
    },
    onVisitorArrived(nickname) {
      notice?.show(visitorArrivedText(nickname));
    },
    onNicknameReset(nickname) {
      // 운영자가 되돌린 닉네임이에요. 이 기기에도 자동 닉네임으로 저장해요.
      const next = { ...current, nickname, nicknameAuto: true };
      persist(next);
      applyProfile(next);
      settings?.setProfile(next);
      toast(`닉네임이 '${nickname}'(으)로 바뀌었어요.`);
    },
    onHugOffer(requestId, fromId) {
      const from = remotes.guests().find((guest) => guest.id === fromId);
      if (!from || dischargeUntil !== null) return;
      moments?.hugOffer(hugOfferText(from.nickname), (accept) => client.send({ type: "hug-answer", requestId, accept }));
    },
    onHugDeclined() {
      toast(HUG_DECLINED_TEXT);
    },
    onDischargeStarted(until) {
      beginDischarge(until);
    },
    onFarewellCount(count) {
      farewellsReceived = count;
    },
    onCatBusy(nickname, scene) {
      catFlow?.onBusy(nickname, scene);
    },
    onCatPetted(nickname) {
      catFlow?.onPetted(nickname);
    },
    onMessageType(kind) {
      debug?.setLastMessage(kind);
    },
    onStatus(status, instance) {
      debug?.setStatus(status);
      debug?.setPlace(client.ward, instance);
      if (status === "online" || status === "connecting") {
        if (status === "online") gate?.hide();
        return;
      }
      if (status === "paused" || status === "rested") {
        // 잠든 지 8시간이 지나 서버가 쉬게 했으면 수면 모드도 끝내요. 누르면 다시 이어요.
        if (status === "rested") sleep?.wake();
        setHud(null);
        setStats(null);
        remotes.reset([], "");
        setBanner(null);
        gate?.show(status === "rested" ? SLEPT_LONG_TEXT : "잠들었어요. 화면을 누르면 다시 병실로 돌아가요");
        return;
      }
      if (status === "blocked" || status === "limited") {
        setHud(null);
        setStats(null);
        remotes.reset([], "");
        setBanner(null);
        gate?.show("지금은 들어올 수 없어요", status === "limited" ? "잠시 뒤에 다시 와 주세요." : undefined);
        return;
      }
      if (status === "reconnecting") {
        // 다른 사람과 고양이는 그대로 두고 기다려요. 다시 이어지면 snapshot으로 맞춰요.
        setBanner("연결이 잠시 끊겼어요. 다시 이어지는 중이에요.");
        return;
      }
      setHud(null, status !== "outdated");
      setStats(null);
      remotes.reset([], "");
      if (status === "outdated") {
        showOutdated();
      } else if (status === "replaced") {
        toast("다른 창에서 병동에 들어와서 이 창은 쉬어요.");
      } else if (status === "full") {
        toast("병동이 모두 차서 혼자 머물러요.");
      } else if (status === "offline" && !warnedOffline) {
        warnedOffline = true;
        toast("병동 서버에 닿지 않아 혼자 머물러요. 다시 이어 볼게요.");
      }
    },
  });

  serverNow = () => client.serverNow();
  catFlow = createCatPlayFlow({
    cats,
    remotes,
    player,
    online: () => client.online,
    myId: () => myId,
    myNickname: () => current.nickname,
    serverNow: () => serverNow(),
    send: (catId, kind) => client.send({ type: "cat-play", catId, kind }),
    openMenu: (menu) => actionBar?.openCat(menu),
    toast: (text) => toast(text),
    leaving: () => dischargeUntil !== null,
  });
  remotes.setYarnSource((roomIndex) => cats.yarnIn(roomIndex));
  online = () => client.online;

  /** 나에게 온 평안과 선물, 같은 병실의 한마디를 화면 낭독기가 읽게 해요. 화면 모습은 그대로예요. */
  function announce(event: WardEvent): void {
    if (!announcer || !myId) return;
    if (event.kind !== "bless" && event.kind !== "gift" && event.kind !== "bow") return;
    if (event.id === myId) return;
    // 잠든 동안에는 읽지 않아요. 깨어나면 한 번에 알려 줘요.
    if (sleep?.sleeping) return;
    const nickname = remotes.guests().find((guest) => guest.id === event.id)?.nickname;
    if (!nickname) return;
    const myBed = player.claimedBed;
    if (event.kind === "bless") {
      if (event.targetId === myId || (event.bedId !== null && event.bedId === myBed)) announcer.say(blessedMeText(nickname));
      return;
    }
    if (event.kind === "gift") {
      const gift = giftName(event.gift.item);
      if (gift && event.gift.stand === myBed) announcer.say(giftForMeText(nickname, gift));
      return;
    }
    const phrase = blessingText(event.phrase);
    const where = remotes.position(event.id);
    const theirRoom = where ? (roomAt(where.x, where.z)?.index ?? null) : null;
    const myRoom = roomAt(player.walkX, player.walkZ)?.index ?? null;
    if (phrase && theirRoom !== null && theirRoom === myRoom) announcer.say(bowText(nickname, phrase));
  }
  setHud(null);

  player.setNet({
    askBed: (bed) => client.askBed(bed),
    claimBed: (bed) => client.claimBed(bed),
    isBedTaken: (bed) => client.online && remotes.ownerOfBed(bed) !== null,
    othersBed: (bed) => {
      // 다른 분의 침대예요. 눕지 않고 그분 메뉴를 보여 줘요. 내 침대가 없으면 고를 수 있는 곳도 알려요.
      const owner = remotes.ownerOfBed(bed);
      if (owner) openPersonMenu(owner);
      const guide = currentBedGuide();
      if (guide && guide.kind !== "pick-here") toast(bedGuideText(guide));
      else if (!owner) toast("다른 분의 침대예요.");
    },
    walkTo: (x, z) => client.send({ type: "walk-to", x, z }),
    getUp: () => client.send({ type: "get-up" }),
    bedRefused: (moving) => {
      const guide = moving ? null : currentBedGuide();
      const hint = guide && guide.kind !== "pick-here" ? ` ${bedGuideText(guide)}` : "";
      toast((moving ? BED_MOVE_TAKEN_TEXT : BED_CLAIM_TAKEN_TEXT) + hint);
    },
    askSeat: (seat) => client.askSeat(seat),
    isSeatTaken: (seat) => client.online && remotes.isSeatTaken(seat),
    standUp: () => client.send({ type: "stand" }),
    seatRefused: (full) => toast(full ? BENCH_FULL_TEXT : SEAT_TAKEN_TEXT),
  });
  player.setClaimConfirm((_bed, proceed) => {
    if (actionBar) actionBar.confirmClaim(proceed);
    else proceed();
  });
  player.setMoveConfirm((_bed, proceed) => {
    if (actionBar) actionBar.confirmMove(proceed);
    else proceed();
  });

  // 병아리 간호사 모두 현관으로 들어서는 분께 인사해요. 내 화면에서만 보여요.
  const nurseGreetings = facilities.nurses.map((nurse) => {
    const root = document.createElement("div");
    remoteLabels?.append(root);
    return { nurse, label: createHeadLabels(root), point: new Vector3() };
  });
  const nextGreeting = createNurseGreeter({ getItem: readStorage, setItem: writeStorage });
  player.setLobbyListener(() => {
    if (!entered || nurseGreetings.length === 0) return;
    const text = nextGreeting();
    for (const { nurse, label } of nurseGreetings) {
      nurse.bow(reduceMotion.matches);
      label.showBubble(text);
    }
    announcer?.say(`간호사들이 "${text}" 하고 인사했어요.`);
  });

  /** 내 침대가 없는 환자에게 침대 고르는 법을 알려 줄지예요. 침대가 다 차도 병동에는 머물 수 있어요. */
  const currentBedGuide = () =>
    entered && !visitingNow && dischargeUntil === null
      ? bedGuide(
          {
            canLie: current.outfit === "patient",
            ownedBed: player.ownedBed,
            myRoom: roomAt(player.walkX, player.walkZ)?.index ?? null,
          },
          (bed) => client.online && remotes.ownerOfBed(bed) !== null,
        )
      : null;
  /** 안내는 병실에 들어설 때마다 한 번이에요. */
  let guidedRoom: number | null = null;
  /** 이 브라우저에 마지막으로 적어 둔 내 침대예요. undefined면 아직 적지 않았어요. */
  let savedSeat: number | null | undefined;

  const platesRoot = element("bed-plates");
  const plates = platesRoot ? createBedPlatesView(platesRoot) : null;

  const applyProfile = (next: Profile): void => {
    current = next;
    player.setChoice({ species: next.species, outfit: next.outfit });
    cats.setCompanion(next.withCat);
    labels?.setName(next.nickname);
  };

  /** 문병객으로 고른 옷차림은 저장하지 않아요. 다음에 일반으로 들어올 때는 원래 옷이에요. */
  const persist = (next: Profile): void => {
    saveProfile(visitOwner ? { ...next, outfit: profile.outfit } : next);
  };

  let enteredAt: number | null = null;
  const enterWard = (chosen: Profile): void => {
    enteredAt ??= performance.now();
    persist(chosen);
    applyProfile(chosen);
    pickerShift = null;
    player.setFacingCamera(false);
    player.setInputEnabled(true);
    client.hello(chosen);
    if (entered) return;
    entered = true;

    const settingsRoot = element("settings");
    if (settingsRoot) {
      settings = createSettings(settingsRoot, {
        initial: chosen,
        canUsePersonalActions: () => {
          if (client.online && !visitingNow && dischargeUntil === null) return true;
          toast("병동에 연결된 뒤 이용할 수 있어요.");
          return false;
        },
        onOpenGuestbook: openOwnerGuestbook,
        onDischarge: () => actionBar?.openDischarge(),
        view,
        onViewChange: (next) => {
          const choiceChanged = next.quality !== view.quality;
          view = { ...next, lastAuto: view.lastAuto };
          saveViewPrefs(view);
          applyLargeText(view.largeText);
          if (choiceChanged && qualityOverride === null) {
            applyQuality(view.quality === "auto" ? (view.lastAuto ?? "normal") : view.quality);
            debug?.setQuality(quality);
          }
        },
        onChange: (next) => {
          persist(next);
          applyProfile(next);
          client.hello(next);
        },
        // 설정에는 모습 고르기가 없어서 카메라를 옮기지 않아요.
        onOpenChange: () => undefined,
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
        visiting: () => visitingNow,
        guestbookActive: () => myTree?.active ?? false,
        people: () =>
          client.online
            ? metList.people.map((person) => {
                const id = remotes.idForAddress(person.address);
                const head = id ? remotes.headSpot(id) : null;
                return {
                  address: person.address,
                  nickname: person.nickname,
                  present: id && head ? { id, head, bed: remotes.bedOf(id) } : null,
                };
              })
            : [],
        sink: {
          online: () => client.online,
          blessPerson: (targetId) => client.send({ type: "bless", targetId }),
          leaveFor: (address, kind, item) => {
            leavingFiveLeaf = item === FIVE_LEAF_ITEM;
            client.send(item === undefined ? { type: "leave-for", address, kind } : { type: "leave-for", address, kind, item });
          },
          bless: (bedId) => client.send({ type: "bless", bedId }),
          bow: (phrase) => client.send({ type: "bow", phrase }),
          gift: (bedId, item) => client.send({ type: "gift", bedId, item }),
          lamp: () => client.send({ type: "lamp" }),
          hug: (targetId) => {
            hugSentAt.set(targetId, Date.now());
            client.send({ type: "hug-request", targetId });
          },
          discharge: (closeLink) => client.send({ type: "discharge", closeLink }),
        },
        morning: () => isMorningWindow(serverNow()),
        fiveLeafUsed: () => fiveLeaf.used(today()),
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
      ...visitEntry(),
    });
  };

  /** 방명록 링크로 왔으면 제목이 바뀌고 옷은 문병객 모습이에요. */
  const visitEntry = (): { title?: string; lockOutfit?: "visitor" } =>
    visitOwner ? { title: visitTitle(visitOwner), lockOutfit: "visitor" } : {};

  const openFirstEntry = (message?: string): void => {
    if (entryRoot) {
      player.setFacingCamera(true);
      player.setInputEnabled(false);
      createEntryScreen(entryRoot, {
        initial: profile,
        onPreview: applyProfile,
        onEnter: enterWard,
        message,
        // 이 기기에 저장된 모습과 서버가 준 토큰이 함께 있으면 같은 분이 돌아온 거예요.
        returning: savedProfile !== null && loadGuestToken() !== null,
        ...visitEntry(),
      });
      if (!storageWorks()) notice?.show(NO_STORAGE_TEXT, 8);
    } else {
      enterWard(profile);
    }
  };

  if (visitToken) {
    // 링크를 먼저 확인해요. 열리면 주인이 있는 병동으로 가고, 아니면 일반 입장으로 안내해요.
    void fetchGuestbook(visitToken).then((preview) => {
      if (preview?.open) {
        visitOwner = preview.ownerNickname;
        client.setVisit({ token: visitToken, ward: preview.ward, instance: preview.instance });
        setHud(null);
        openFirstEntry();
        return;
      }
      // 서버에 닿지 않았을 때는 다음에 다시 확인하려고 토큰을 남겨 둬요.
      if (preview) forgetVisitToken();
      openFirstEntry(preview ? VISIT_CLOSED_TEXT : undefined);
    });
  } else {
    openFirstEntry();
  }

  /** 화면에 보이는 시각이에요. 서버 시계에 테스트용 ?clockShift(분)만큼 더해요. 병동 고양이는 이 값을 쓰지 않아요. */
  const clockShiftMs = readClockShiftMs(window.location.search);
  const displayNow = (): number => serverNow() + clockShiftMs;
  const readSlot = () => currentSlot(new Date(displayNow()), window.location.search);
  let slot = readSlot();
  let nextChangeAt = nextSlotChange(displayNow());
  lighting.setSlot(slot, true);
  lanterns.setSlot(slot);
  hospital.signboard.setLit(signLitFor(slot), true);

  /** 지금 누워 있는 사람 수예요. 나도 포함해요. */
  const sleepers = (): number => remotes.lyingCount() + (player.lyingBed !== null ? 1 : 0);

  /** 시간대가 바뀌었으면 조명을 바꾸고, 소등이 되는 순간이면 안내해요. */
  function refreshSlot(announce: boolean): void {
    nextChangeAt = nextSlotChange(displayNow());
    const next = readSlot();
    if (next === slot) return;
    slot = next;
    lighting.setSlot(slot, reduceMotion.matches || !announce);
    lanterns.setSlot(slot);
    hospital.signboard.setLit(signLitFor(slot), reduceMotion.matches || !announce);
    if (announce && slot === "night" && entered) notice?.show(lightsOutText(sleepers()));
  }

  // 함께한 밤이에요. 밤(22시~6시)에 1분 넘게 머물면 그 밤을 한 번 세요. 줄지 않아요.
  let nights: NightRecord = parseNightRecord(readStorage(NIGHTS_KEY));
  /** 이번 밤에 머물기 시작한 실제 시각이에요. 느린 기기에서도 1분을 바르게 재려고 화면 시간 대신 써요. */
  let nightSince: number | null = null;
  let stayingNight: string | null = null;
  let greeted = false;

  // 오래 누르지 않으면 연결을 잠시 닫아요. 수면 모드에서는 닫지 않아요.
  let lastInputMs = Date.now();
  const noteInput = (): void => {
    lastInputMs = Date.now();
    if (client.paused) client.resume();
  };
  for (const type of ["pointerdown", "keydown", "wheel"] as const) {
    window.addEventListener(type, noteInput, { capture: true, passive: true });
  }

  const sleepRoot = element("sleep-root");
  const sleepOverlay = element("sleep-overlay");
  const sleep =
    sleepRoot && sleepOverlay
      ? createSleepMode({
          buttonRoot: sleepRoot,
          overlay: sleepOverlay,
          onChange: (sleeping) => {
            // 카메라는 내 침대를 비추는 자리에 고정해요. 내 모습도 남들이 보는 것처럼 눈을 감고 이불을 덮어요.
            player.setCameraLocked(sleeping);
            player.setAsleep(sleeping);
            labels?.setAsleep(sleeping);
            player.setInputEnabled(!sleeping);
            lastInputMs = Date.now();
            // 서버가 같은 병동 사람들에게 한 번 알려요. 잠든 동안 안아 주기·목례·한마디는 오지 않고, 평안은 쌓여요.
            client.send({ type: "sleep", sleeping });
          },
        })
      : null;
  let sleepWaitMs = 0;
  let lastTickMs: number | null = null;

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
    sideShift = null;
    applyViewShift(0);
  };
  window.addEventListener("resize", resize);
  resize();

  /** 1초마다 한 번씩 살피는 것들이에요. */
  function tickEverySecond(): void {
    const now = displayNow();
    // 입장한 뒤 서버 소식을 받으면(또는 3초 뒤 혼자 쓰는 화면이면) 밤 인사를 한 번 해요.
    if (entered && !greeted && (client.online || (enteredAt !== null && performance.now() - enteredAt > 3000))) {
      greeted = true;
      const night = nightKey(now);
      if (night) notice?.show(lightsOutText(sleepers()));
      const text = nightsText(nights, night);
      if (text) notice?.show(text, 4);
    }
    // 밤에 1분 넘게 머물면 그 밤을 세요.
    const night = entered ? nightKey(now) : null;
    if (night !== stayingNight) {
      stayingNight = night;
      nightSince = Date.now();
    }
    if (night && nights.lastNight !== night && nightSince !== null) {
      if (Date.now() - nightSince >= NIGHT_STAY_MS) {
        nights = countNight(nights, night);
        writeStorage(NIGHTS_KEY, JSON.stringify(nights));
      }
    }
    // 한국 날짜가 바뀌면 오늘의 집계를 0부터 다시 세요.
    if (statsDay && statsDay !== koreanDay(new Date(serverNow()))) {
      setStats({ visitors: 0, blessings: 0, lamps: 0 });
    }
    if (entered && client.online && dischargeUntil === null && shouldPause(lastInputMs, Date.now(), sleep?.sleeping ?? false)) {
      client.pause();
    }
    // 아침(09:00)이 지나면 열린 창문을 조용히 닫아요.
    if (!morningPreview && !isMorningWindow(serverNow())) morningWindows.closeAll(reduceMotion.matches);
    // 1분 동안 받은 배웅을 모아 카드로 보여 주고 입장 화면으로 돌아가요.
    if (dischargeUntil !== null && serverNow() >= dischargeUntil) {
      dischargeUntil = Infinity;
      moments?.farewellCard(farewellCardText(farewellsReceived), () => {
        client.leave();
        window.location.reload();
      });
    }
  }

  const headPoint = new Vector3();
  let lastMs: number | null = null;
  /** 자동이면 처음 5초 동안 프레임 속도를 재요. 수면 모드와 숨겨진 탭은 세지 않아요. */
  const probe = qualityChoice() === "auto" ? createFpsProbe() : null;

  const frame = (timeMs: number): void => {
    const rawDt = lastMs === null ? 0 : (timeMs - lastMs) / 1000;
    lastMs = timeMs;
    if (probe && !sleep?.sleeping) {
      const fps = probe.add(rawDt);
      if (fps !== null && qualityChoice() === "auto") {
        const judged = judgeQuality(fps, hints, quality);
        view = { ...view, lastAuto: judged };
        saveViewPrefs(view);
        if (judged !== quality) applyQuality(judged);
        debug?.setQuality(`${quality} · ${Math.round(fps)}fps`);
      }
    }
    let dt = Math.min(MAX_FRAME_SECONDS, rawDt);
    if (sleep?.sleeping) {
      sleepWaitMs += rawDt;
      if (sleepWaitMs < SLEEP_FRAME_SECONDS) return;
      dt = Math.min(SLEEP_MAX_FRAME_SECONDS, sleepWaitMs);
      sleepWaitMs = 0;
    }

    // 소등은 다음 바뀜 시각과 견주기만 해요. 매 프레임 시계를 해석하지 않아요.
    if (displayNow() >= nextChangeAt) refreshSlot(true);

    // 1초마다 실제 시계로 살펴요. 프레임이 느려도 늦어지지 않아요.
    if (lastTickMs === null || timeMs - lastTickMs >= 1000) {
      lastTickMs = timeMs;
      tickEverySecond();
    }

    applyViewShift(dt);
    player.update(dt);
    remotes.update(dt, { x: player.x, z: player.z }, camera, reduceMotion.matches);
    // 서버에 닿지 않을 때는 내 침대로 오는 고양이를 이 화면에서 정해요.
    const lying = player.lyingBed;
    if (lying !== lastLying) {
      const now = serverNow();
      if (lying !== null) {
        localVisit = { room: BEDS[lying].roomIndex, plan: { bed: lying, at: now + CAT_VISIT_AFTER_MS, until: null } };
      } else if (localVisit) {
        localVisit = { ...localVisit, plan: { ...localVisit.plan, until: now } };
      }
      lastLying = lying;
    }
    cats.update(dt, reduceMotion.matches);
    offerings.update(dt, reduceMotion.matches);
    planters.update(dt, reduceMotion.matches);
    appleTree.setBed(visitingNow ? null : player.lyingBed);
    morningWindows.update(dt, reduceMotion.matches);
    glows.update(dt, reduceMotion.matches);
    moments?.update(dt);
    if (hugBack) {
      hugBack.left -= dt;
      if (hugBack.left <= 0) {
        if (player.lyingBed === null && !player.seated) {
          player.faceToward(hugBack.face.x, hugBack.face.z);
          player.playGesture("hug");
        }
        hugBack = null;
      }
    }
    actionBar?.update(dt);
    blessingCards?.update(dt);
    notice?.update(dt);
    sleep?.setLying(player.lyingBed !== null);
    if (pendingLeft) {
      if (player.lyingBed === pendingLeft.bedId) {
        blessingCards?.showBedCards(pendingLeft.cards, serverNow());
        pendingLeft = null;
      } else if (player.claimedBed !== pendingLeft.bedId && performance.now() - pendingLeft.at > PENDING_LEFT_WAIT_MS) {
        // 눕기 전에 다른 곳으로 가면 그 침대의 평안은 다음 사람을 위해 이미 지워졌으니 그대로 보여 줘요.
        blessingCards?.showBedCards(pendingLeft.cards, serverNow());
        pendingLeft = null;
      }
    }
    const motionDt = reduceMotion.matches ? 0 : dt;
    // 움직임 줄이기면 눈은 멈추지 않고 1/3만 천천히 내려요. 별은 반짝이지 않아요.
    winter.update(dt * snowSpeed(reduceMotion.matches), player.x, player.z);
    sky.update(motionDt);
    lighting.setFocus(player.x, player.z);
    lighting.update(dt);
    hospital.signboard.update(dt);
    // 등불은 모든 캐릭터가 자리를 잡은 뒤에 따라가요.
    for (const nurse of facilities.nurses) nurse.update(dt);
    lanterns.begin();
    const myLanternGround = player.lanternWorld(myLanternPoint);
    if (myLanternGround !== null) lanterns.add(player, myLanternPoint, myLanternGround, sleep?.sleeping ?? false);
    remotes.lanterns(lanterns.add);
    cats.lanterns(lanterns.add);
    for (const nurse of facilities.nurses) {
      nurse.headWorld(nurseLanternPoint);
      nurseLanternPoint.y += NURSE_LANTERN_ABOVE;
      lanterns.add(nurse, nurseLanternPoint, 0);
    }
    lanterns.update(dt, camera, reduceMotion.matches);
    renderer.render(scene, camera);
    // 머리 위 글자는 카메라가 다 움직인 뒤에 맞춰요.
    labels?.update(dt, camera, player.headWorld(headPoint));
    for (const { nurse, label, point } of nurseGreetings) {
      label.update(dt, camera, nurse.headWorld(point));
    }
    // 병실에 들어설 때 내 침대가 없으면 고르는 법을 알려요.
    const roomNow = roomAt(player.walkX, player.walkZ)?.index ?? null;
    if (roomNow !== guidedRoom) {
      guidedRoom = roomNow;
      const guide = roomNow === null ? null : currentBedGuide();
      if (guide) toast(bedGuideText(guide));
    }
    // 내 침대가 바뀌면 다음 방문을 위해 기억해 둬요. 서버에 이어져 있을 때만 적어요.
    if (client.online && entered && !visitingNow && player.ownedBed !== savedSeat) {
      savedSeat = player.ownedBed;
      saveSeat(savedSeat === null ? null : { ward: client.ward, instance: client.instance, bed: savedSeat });
    }
    if (plates) {
      const mine = entered && !visitingNow ? { nickname: current.nickname, bed: player.ownedBed } : null;
      plates.sync(bedPlates(remotes.guests(), mine));
      plates.update(camera, { x: player.walkX, z: player.walkZ });
    }
  };

  // 탭이 보이지 않으면 그리기를 멈춰요. 돌아오면 멈춘 시간을 건너뛰고 이어 그려요.
  let contextLost = false;
  const run = (): void => {
    lastMs = null;
    renderer.setAnimationLoop(frame);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
      probe?.restart();
    } else if (!contextLost) {
      run();
    }
  });

  // 그리는 도중 WebGL이 끊기면 안내를 보여 줘요. 브라우저가 되살려 주면 안내를 닫고 이어 그려요.
  const fallback = createWebglFallback();
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    renderer.setAnimationLoop(null);
    fallback.show();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    fallback.hide();
    if (!document.hidden) run();
  });

  if (!document.hidden) run();
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장하지 못해도 이번 방문 동안은 그대로예요.
  }
}
