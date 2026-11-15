import type { ChickNurse } from "./chick-nurse";
import type { NavGrid, Point } from "./movement";
import { stepAlong } from "./movement";
import type { Placement } from "../../shared/ward-layout";
import { guideSpot } from "../ui/onboarding-rules";

/**
 * 첫 안내 동안 병아리 간호사 한 명이 카운터에서 나와 나를 따라다니는 연출이에요.
 * 내 화면에서만 움직여요. 간호사는 원래 화면마다 그리는 배치물이라 서버 위치가 없고, 다른 분 화면의 간호사는 그대로예요.
 */
export interface NurseGuide {
  /** 나에게 다가와 따라다녀요. */
  follow(): void;
  /** 원래 자리로 돌아가 원래 방향을 봐요. */
  goHome(): void;
  /** 매 프레임 불러요. me는 내 걸음 위치, right는 화면 오른쪽(카메라 오른쪽)의 바닥 방향이에요. */
  update(dt: number, me: Point, right: Point, stillMotion: boolean): void;
}

/** 걷는 빠르기(m/s)예요. 가까이서는 사람보다 조금 느긋해요. */
const WALK_SPEED = 2.1;
/** 남은 길이 이보다 길면 종종걸음으로 서둘러 와요. 카운터에서 바깥까지 30m 가까이 돼서예요. */
const HURRY_DISTANCE = 5;
const HURRY_SPEED = 5;
/** 내가 이만큼 움직이면 길을 다시 찾아요. */
const REPATH_DISTANCE = 0.6;
/** 길을 너무 자주 찾지 않게 쉬는 시간이에요. */
const REPATH_SECONDS = 0.4;
/** 통통 튀는 높이와 빠르기예요. 움직임 줄이기면 튀지 않아요. */
const HOP_HEIGHT = 0.05;
const HOP_RATE = 11;
/** 몸을 돌리는 빠르기(rad/s)예요. */
const TURN_SPEED = 7;

/** 두 방향의 차이를 -π~π로 줄여요. */
function angleGap(from: number, to: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** 가장 가까운 쪽으로 돌아요. */
function turnToward(current: number, target: number, maxStep: number): number {
  const diff = angleGap(current, target);
  return current + Math.max(-maxStep, Math.min(maxStep, diff));
}

/** rotationY 0이 +z 쪽이에요. */
const yawToward = (from: Point, to: Point): number => Math.atan2(to.x - from.x, to.z - from.z);

export function createNurseGuide(nurse: ChickNurse, nav: NavGrid, home: Placement): NurseGuide {
  type Mode = "home" | "follow" | "return";
  let mode: Mode = "home";
  let position: Point = { x: home.x, z: home.z };
  let path: Point[] = [];
  let goal: Point | null = null;
  let repathWait = 0;
  let hop = 0;

  /** 카운터 안쪽처럼 길찾기가 막힌 자리에서는 가장 가까운 빈 곳부터 걸어요. */
  const route = (to: Point): Point[] => {
    const start = nav.isFree(position) ? position : nav.nearestFree(position);
    const end = nav.nearestFree(to);
    if (!start || !end) return [to];
    const lead = start === position ? [] : [start];
    const found = nav.findPath(start, end);
    // 길이 없으면 곧장 가요. 간호사는 다른 사람과 부딪히지 않는 연출이에요.
    return [...lead, ...(found.length > 0 ? found : [end])];
  };

  const place = (stillMotion: boolean, walking: boolean, dt: number): void => {
    nurse.root.position.x = position.x;
    nurse.root.position.z = position.z;
    if (walking && !stillMotion) {
      hop += dt * HOP_RATE;
      nurse.root.position.y = Math.abs(Math.sin(hop)) * HOP_HEIGHT;
    } else {
      hop = 0;
      nurse.root.position.y = 0;
    }
  };

  return {
    follow() {
      mode = "follow";
      goal = null;
      repathWait = 0;
    },
    goHome() {
      if (mode === "home") return;
      mode = "return";
      path = [...route(home), { x: home.x, z: home.z }];
    },
    update(dt, me, right, stillMotion) {
      if (mode === "home") return;
      if (mode === "follow") {
        repathWait -= dt;
        const spot = guideSpot(me, right);
        const moved = goal === null || Math.hypot(spot.x - goal.x, spot.z - goal.z) > REPATH_DISTANCE;
        if (moved && repathWait <= 0) {
          repathWait = REPATH_SECONDS;
          goal = spot;
          path = Math.hypot(spot.x - position.x, spot.z - position.z) > 0.15 ? route(spot) : [];
        }
      }
      const walking = path.length > 0;
      if (walking) {
        const before = position;
        const left = path.reduce((sum, point, index) => {
          const from = index === 0 ? position : path[index - 1];
          return sum + Math.hypot(point.x - from.x, point.z - from.z);
        }, 0);
        const speed = left > HURRY_DISTANCE ? HURRY_SPEED : WALK_SPEED;
        const next = stepAlong(position, path, speed * dt);
        position = next.position;
        path = next.path;
        if (Math.hypot(position.x - before.x, position.z - before.z) > 1e-4) {
          nurse.root.rotation.y = turnToward(nurse.root.rotation.y, yawToward(before, position), TURN_SPEED * dt);
        }
      } else if (mode === "follow") {
        // 서 있을 때는 나를 바라봐요.
        nurse.root.rotation.y = turnToward(nurse.root.rotation.y, yawToward(position, me), TURN_SPEED * dt);
      } else if (mode === "return") {
        nurse.root.rotation.y = turnToward(nurse.root.rotation.y, home.rotationY, TURN_SPEED * dt);
        if (Math.abs(angleGap(nurse.root.rotation.y, home.rotationY)) < 0.01) {
          nurse.root.rotation.y = home.rotationY;
          mode = "home";
        }
      }
      place(stillMotion, walking, dt);
    },
  };
}
