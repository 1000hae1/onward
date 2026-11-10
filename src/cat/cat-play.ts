/**
 * 고양이 놀이 장면을 (장면 정보, 서버 시각)만으로 계산해요. 화면과 상관없는 순수 함수예요.
 * 서버는 놀이를 한 번만 알리고(cat-play), 각 화면은 같은 시각과 시드를 넣어 같은 장면을 그려요.
 */
import type { CatSceneKind } from "../../shared/cat-play-rules";
import type { CatPoint } from "./cat-path";
import { restPlayPose } from "./cat-pose";
import type { CatPlayPose } from "./cat-pose";

export interface ScenePlace {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PlayScene {
  kind: CatSceneKind;
  seed: number;
  /** 서버 시각이에요. 밀리초예요. */
  at: number;
  until: number;
  /** 놀이가 시작할 때 고양이가 있던 자리예요. */
  start: ScenePlace;
  /** 침대 위에서 시작하면 먼저 내려올 바닥 자리예요. 바닥에서 시작하면 start와 같아요. */
  floor: CatPoint;
  /** 함께 노는 사람이 요청할 때 있던 자리예요. */
  person: CatPoint;
  /** 꾹꾹이를 받는 침대예요. */
  bed: { approach: CatPoint; seat: CatPoint; yaw: number; height: number } | null;
  /** 먼저 다가가 비빌 때 지나는 문이에요. */
  door: { inside: CatPoint; outside: CatPoint } | null;
  /** 두 자리 사이 길이에요. 같은 입력이면 늘 같은 길을 돌려줘야 해요. */
  path(from: CatPoint, to: CatPoint): readonly CatPoint[];
}

export interface SceneFrame extends ScenePlace {
  /** 걷거나 뛰는 중이에요. */
  walking: boolean;
  sit: number;
  curl: number;
  play: CatPlayPose;
  /** 하트가 뜬 뒤 흐른 초예요. 없으면 null이에요. */
  heart: number | null;
  /** 털실 공 자리와 굴러간 거리예요. */
  yarn: { x: number; y: number; z: number; rolled: number } | null;
  /** 깃털 낚싯대 끝 자리예요. */
  wand: { x: number; y: number; z: number } | null;
}

/** 놀이할 때 걷는 빠르기예요. 평소보다 조금 서둘러요. */
const PLAY_SPEED = 0.8;
const RUB_SPEED = 0.67;
const HOP_SECONDS = 0.7;
const HOP_HEIGHT = 0.22;
/** 다가가는 길이 이보다 길면 문 앞이나 침대 곁에서 기다리던 것처럼 시작해요. */
const MAX_WALK_SECONDS = 8;
/** 쓰다듬을 사람이 고양이 곁으로 오는 시간이에요. */
export const PET_APPROACH_SECONDS = 3;
/** 쓰다듬는 사람이 서는 거리예요. */
const PET_REACH = 0.42;
/** 털실이 멈추는 자리예요. 고양이에게서 사람 쪽으로 이만큼이에요. */
const YARN_STOP = 0.55;
const YARN_RADIUS = 0.05;
/** 뚱뚱해서 높이 못 뛰어요. 살짝 뜨는 정도예요. */
export const WAND_JUMP_HEIGHT = 0.07;
const HEART_SECONDS = 1.6;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smooth = (from: number, to: number, value: number): number => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const yawTo = (from: CatPoint, to: CatPoint, fallback: number): number =>
  Math.hypot(to.x - from.x, to.z - from.z) < 1e-6 ? fallback : Math.atan2(to.x - from.x, to.z - from.z);
/** 각도를 짧은 쪽으로 섞어요. */
const lerpYaw = (a: number, b: number, t: number): number => {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
};

function pathLength(from: CatPoint, path: readonly CatPoint[]): number {
  let length = 0;
  let previous = from;
  for (const point of path) {
    length += Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return length;
}

function along(from: CatPoint, path: readonly CatPoint[], distance: number): { point: CatPoint; yaw: number | null } {
  let current = from;
  let left = distance;
  let yaw: number | null = null;
  for (const point of path) {
    const gap = Math.hypot(point.x - current.x, point.z - current.z);
    if (gap > 0) yaw = Math.atan2(point.x - current.x, point.z - current.z);
    if (gap >= left) {
      const t = gap === 0 ? 0 : left / gap;
      return { point: { x: lerp(current.x, point.x, t), z: lerp(current.z, point.z, t) }, yaw };
    }
    left -= gap;
    current = point;
  }
  return { point: current, yaw };
}

/** 걸어갈 길이에요. 너무 길면 끝 바로 앞에서 시작해요. */
function walkPlan(from: CatPoint, path: readonly CatPoint[], speed: number): { from: CatPoint; path: readonly CatPoint[]; seconds: number } {
  const seconds = pathLength(from, path) / speed;
  if (seconds <= MAX_WALK_SECONDS || path.length === 0) return { from, path, seconds };
  const end = path[path.length - 1];
  return { from: end, path: [], seconds: 0 };
}

/** 사람에게서 고양이 쪽 방향이에요. 둘이 겹쳐 있으면 시드로 정해요. */
function towardPerson(scene: PlayScene, from: CatPoint): { x: number; z: number } {
  const dx = scene.person.x - from.x;
  const dz = scene.person.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.2) {
    const angle = scene.seed * Math.PI * 2;
    return { x: Math.sin(angle), z: Math.cos(angle) };
  }
  return { x: dx / length, z: dz / length };
}

function blank(place: ScenePlace): SceneFrame {
  return { ...place, walking: false, sit: 1, curl: 0, play: restPlayPose(), heart: null, yarn: null, wand: null };
}

/** 침대 위에서 시작하면 바닥으로 내려와요. 내려오는 동안의 모습과 내려온 뒤의 시각을 돌려줘요. */
function hopDown(scene: PlayScene, seconds: number): { frame: SceneFrame | null; after: number } {
  if (scene.start.y <= 0) return { frame: null, after: seconds };
  if (seconds >= HOP_SECONDS) return { frame: null, after: seconds - HOP_SECONDS };
  const t = seconds / HOP_SECONDS;
  const frame = blank({
    x: lerp(scene.start.x, scene.floor.x, t),
    z: lerp(scene.start.z, scene.floor.z, t),
    y: lerp(scene.start.y, 0, t) + Math.sin(t * Math.PI) * HOP_HEIGHT,
    yaw: yawTo(scene.start, scene.floor, scene.start.yaw),
  });
  frame.sit = 0;
  return { frame, after: 0 };
}

/** 쓰다듬는 사람이 서는 자리예요. 고양이 곁에서 사람 쪽이에요. */
export function petSpot(scene: Pick<PlayScene, "start" | "person" | "seed">): CatPoint {
  const dir = towardPerson(scene as PlayScene, scene.start);
  return { x: scene.start.x + dir.x * PET_REACH, z: scene.start.z + dir.z * PET_REACH };
}

function petFrame(scene: PlayScene, s: number): SceneFrame {
  const spot = petSpot(scene);
  const frame = blank({ ...scene.start, yaw: lerpYaw(scene.start.yaw, yawTo(scene.start, spot, scene.start.yaw), smooth(0, 0.6, s)) });
  const petting = smooth(PET_APPROACH_SECONDS, PET_APPROACH_SECONDS + 0.4, s) * (1 - smooth(6.4, 7, s));
  frame.play.lookUp = 0.6 * (1 - petting) * smooth(0, 0.5, s) + 0.35 * petting;
  frame.play.squint = petting;
  // 손에 머리를 비벼요.
  frame.play.headRoll = Math.sin((s - PET_APPROACH_SECONDS) * 4) * 0.3 * petting;
  frame.play.wiggle = Math.sin((s - PET_APPROACH_SECONDS) * 4) * 0.06 * petting;
  const heartAt = PET_APPROACH_SECONDS + 0.8;
  frame.heart = s >= heartAt && s < heartAt + HEART_SECONDS ? s - heartAt : null;
  return frame;
}

function yarnLayout(scene: PlayScene): { stop: CatPoint; catch: CatPoint; dir: { x: number; z: number } } {
  const dir = towardPerson(scene, scene.floor);
  // 시드만큼 비스듬히 굴러가요.
  const turn = (scene.seed - 0.5) * 0.8;
  const rx = dir.x * Math.cos(turn) - dir.z * Math.sin(turn);
  const rz = dir.x * Math.sin(turn) + dir.z * Math.cos(turn);
  const stop = { x: scene.floor.x + rx * YARN_STOP, z: scene.floor.z + rz * YARN_STOP };
  const catchPoint = { x: stop.x - rx * 0.16, z: stop.z - rz * 0.16 };
  return { stop, catch: catchPoint, dir: { x: rx, z: rz } };
}

function yarnFrame(scene: PlayScene, s: number): SceneFrame {
  const { stop, catch: catchPoint, dir } = yarnLayout(scene);
  const ballStart = { x: scene.person.x - dir.x * 0.25, z: scene.person.z - dir.z * 0.25 };
  const rollT = 1 - (1 - clamp01(s / 1.2)) ** 2;
  let ball = { x: lerp(ballStart.x, stop.x, rollT), z: lerp(ballStart.z, stop.z, rollT), y: YARN_RADIUS };
  let rolled = Math.hypot(stop.x - ballStart.x, stop.z - ballStart.z) * rollT;

  const dash = smooth(1.2, 2, s);
  const place = {
    x: lerp(scene.floor.x, catchPoint.x, dash),
    z: lerp(scene.floor.z, catchPoint.z, dash),
    y: 0,
    yaw: yawTo(scene.floor, stop, scene.start.yaw),
  };
  const frame = blank(place);
  frame.walking = s >= 1.2 && s < 2;
  frame.sit = s < 1.2 ? 1 - smooth(0, 0.4, s) : 1 - smooth(1.2, 1.4, s) + smooth(8.2, 9, s);
  frame.play.crouch = s < 1.2 ? smooth(0, 0.4, s) : 0;
  frame.play.wiggle = s < 1.2 ? Math.sin(s * 14) * 0.18 * smooth(0.3, 0.6, s) : 0;
  // 앞발로 톡톡 쳐요. 공도 조금씩 밀려요.
  if (s >= 2 && s < 5) {
    const tap = Math.max(0, Math.sin((s - 2) * 7));
    frame.play.paw = tap;
    frame.play.crouch = 0.5;
    ball = { x: ball.x + dir.x * 0.03 * tap, z: ball.z + dir.z * 0.03 * tap, y: YARN_RADIUS };
    rolled += 0.03 * tap;
  }
  // 품에 안고 뒹굴어요.
  const hug = smooth(5, 5.4, s) * (1 - smooth(8.2, 8.7, s));
  if (hug > 0) {
    frame.play.roll = hug * (1.25 + Math.sin((s - 5) * 5) * 0.25);
    frame.play.squint = hug * 0.6;
    frame.curl = hug * 0.5;
    const held = { x: catchPoint.x + dir.x * 0.12, z: catchPoint.z + dir.z * 0.12, y: lerp(YARN_RADIUS, 0.12, hug) };
    ball = { x: lerp(ball.x, held.x, hug), z: lerp(ball.z, held.z, hug), y: held.y };
    rolled += (s - 5) * 0.4 * hug;
  }
  frame.yarn = { ...ball, rolled };
  return frame;
}

function wandFrame(scene: PlayScene, s: number): SceneFrame {
  const dir = towardPerson(scene, scene.floor);
  const forward = smooth(2.8, 3.5, s) * 0.12;
  const place = { x: scene.floor.x + dir.x * forward, z: scene.floor.z + dir.z * forward, y: 0, yaw: yawTo(scene.floor, scene.person, scene.start.yaw) };
  const jumpT = clamp01((s - 2.8) / 0.7);
  if (jumpT > 0 && jumpT < 1) place.y = Math.sin(jumpT * Math.PI) * WAND_JUMP_HEIGHT;
  const frame = blank(place);
  const crouch = smooth(0.6, 1, s) * (1 - smooth(2.7, 2.85, s));
  frame.sit = 1 - smooth(0.4, 0.8, s) + smooth(3.5, 4.1, s);
  frame.play.crouch = crouch;
  // 엉덩이를 씰룩여요.
  frame.play.wiggle = Math.sin(s * 14) * 0.22 * crouch;
  frame.play.lookUp = jumpT > 0 ? (jumpT < 1 ? 1 : 0.8) : 0.4;
  frame.play.paw = jumpT > 0 && jumpT < 1 ? Math.sin(jumpT * Math.PI) : 0;
  // 깃털은 고양이 앞 위에서 흔들려요. 뛰어오르는 순간 살짝 낮아졌다가 다시 올라가요.
  const sway = Math.sin(s * 3.3 + scene.seed * 6) * 0.1;
  const tipAhead = 0.3;
  frame.wand = {
    x: scene.floor.x + dir.x * tipAhead + dir.z * sway,
    z: scene.floor.z + dir.z * tipAhead - dir.x * sway,
    y: 0.34 + Math.sin(s * 5) * 0.06 - (jumpT > 0 && jumpT < 1 ? 0.1 * Math.sin(jumpT * Math.PI) : 0),
  };
  return frame;
}

function kneadFrame(scene: PlayScene, s: number): SceneFrame {
  const bed = scene.bed;
  if (!bed) return blank(scene.start);
  const walk = walkPlan(scene.floor, scene.path(scene.floor, bed.approach), PLAY_SPEED);
  if (s < walk.seconds) {
    const step = along(walk.from, walk.path, s * PLAY_SPEED);
    const frame = blank({ x: step.point.x, z: step.point.z, y: 0, yaw: step.yaw ?? scene.start.yaw });
    frame.walking = true;
    frame.sit = 0;
    return frame;
  }
  const t = s - walk.seconds;
  if (t < HOP_SECONDS) {
    const u = t / HOP_SECONDS;
    const frame = blank({
      x: lerp(bed.approach.x, bed.seat.x, u),
      z: lerp(bed.approach.z, bed.seat.z, u),
      y: lerp(0, bed.height, u) + Math.sin(u * Math.PI) * HOP_HEIGHT,
      yaw: yawTo(bed.approach, bed.seat, bed.yaw),
    });
    frame.sit = 0;
    return frame;
  }
  const k = t - HOP_SECONDS;
  const frame = blank({ x: bed.seat.x, y: bed.height, z: bed.seat.z, yaw: bed.yaw });
  const kneading = 1 - smooth(4.5, 5, k);
  frame.sit = 0;
  frame.play.crouch = 0.3 * kneading;
  frame.play.knead = kneading > 0.01 ? k * 6 : 0;
  frame.play.squint = 0.7 * kneading + (1 - kneading);
  frame.curl = 1 - kneading;
  return frame;
}

function rubFrame(scene: PlayScene, s: number): SceneFrame {
  const door = scene.door;
  if (!door) return blank(scene.start);
  const go = walkPlan(scene.floor, [...scene.path(scene.floor, door.inside), door.inside, door.outside], RUB_SPEED);
  if (s < go.seconds) {
    const step = along(go.from, go.path, s * RUB_SPEED);
    const frame = blank({ x: step.point.x, z: step.point.z, y: 0, yaw: step.yaw ?? scene.start.yaw });
    frame.walking = true;
    frame.sit = 0;
    return frame;
  }
  const t = s - go.seconds;
  const rubSeconds = 6;
  if (t < rubSeconds) {
    const frame = blank({ x: door.outside.x, y: 0, z: door.outside.z, yaw: yawTo(door.outside, scene.person, scene.start.yaw) });
    const rub = smooth(0, 0.4, t) * (1 - smooth(rubSeconds - 0.4, rubSeconds, t));
    frame.sit = 1 - rub;
    // 몸을 옆으로 기울여 비벼요.
    frame.play.roll = Math.sin(t * 3) * 0.22 * rub;
    frame.play.headRoll = Math.sin(t * 3 + 0.6) * 0.3 * rub;
    frame.play.wiggle = Math.sin(t * 3) * 0.12 * rub;
    frame.play.squint = rub;
    frame.heart = t >= 1 && t < 1 + HEART_SECONDS ? t - 1 : null;
    return frame;
  }
  const back = Math.hypot(door.inside.x - door.outside.x, door.inside.z - door.outside.z) / RUB_SPEED;
  const u = clamp01((t - rubSeconds) / Math.max(back, 0.01));
  const frame = blank({
    x: lerp(door.outside.x, door.inside.x, u),
    z: lerp(door.outside.z, door.inside.z, u),
    y: 0,
    yaw: u < 1 ? yawTo(door.outside, door.inside, scene.start.yaw) : yawTo(door.inside, door.outside, scene.start.yaw),
  });
  frame.walking = u < 1;
  frame.sit = u < 1 ? 0 : 1;
  return frame;
}

/** 서버 시각 time에 장면이 어떤 모습인지예요. 장면이 끝난 뒤의 모습은 sceneRest를 써요. */
export function sceneFrame(scene: PlayScene, time: number): SceneFrame {
  const seconds = Math.max(0, (time - scene.at) / 1000);
  if (scene.kind === "pet") return petFrame(scene, seconds);
  const hop = hopDown(scene, seconds);
  if (hop.frame) return hop.frame;
  const s = hop.after;
  switch (scene.kind) {
    case "yarn":
      return yarnFrame(scene, s);
    case "wand":
      return wandFrame(scene, s);
    case "knead":
      return kneadFrame(scene, s);
    case "rub":
      return rubFrame(scene, s);
  }
}

/** 장면이 끝났을 때 고양이가 있는 바닥 자리와, 침대 위에 있으면 그 자리예요. 여기서 평소 일정으로 돌아가요. */
export function sceneRest(scene: PlayScene): { point: CatPoint; seat: CatPoint | null } {
  switch (scene.kind) {
    case "pet":
      return scene.start.y > 0 ? { point: scene.floor, seat: { x: scene.start.x, z: scene.start.z } } : { point: scene.floor, seat: null };
    case "yarn":
      return { point: yarnLayout(scene).catch, seat: null };
    case "wand": {
      const dir = towardPerson(scene, scene.floor);
      return { point: { x: scene.floor.x + dir.x * 0.12, z: scene.floor.z + dir.z * 0.12 }, seat: null };
    }
    case "knead":
      return scene.bed ? { point: scene.bed.approach, seat: scene.bed.seat } : { point: scene.floor, seat: null };
    case "rub":
      return { point: scene.door?.inside ?? scene.floor, seat: null };
  }
}
