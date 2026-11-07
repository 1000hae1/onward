import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { nicknameMessage } from "../shared/nickname";
import { WARD_CAPACITY } from "../shared/protocol";
import type { WardEvent } from "../shared/protocol";
import { CAT_VISIT_AFTER_MS } from "../shared/ward-rules";
import { BEDS } from "../shared/ward-layout";
import type { CatVisitPlan } from "./cat/cat-path";
import { createCats } from "./cat/cats";
import { createRemoteGuests } from "./net/remote-guests";
import { loadMetList, rememberPerson, saveMetList } from "./net/met-list";
import type { MetList } from "./net/met-list";
import { createBlessingCards } from "./ui/blessing-cards";
import { FIVE_LEAF_ITEM } from "../shared/left-blessings";
import { koreanDay } from "../shared/ward-rules";
import type { BlessingCardMessage, Guest } from "../shared/protocol";
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
const DENIED_TEXT: Record<"out-of-season" | "gift-limit" | "lamp-full" | "not-in-room" | "no-target" | "too-fast" | "once-a-day", string> = {
  "once-a-day": "그분께는 오늘 이미 남겼어요. 내일 또 남겨 주세요.",
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
  /** 서버가 정한 병동 고양이 방문이에요. 병실 번호마다 하나예요. */
  const serverVisits = new Map<number, CatVisitPlan>();
  /** 서버에 닿지 않을 때 내 침대로 오는 방문이에요. 이 화면에서만 계산해요. */
  let localVisit: { room: number; plan: CatVisitPlan } | null = null;
  let lastLying: number | null = null;
  // 서버 시계는 아래에서 연결을 만든 뒤 이어 줘요.
  let serverNow = (): number => Date.now();
  let online = (): boolean => false;
  const cats = createCats(
    scene,
    player,
    {
      serverNow: () => serverNow(),
      isTaken: (bed) => player.claimedBed === bed || remotes.isBedTaken(bed),
      visitFor: (roomIndex) =>
        online() ? (serverVisits.get(roomIndex) ?? null) : localVisit?.room === roomIndex ? localVisit.plan : null,
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
  let pendingLeft: { bedId: number; cards: BlessingCardMessage[] } | null = null;

  const banner = element("connection-banner");
  const setBanner = (text: string | null): void => {
    if (!banner) return;
    banner.textContent = text ?? "";
    banner.hidden = text === null;
  };

  const client = createWardClient(params, loadGuestId(), {
    onSnapshot(snapshot) {
      myId = snapshot.you;
      remotes.reset(snapshot.guests, snapshot.you);
      remember(snapshot.guests, snapshot.you);
      // 내가 없는 동안 도착한 평안이 있으면 들어오자마자 보여 줘요.
      blessingCards?.showInbox(snapshot.inbox, client.serverNow());
      offerings.loadGifts(snapshot.gifts);
      offerings.setLamps(snapshot.lamps);
      serverVisits.clear();
      for (const visit of snapshot.catVisits) serverVisits.set(visit.room, { bed: visit.bed, at: visit.at, until: null });
      setHud(remotes.count + 1);
      setBanner(null);
      warnedOffline = false;
      // 서버가 기억하는 내 자리와 이 화면의 자리가 다를 때만 맞춰요. 30초 안에 돌아왔으면 대개 같아요.
      const me = snapshot.guests.find((guest) => guest.id === snapshot.you);
      const bed = player.claimedBed;
      if (bed !== null && me?.bed !== bed) {
        void client.askBed(bed).then((granted) => {
          if (!granted) {
            player.forceGetUp();
            toast("다시 이어지는 사이 다른 분이 침대에 누웠어요.");
          }
        });
      } else if (bed === null && me && me.bed !== null) {
        client.send({ type: "get-up" });
      }
      if (bed === null && me && Math.hypot(me.x - player.walkX, me.z - player.walkZ) > 0.3) {
        client.send({ type: "walk-to", x: player.walkX, z: player.walkZ });
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
      if (event.kind === "join" || event.kind === "leave") setHud(remotes.count + 1);
    },
    onCorrected(x, z) {
      player.correctDestination(x, z);
    },
    onNicknameRejected(problem) {
      reopenEntry(nicknameMessage(problem));
    },
    onDenied(denied) {
      if (denied.reason === "gift-limit" && denied.item === FIVE_LEAF_ITEM) {
        toast("오잎클로버는 내일 다시 놓을 수 있어요.");
        return;
      }
      toast(DENIED_TEXT[denied.reason]);
    },
    onLeftBlessings(message) {
      pendingLeft = { bedId: message.bedId, cards: message.cards };
    },
    onLeftSaved() {
      toast("남겨두었어요. 다음에 들어오시면 전해져요.");
    },
    onStatus(status) {
      if (status === "online" || status === "connecting") return;
      if (status === "reconnecting") {
        // 다른 사람과 고양이는 그대로 두고 기다려요. 다시 이어지면 snapshot으로 맞춰요.
        setBanner("연결이 잠시 끊겼어요. 다시 이어지는 중이에요.");
        return;
      }
      setHud(null);
      remotes.reset([], "");
      if (status === "outdated") {
        setBanner("새 버전이 나왔어요. 새로고침해 주세요.");
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
  online = () => client.online;

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
        people: () =>
          client.online
            ? metList.people.map((person) => {
                const id = remotes.idForAddress(person.address);
                const head = id ? remotes.headSpot(id) : null;
                return { address: person.address, nickname: person.nickname, present: id && head ? { id, head } : null };
              })
            : [],
        sink: {
          online: () => client.online,
          blessPerson: (targetId) => client.send({ type: "bless", targetId }),
          leaveFor: (address, kind, item) =>
            client.send(item === undefined ? { type: "leave-for", address, kind } : { type: "leave-for", address, kind, item }),
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
    actionBar?.update(dt);
    blessingCards?.update(dt);
    if (pendingLeft) {
      if (player.lyingBed === pendingLeft.bedId) {
        blessingCards?.showBedCards(pendingLeft.cards, serverNow());
        pendingLeft = null;
      } else if (player.claimedBed !== pendingLeft.bedId) {
        // 눕기 전에 다른 곳으로 가면 그 침대의 평안은 다음 사람을 위해 이미 지워졌으니 그대로 보여 줘요.
        blessingCards?.showBedCards(pendingLeft.cards, serverNow());
        pendingLeft = null;
      }
    }
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
