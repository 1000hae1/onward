/**
 * 고양이와 놀기 규칙이에요. 화면과 상관없는 순수 함수이고, 서버(ward-room)와 혼자 머무는 화면이 함께 써요.
 *
 * - 고양이마다 한 번에 한 사람과만 놀아요. 늦게 누른 사람은 "지금 ○○님이랑 놀고 있어요"를 봐요.
 * - 놀이가 끝나고 곧바로 또 청하면 "연달아"로 세요. 연달아 두 번 논 뒤 세 번째 요청에서 10초 쉬어요.
 * - 다른 사람이 데리고 다니는 고양이는 쓰다듬기만 할 수 있어요.
 * - 꾹꾹이는 내가 침대에 누워 있을 때만 받아요.
 * - 연결마다 요청 횟수를 제한해요.
 */

export const CAT_PLAY_KINDS = ["pet", "yarn", "wand", "knead"] as const;
/** 사람이 청하는 놀이예요. */
export type CatPlayKind = (typeof CAT_PLAY_KINDS)[number];
/** 고양이가 하는 장면이에요. rub은 기억하는 고양이가 먼저 다가와 비비는 장면이라 서버만 시작해요. */
export type CatSceneKind = CatPlayKind | "rub";

/** 병동 고양이 번호예요. 병실마다 하나씩 w0~w5예요. 데리고 다니는 고양이는 주인의 공개 번호를 써요. */
export const WARD_CAT_PATTERN = /^w[0-5]$/;
export const wardCatId = (room: number): string => `w${room}`;
export function wardCatRoom(catId: string): number | null {
  return WARD_CAT_PATTERN.test(catId) ? Number(catId.slice(1)) : null;
}

/**
 * 장면 길이예요. busyMs 동안은 다른 사람이 놀 수 없고, untilMs가 지나면 고양이가 원래 하던 대로 돌아가요.
 * 꾹꾹이는 끝나고 곁에서 웅크려 자니까 busy보다 길어요.
 */
export const PLAY_TIMING: Record<CatSceneKind, { busyMs: number; untilMs: number }> = {
  pet: { busyMs: 7_000, untilMs: 7_000 },
  yarn: { busyMs: 9_000, untilMs: 9_000 },
  wand: { busyMs: 6_500, untilMs: 6_500 },
  knead: { busyMs: 14_000, untilMs: 180_000 },
  rub: { busyMs: 18_000, untilMs: 18_000 },
};

/** 앞 놀이가 끝나고 이 안에 또 청하면 연달아예요. */
export const STREAK_GAP_MS = 15_000;
/** 연달아 이만큼 논 뒤의 요청에서 쉬어요. 즉 세 번째부터예요. */
export const PLAYS_BEFORE_REST = 2;
export const REST_MS = 10_000;

/** 연결마다 요청 간격과 횟수예요. */
export const CAT_TAP_GAP_MS = 1_000;
export const CAT_TAP_WINDOW_MS = 30_000;
export const CAT_TAPS_PER_WINDOW = 6;

/** 오늘 이만큼 쓰다듬어 주면 고양이가 기억해요. */
export const PET_REMEMBER_COUNT = 3;

export interface ActivePlay {
  kind: CatSceneKind;
  /** 함께 노는 사람의 공개 번호예요. 고양이가 먼저 다가온 장면이면 그 사람이에요. */
  by: string;
  /** 함께 노는 사람의 닉네임이에요. 늦게 누른 사람에게 "○○님이랑"을 알려 줄 때만 써요. */
  byName: string;
  at: number;
  busyUntil: number;
  until: number;
  /** 털실이 굴러가는 방향처럼 장면의 작은 차이를 정해요. 모든 화면이 같은 값을 써요. */
  seed: number;
  /** 요청할 때 그 사람이 서 있던 자리예요. 고양이가 그쪽을 봐요. */
  x: number;
  z: number;
  /** 꾹꾹이를 받는 침대예요. */
  bed: number | null;
}

export interface CatState {
  /** 지금 하고 있거나 마지막으로 한 놀이예요. */
  play: ActivePlay | null;
  /** 연달아 논 횟수예요. */
  streak: number;
  /** 이때까지 쉬어요. */
  restUntil: number;
}

export const freshCatState = (): CatState => ({ play: null, streak: 0, restUntil: 0 });

export interface PlayRequester {
  id: string;
  nickname: string;
  x: number;
  z: number;
  /** 지금 있는 병실이에요. 복도나 마당이면 null이에요. */
  room: number | null;
  /** 지금 누워 있는 침대예요. */
  lyingBed: number | null;
  /** 누워 있는 침대가 있는 병실이에요. */
  lyingRoom: number | null;
}

export interface PlayRequest {
  catId: string;
  kind: CatPlayKind;
  requester: PlayRequester;
  /** 데리고 다니는 고양이면 주인의 공개 번호예요. 병동 고양이면 null이에요. */
  owner: string | null;
}

export type DenyReason = "pet-only" | "not-lying" | "not-in-room";

export type PlayDecision =
  | { kind: "granted"; state: CatState; play: ActivePlay }
  /** 누가 놀고 있어요. 고양이가 먼저 다가가 비비는 중이면 nickname은 그 사람이에요. */
  | { kind: "busy"; nickname: string; scene: CatSceneKind }
  /** 쉬고 있어요. started면 이번 요청으로 막 쉬기 시작했어요(모두에게 알려요). */
  | { kind: "resting"; until: number; started: boolean; state: CatState }
  | { kind: "denied"; reason: DenyReason };

/**
 * 놀이를 청해요. 서버가 메시지를 하나씩 처리하니, 같은 고양이를 동시에 누르면 먼저 처리된 사람만 받아요.
 * seed는 서버가 정한 무작위 값이에요(0 이상 1 미만).
 */
export function requestPlay(state: CatState, request: PlayRequest, now: number, seed: number): PlayDecision {
  const { requester, kind, owner } = request;
  const wardRoom = wardCatRoom(request.catId);
  // 다른 사람의 고양이는 쓰다듬기만 해요.
  if (owner !== null && owner !== requester.id && kind !== "pet") return { kind: "denied", reason: "pet-only" };
  // 병동 고양이는 같은 병실 안에서만 놀아요.
  if (wardRoom !== null && requester.room !== wardRoom && requester.lyingRoom !== wardRoom) {
    return { kind: "denied", reason: "not-in-room" };
  }
  if (kind === "knead") {
    if (requester.lyingBed === null) return { kind: "denied", reason: "not-lying" };
    if (wardRoom !== null && requester.lyingRoom !== wardRoom) return { kind: "denied", reason: "not-in-room" };
  }
  if (now < state.restUntil) return { kind: "resting", until: state.restUntil, started: false, state };
  const last = state.play;
  if (last && now < last.busyUntil) return { kind: "busy", nickname: last.byName, scene: last.kind };

  // 고양이가 먼저 다가간 장면은 연달아에 세지 않아요.
  const consecutive = last !== null && last.kind !== "rub" && now - last.busyUntil < STREAK_GAP_MS;
  const streak = consecutive ? state.streak : 0;
  if (streak >= PLAYS_BEFORE_REST) {
    const until = now + REST_MS;
    return { kind: "resting", until, started: true, state: { play: last, streak: 0, restUntil: until } };
  }
  const timing = PLAY_TIMING[kind];
  const play: ActivePlay = {
    kind,
    by: requester.id,
    byName: requester.nickname,
    at: now,
    busyUntil: now + timing.busyMs,
    until: now + timing.untilMs,
    seed,
    x: requester.x,
    z: requester.z,
    bed: kind === "knead" ? requester.lyingBed : null,
  };
  return { kind: "granted", play, state: { play, streak: streak + 1, restUntil: state.restUntil } };
}

/** 꾹꾹이 뒤 곁에서 자던 고양이가, 그 사람이 일어나면 그때 깨어나요. 바뀌지 않으면 null이에요. */
export function wakeFromKnead(state: CatState, guestId: string, now: number): CatState | null {
  const play = state.play;
  if (!play || play.kind !== "knead" || play.by !== guestId || now >= play.until) return null;
  const until = Math.max(now, play.at);
  return { ...state, play: { ...play, until, busyUntil: Math.min(play.busyUntil, until) } };
}

/**
 * 기억하는 고양이가 먼저 다가가 비비는 장면을 시작해요. 놀거나 쉬는 중이면 null이에요.
 * 연달아 횟수는 그대로 둬요.
 */
export function startRub(
  state: CatState,
  guest: { id: string; nickname: string; x: number; z: number },
  now: number,
  seed: number,
): { state: CatState; play: ActivePlay } | null {
  if (now < state.restUntil) return null;
  if (state.play && now < state.play.busyUntil) return null;
  const timing = PLAY_TIMING.rub;
  const play: ActivePlay = {
    kind: "rub",
    by: guest.id,
    byName: guest.nickname,
    at: now,
    busyUntil: now + timing.busyMs,
    until: now + timing.untilMs,
    seed,
    x: guest.x,
    z: guest.z,
    bed: null,
  };
  return { state: { ...state, play }, play };
}

/** 연결 하나의 요청 기록이에요. 최근 요청 시각만 둬요. */
export type TapLog = readonly number[];

/** 이번 요청을 받아도 되는지와, 받으면 새 기록이에요. 1초 간격, 30초에 6번까지예요. */
export function catTapAllowed(log: TapLog, now: number): { ok: boolean; log: TapLog } {
  const recent = log.filter((at) => now - at < CAT_TAP_WINDOW_MS && at <= now);
  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < CAT_TAP_GAP_MS) return { ok: false, log: recent };
  if (recent.length >= CAT_TAPS_PER_WINDOW) return { ok: false, log: recent };
  return { ok: true, log: [...recent, now] };
}

/**
 * 들어올 때 고양이가 먼저 다가와 비빌지예요. 오늘이나 어제 이 병동에서 세 번 넘게 쓰다듬어 줬고,
 * 오늘 아직 비비지 않았으면 그래요.
 */
export function shouldRub(petsToday: number, petsYesterday: number, rubbedToday: boolean): boolean {
  if (rubbedToday) return false;
  return Math.max(petsToday, petsYesterday) >= PET_REMEMBER_COUNT;
}

/** 놀이 이름이에요. 메뉴와 안내에 써요. */
export const CAT_PLAY_LABELS: Record<CatPlayKind, { emoji: string; label: string }> = {
  pet: { emoji: "🤲", label: "쓰다듬기" },
  yarn: { emoji: "🧶", label: "털실 굴리기" },
  wand: { emoji: "🎣", label: "낚싯대 흔들기" },
  knead: { emoji: "🐾", label: "꾹꾹이 받기" },
};

export const CAT_REST_TEXT = "고양이가 잠깐 쉬고 싶대요";
export const CAT_NOT_LYING_TEXT = "침대에 누워 있을 때 받을 수 있어요";
export const CAT_PET_ONLY_TEXT = "다른 분의 고양이는 쓰다듬어 줄 수 있어요";
export const CAT_NOT_IN_ROOM_TEXT = "고양이와 같은 병실에 들어가면 놀 수 있어요";
export const CAT_TOO_FAST_TEXT = "고양이와 조금 천천히 놀아 주세요";

export function catBusyText(nickname: string, scene: CatSceneKind): string {
  return scene === "rub" ? `고양이가 ${nickname}님께 인사하는 중이에요` : `지금 ${nickname}님이랑 놀고 있어요`;
}

export function catPettedText(nickname: string): string {
  return `${nickname}님이 고양이를 쓰다듬어 주셨어요`;
}
