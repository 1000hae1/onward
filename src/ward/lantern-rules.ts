import { BUILDING } from "../../shared/ward-layout";
import type { TimeSlot } from "./time-of-day";

/**
 * 등불을 달 캐릭터를 하나씩 알려 줘요. key는 같은 캐릭터면 늘 같은 객체이고, at은 등불 자리, groundY는 발밑 높이예요.
 * dim이면 잠든 사람이라 등불을 은은하게 꺼요.
 */
export type LanternSink = (key: object, at: { x: number; y: number; z: number }, groundY: number, dim?: boolean) => void;

/**
 * 머리 위 작은 등불의 규칙이에요. 화면(head-lanterns.ts)은 이 결과만 따라요.
 *
 * - 밖(병원 건물 바깥)에서는 저녁(18시~)과 밤에 켜져요.
 * - 건물 안에서는 소등 뒤(22시~06시)에만 켜져요.
 * - 켜고 끌 때는 1초 동안 부드럽게 바뀌어요.
 * - 진짜 조명은 화면에 가까운 등불 몇 개에만 달고, 나머지는 가벼운 방식으로 비춰요.
 */

/** 켜지고 꺼지는 데 걸리는 시간이에요(초). */
export const LANTERN_FADE_SECONDS = 1;
/** 잠든 사람의 등불이 꺼지는 데 걸리는 시간이에요(초). 눈치채지 못할 만큼 천천히요. */
export const SLEEP_FADE_SECONDS = 4;
/** 진짜 조명을 다는 등불의 최대 개수예요. */
export const MAX_REAL_LANTERN_LIGHTS = 4;

/** 병원 건물(병실, 복도, 로비) 바깥인지예요. */
export function isOutdoors(x: number, z: number): boolean {
  return x < BUILDING.minX || x > BUILDING.maxX || z < BUILDING.minZ || z > BUILDING.maxZ;
}

/** 이 시간대, 이 자리에서 등불이 켜져야 하는지예요. */
export function lanternWanted(slot: TimeSlot, outdoors: boolean): boolean {
  if (slot === "night") return true;
  if (slot === "evening") return outdoors;
  return false;
}

/** 켜짐 정도(0~1)를 목표 쪽으로 dt만큼 옮겨요. 1초면 끝까지 가요. */
export function stepFade(current: number, wanted: boolean, dt: number, seconds = LANTERN_FADE_SECONDS): number {
  const step = seconds > 0 ? dt / seconds : 1;
  return wanted ? Math.min(1, current + step) : Math.max(0, current - step);
}

/** 켜짐 정도를 화면에 보이는 밝기로 바꿔요. 처음과 끝이 부드러워요. */
export function fadeLook(fade: number): number {
  const t = Math.min(1, Math.max(0, fade));
  return t * t * (3 - 2 * t);
}

export interface LightCandidate {
  /** 카메라와의 거리예요(미터). */
  distance: number;
  /** 화면 안에 보이는지예요. */
  inView: boolean;
  /** 지금 밝기예요(0~1). */
  strength: number;
}

/**
 * 진짜 조명을 받을 등불을 골라요. 켜져 있고 화면 안에 있는 것 중 카메라에 가까운 순서로 max개까지예요.
 * 저사양(allowed가 false)이면 아무것도 고르지 않아요. 고른 순서대로 번호를 돌려줘요.
 */
export function pickRealLights(
  candidates: readonly LightCandidate[],
  max = MAX_REAL_LANTERN_LIGHTS,
  allowed = true,
): number[] {
  if (!allowed || max <= 0) return [];
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.inView && candidate.strength > 0.001)
    .sort((a, b) => a.candidate.distance - b.candidate.distance || a.index - b.index)
    .slice(0, max)
    .map(({ index }) => index);
}

/** 등불이 위아래로 아주 천천히 떠다니는 높이 변화예요(미터). */
export const LANTERN_BOB_HEIGHT = 0.015;
/** 한 번 오르내리는 데 걸리는 시간이에요(초). */
export const LANTERN_BOB_SECONDS = 4.5;

export function lanternBob(seconds: number, phase: number, stillMotion: boolean): number {
  if (stillMotion) return 0;
  return Math.sin((seconds / LANTERN_BOB_SECONDS) * Math.PI * 2 + phase) * LANTERN_BOB_HEIGHT;
}
