/**
 * 고양이를 누르면 메뉴를 열고, 고른 놀이를 서버에 한 번 보내고, 서버가 알린 놀이를 화면에 그려요.
 * 서버에 닿지 않으면(혼자 머물기) 같은 규칙 함수로 이 화면에서만 놀아요.
 */
import type { Vector3 } from "three";
import {
  CAT_NOT_IN_ROOM_TEXT,
  CAT_NOT_LYING_TEXT,
  CAT_PET_ONLY_TEXT,
  CAT_REST_TEXT,
  CAT_TOO_FAST_TEXT,
  catBusyText,
  catPettedText,
  catTapAllowed,
  freshCatState,
  requestPlay,
  wardCatRoom,
} from "../../shared/cat-play-rules";
import type { CatPlayKind, CatSceneKind, CatState, TapLog } from "../../shared/cat-play-rules";
import type { CatPlayMessage, DeniedReason } from "../../shared/protocol";
import { BEDS, roomAt } from "../../shared/ward-layout";
import type { CatsHandle, CatTarget } from "../cat/cats";
import type { RemoteGuests } from "../net/remote-guests";
import type { CatMenu } from "../ui/action-bar";
import type { PlayerControls } from "./controls";

/** 혼자 머물 때 내 고양이를 가리키는 번호예요. 서버에 보내지 않아요. */
const LOCAL_ME = "me000000";
const CAT_KINDS: readonly CatPlayKind[] = ["pet", "yarn", "wand", "knead"];
/** 내가 누른 뒤 이 안에 쉬기가 시작되면 내 요청 때문이라 안내해요. */
const MY_REQUEST_MS = 3_000;

export interface CatPlayFlowOptions {
  cats: CatsHandle;
  remotes: RemoteGuests;
  player: PlayerControls;
  online(): boolean;
  /** 내 공개 번호예요. 들어가기 전이면 빈 글자예요. */
  myId(): string;
  myNickname(): string;
  serverNow(): number;
  send(catId: string, kind: CatPlayKind): void;
  openMenu(menu: CatMenu): void;
  toast(text: string): void;
  /** 퇴원하는 중이면 놀지 않아요. */
  leaving(): boolean;
}

export interface CatPlayFlow {
  /** 누른 시선에 고양이가 있으면 메뉴를 열고 true를 돌려줘요. */
  tap(origin: Vector3, reach: Vector3): boolean;
  /** 길게 누르면 메뉴 없이 바로 쓰다듬어요. */
  longPress(origin: Vector3, reach: Vector3): boolean;
  /** 들어올 때 받은 놀이와 쉬기예요. */
  reset(plays: readonly CatPlayMessage[], rests: readonly { catId: string; until: number }[]): void;
  onPlay(play: CatPlayMessage): void;
  onRest(catId: string, until: number): void;
  onWake(catId: string, until: number): void;
  onBusy(nickname: string, scene: CatSceneKind): void;
  onPetted(nickname: string): void;
  /** 서버가 받지 않은 이유예요. 고양이 안내가 있으면 true예요. */
  onDenied(reason: DeniedReason): boolean;
}

interface Picked {
  catId: string;
  /** 다른 사람이 데리고 다니는 고양이면 그 주인의 닉네임이에요. */
  ownerName: string | null;
  room: number | null;
}

export function createCatPlayFlow(options: CatPlayFlowOptions): CatPlayFlow {
  const { cats, remotes, player } = options;
  const rests = new Map<string, number>();
  /** 혼자 머물 때 쓰는 고양이 상태예요. */
  const localStates = new Map<string, CatState>();
  let localTaps: TapLog = [];
  let lastRequest: { catId: string; at: number } | null = null;

  const me = (): string => (options.online() ? options.myId() : LOCAL_ME);

  const pickedFrom = (origin: Vector3, reach: Vector3): Picked | null => {
    const mine: CatTarget | null = cats.tap(origin, reach);
    if (mine) return mine.kind === "ward" ? { catId: mine.catId, ownerName: null, room: mine.room } : { catId: me(), ownerName: null, room: null };
    if (!options.online()) return null;
    const other = remotes.tapCat(origin, reach);
    return other ? { catId: other.owner.id, ownerName: other.owner.nickname, room: null } : null;
  };

  const lyingRoom = (): number | null => {
    const bed = player.lyingBed;
    return bed === null ? null : (BEDS[bed]?.roomIndex ?? null);
  };

  /** 이 화면에서 미리 알 수 있는 이유로 버튼을 꺼요. 정하는 것은 서버예요. */
  const choicesFor = (picked: Picked): CatMenu["choices"] => {
    const now = options.serverNow();
    const resting = (rests.get(picked.catId) ?? 0) > now;
    const myRoom = roomAt(player.walkX, player.walkZ)?.index ?? null;
    const awayFromRoom = picked.room !== null && myRoom !== picked.room && lyingRoom() !== picked.room;
    const kinds = picked.ownerName !== null ? (["pet"] as const) : CAT_KINDS;
    return kinds.map((kind) => {
      if (resting) return { kind, enabled: false, reason: CAT_REST_TEXT };
      if (awayFromRoom) return { kind, enabled: false, reason: CAT_NOT_IN_ROOM_TEXT };
      if (kind === "knead") {
        const ok = player.lyingBed !== null && (picked.room === null || lyingRoom() === picked.room);
        return { kind, enabled: ok, reason: ok ? null : CAT_NOT_LYING_TEXT };
      }
      return { kind, enabled: true, reason: null };
    });
  };

  const titleFor = (picked: Picked): string => {
    if (picked.ownerName !== null) return `${picked.ownerName}님의 고양이예요. ${CAT_PET_ONLY_TEXT}.`;
    return picked.room !== null ? "병동 고양이와 무엇을 할까요?" : "내 고양이와 무엇을 할까요?";
  };

  /** 혼자 머물 때는 서버 대신 같은 규칙으로 정해요. */
  const playLocally = (catId: string, kind: CatPlayKind): void => {
    const now = options.serverNow();
    const tap = catTapAllowed(localTaps, now);
    localTaps = tap.log;
    if (!tap.ok) {
      options.toast(CAT_TOO_FAST_TEXT);
      return;
    }
    const lyingBed = player.lyingBed;
    const decision = requestPlay(
      localStates.get(catId) ?? freshCatState(),
      {
        catId,
        kind,
        owner: wardCatRoom(catId) === null ? LOCAL_ME : null,
        requester: {
          id: LOCAL_ME,
          nickname: options.myNickname(),
          x: player.walkX,
          z: player.walkZ,
          room: roomAt(player.walkX, player.walkZ)?.index ?? null,
          lyingBed,
          lyingRoom: lyingRoom(),
        },
      },
      now,
      Math.random(),
    );
    switch (decision.kind) {
      case "denied":
        flow.onDenied(decision.reason);
        return;
      case "busy":
        flow.onBusy(decision.nickname, decision.scene);
        return;
      case "resting":
        localStates.set(catId, decision.state);
        flow.onRest(catId, decision.until);
        return;
      case "granted": {
        localStates.set(catId, decision.state);
        const { play } = decision;
        flow.onPlay({ catId, kind: play.kind, by: LOCAL_ME, at: play.at, until: play.until, seed: play.seed, x: play.x, z: play.z, bed: play.bed });
      }
    }
  };

  const request = (picked: Picked, kind: CatPlayKind): void => {
    if (options.leaving()) return;
    lastRequest = { catId: picked.catId, at: performance.now() };
    if (options.online()) options.send(picked.catId, kind);
    else playLocally(picked.catId, kind);
  };

  /** 고양이가 있는 자리예요. 다른 사람 고양이면 그 사람 화면이 아니라 이 화면에서 보이는 자리예요. */
  const catAt = (catId: string): { x: number; z: number } | null =>
    cats.catPosition(catId, me()) ?? remotes.catPosition(catId);

  /** 내가 함께 노는 놀이면 내 캐릭터도 움직여요. 누워 있으면 고양이만 놀아요. */
  const actMine = (play: CatPlayMessage): void => {
    const target = catAt(play.catId);
    if (!target || player.lyingBed !== null || player.seated) return;
    if (play.kind === "pet") {
      const spot = cats.petSpot(play.catId, me()) ?? stepToward(target, 0.42);
      player.walkToSpot(
        spot.x,
        spot.z,
        () => {
          const now = catAt(play.catId) ?? target;
          player.faceToward(now.x, now.z);
          player.playGesture("pet");
        },
        options.online(),
      );
    } else if (play.kind === "yarn" || play.kind === "wand") {
      player.faceToward(target.x, target.z);
      player.playGesture(play.kind === "yarn" ? "toss" : "tease");
    }
  };

  /** 고양이 곁, 내 쪽으로 gap만큼 떨어진 자리예요. */
  const stepToward = (cat: { x: number; z: number }, gap: number): { x: number; z: number } => {
    const dx = player.walkX - cat.x;
    const dz = player.walkZ - cat.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: cat.x + (dx / length) * gap, z: cat.z + (dz / length) * gap };
  };

  const flow: CatPlayFlow = {
    tap(origin, reach) {
      const picked = pickedFrom(origin, reach);
      if (!picked) return false;
      if (options.leaving()) return true;
      options.openMenu({ title: titleFor(picked), choices: choicesFor(picked), pick: (kind) => request(picked, kind) });
      return true;
    },
    longPress(origin, reach) {
      const picked = pickedFrom(origin, reach);
      if (!picked) return false;
      const pet = choicesFor(picked).find((choice) => choice.kind === "pet");
      if (pet && !pet.enabled) {
        if (pet.reason) options.toast(pet.reason);
        return true;
      }
      request(picked, "pet");
      return true;
    },
    reset(plays, restList) {
      rests.clear();
      for (const rest of restList) rests.set(rest.catId, rest.until);
      cats.resetPlays(plays, me());
      const now = options.serverNow();
      for (const play of plays) remotes.catPlay(play, catAt(play.catId), now);
    },
    onPlay(play) {
      const mine = me();
      cats.play(play, mine);
      remotes.catPlay(play, cats.catPosition(play.catId, mine), options.serverNow());
      rests.delete(play.catId);
      if (play.by !== mine) return;
      if (play.kind === "rub") {
        options.toast("고양이가 알아보고 먼저 다가왔어요");
        return;
      }
      actMine(play);
    },
    onRest(catId, until) {
      rests.set(catId, until);
      if (lastRequest?.catId === catId && performance.now() - lastRequest.at < MY_REQUEST_MS) options.toast(CAT_REST_TEXT);
    },
    onWake(catId, until) {
      cats.wake(catId, until, me());
      remotes.catWake(catId, until);
    },
    onBusy(nickname, scene) {
      options.toast(catBusyText(nickname, scene));
    },
    onPetted(nickname) {
      options.toast(catPettedText(nickname));
    },
    onDenied(reason) {
      const text: Partial<Record<DeniedReason, string>> = {
        resting: CAT_REST_TEXT,
        "pet-only": CAT_PET_ONLY_TEXT,
        "not-lying": CAT_NOT_LYING_TEXT,
        "not-in-room": CAT_NOT_IN_ROOM_TEXT,
        "too-fast": CAT_TOO_FAST_TEXT,
      };
      const shown = text[reason];
      if (!shown) return false;
      options.toast(shown);
      return true;
    },
  };
  return flow;
}
