import { Vector3 } from "three";
import type { Camera, Object3D } from "three";
import { pickBox } from "../ward/camera-view";
import { blessingText } from "../../shared/gestures";
import type { Guest, WardEvent } from "../../shared/protocol";
import {
  bedApproach,
  bedHeadSpot,
  bedRest,
  bedRestYaw,
  BEDS,
  roomAt,
  seatApproach,
  seatRest,
  seatYaw,
  WALL_BOXES,
} from "../../shared/ward-layout";
import { createAvatar } from "../avatar/avatar";
import type { Avatar } from "../avatar/avatar";
import { HAND_HEIGHT, HAND_REACH, HEAD_CENTER_Y } from "../avatar/kit";
import {
  advanceBreath,
  BED_TRANSITION_SECONDS,
  composePose,
  createPose,
  gestureDuration,
  STRIDE_LENGTH,
} from "../avatar/pose";
import type { Gesture, Pose } from "../avatar/pose";
import { createCompanion } from "../cat/companion";
import type { Companion } from "../cat/companion";
import { LIGHT_DELAY_SECONDS } from "../ui/action-bar";
import { createHeadLabels } from "../ui/head-labels";
import type { HeadLabels } from "../ui/head-labels";
import {
  arrivedAtBed,
  bedProgress,
  canStartGesture,
  FREE,
  getUp,
  tapBed,
  tapFloor,
  tickFlow,
} from "../ward/bed-flow";
import type { BedFlow, FlowStep, WalkOrder } from "../ward/bed-flow";
import { arrivedAtSeat, headToSeat, isSeated, NO_SEAT, rise, seatInUse, seatProgress, tickSeat } from "../ward/seat-flow";
import type { SeatFlow } from "../ward/seat-flow";
import { turnToward } from "../ward/camera-view";
import type { NavGrid, Point } from "../ward/movement";
import { stepAlong } from "../ward/movement";
import type { Offerings } from "../ward/offerings";

import { simpleAvatarAt } from "../ward/quality";
import { rosterAction } from "./roster";
import type { Quality } from "../ward/quality";
import type { LanternSink } from "../ward/lantern-rules";

const WALK_SPEED = 1.8;
const BODY_TURN_RATE = 10;
const WALK_BLEND_RATE = 9;
/** 이보다 먼 사람은 그리지 않아요. 휴대폰에서 버벅이지 않게 해요. */
const DRAW_DISTANCE = 15;
/** 다른 동물을 누를 때 맞았다고 보는 상자 크기예요. 휴대폰 손가락으로도 맞히기 쉽게 넉넉히 잡아요. */
export const GUEST_TAP_HALF = 0.5;
const GUEST_TAP_HEIGHT = 1.2;
/** 빛이 날아가 닿는 얼굴 높이예요. */
const HEAD_HEIGHT = HEAD_CENTER_Y;

interface Spot {
  x: number;
  y: number;
  z: number;
}

interface Remote {
  guest: Guest;
  avatar: Avatar;
  companion: Companion;
  label: HeadLabels;
  pose: Pose;
  flow: BedFlow;
  seat: SeatFlow;
  /** 벤치에서 다 일어난 뒤 할 일이에요. */
  afterRise: (() => void) | null;
  position: Point;
  path: Point[];
  yaw: number;
  yawGoal: number | null;
  walkPhase: number;
  walkWeight: number;
  /** 사람마다 숨 위상을 달리해서 다 같이 숨쉬지 않게 해요. */
  breathPhase: number;
  gesture: Gesture | null;
  gestureElapsed: number;
  /** 일어나는 중에 받은 동작은 다 일어난 뒤에 해요. */
  queued: (() => void) | null;
  /** 손을 모은 뒤 빛을 보낼 곳이에요. */
  light: { left: number; to: Spot } | null;
  /** 걸어서 도착한 뒤 할 일이에요. 안아 주러 갈 때 써요. */
  afterWalk: (() => void) | null;
  /** 잠시 뒤에 할 일이에요. 안기는 사람이 상대가 다가오길 기다릴 때 써요. */
  delayed: { left: number; action: () => void } | null;
  shownX: number;
  shownZ: number;
  visible: boolean;
  /** 멀어서 몸만 그리는 중이에요. */
  simple: boolean;
}

export interface RemoteGuests {
  readonly count: number;
  /** 들어올 때 받은 사람들로 다시 채워요. 나는 빼요. */
  reset(guests: readonly Guest[], me: string): void;
  apply(event: WardEvent): void;
  update(dt: number, viewer: Point, camera: Camera, stillMotion: boolean): void;
  /** 가볍게 보기에서는 먼 동물을 몸만 그려요. */
  setQuality(quality: Quality): void;
  isBedTaken(bed: number): boolean;
  /** 이 침대를 배정받은 사람이에요. 그 사람이 걸어 다녀도 그 사람 것이에요. */
  ownerOfBed(bed: number): Guest | null;
  /** 다른 분이 앉아 있거나 앉으러 가는 벤치 자리인지예요. */
  isSeatTaken(seat: number): boolean;
  othersInRoom(roomIndex: number): boolean;
  handSpot(id: string): Spot | null;
  headSpot(id: string): Spot | null;
  /** 지금 침대에 누운 사람 수예요. 소등 안내에 써요. */
  lyingCount(): number;
  /** 보이는 사람과 곁의 고양이마다 머리 위 등불 자리를 알려 줘요. */
  lanterns(sink: LanternSink): void;
  /** 그 사람이 누워 있거나 눕는 중인 침대예요. 서 있으면 null이에요. */
  bedOf(id: string): number | null;
  /** 이 평안 주소의 사람이 지금 같은 병실에 있으면 그 사람의 공개 id예요. */
  idForAddress(address: string): string | null;
  /** 지금 함께 있는 사람들이에요. 오늘 만난 사람 목록에 더할 때 써요. */
  guests(): Guest[];
  /** 누른 곳에 다른 동물이 있으면 그 사람이에요. 벽에 가리면 null이에요. */
  tap(origin: Vector3, reach: Vector3): Guest | null;
  /** 걸어 다니는 자리예요. 누워 있으면 침대 곁 자리예요. */
  position(id: string): Point | null;
  /** 안아 주러 다가가요. 도착하면 상대를 보고 안아요. low면 침대 옆에서 몸을 낮춰요. */
  hugTo(id: string, spot: Point, face: Point, low: boolean): void;
  /** 다가오는 사람을 delay초 뒤에 마주 안아요. 누워 있으면 그대로 누운 채예요. */
  hugBack(id: string, face: Point, delay: number): void;
}

/** 같은 병동의 다른 사람들이에요. 걷는 모습은 목적지만 받아 각자 화면에서 그려요. */
export function createRemoteGuests(
  parent: Object3D,
  nav: NavGrid,
  labelsRoot: HTMLElement | null,
  offerings: Offerings,
  myHead: () => Spot,
): RemoteGuests {
  const remotes = new Map<string, Remote>();
  const headPoint = new Vector3();
  const lanternPoint = new Vector3();

  const handOf = (remote: Remote): Spot => ({
    x: remote.shownX + Math.sin(remote.yaw) * HAND_REACH * remote.avatar.size,
    y: HAND_HEIGHT * remote.avatar.size,
    z: remote.shownZ + Math.cos(remote.yaw) * HAND_REACH * remote.avatar.size,
  });

  const riseThen = (remote: Remote, then: (() => void) | null): void => {
    remote.seat = rise(remote.seat, BED_TRANSITION_SECONDS);
    remote.afterRise = then;
  };

  /** 정해진 곳으로 걸어가요. 벤치에 앉아 있으면 먼저 일어나요. seat가 있으면 그 자리에 앉으러 가는 길이에요. */
  const startWalk = (remote: Remote, order: WalkOrder, seat?: number): void => {
    if (isSeated(remote.seat)) {
      riseThen(remote, () => startWalk(remote, order, seat));
      return;
    }
    remote.seat = NO_SEAT;
    const spot = order.kind === "bed" ? bedApproach(BEDS[order.bed]) : order.point;
    const goal = nav.nearestFree(spot);
    const path = goal ? nav.findPath(remote.position, goal) : [];
    if (!goal || path.length === 0) {
      // 길을 못 찾으면 그 자리로 옮겨 놓아요. 서버가 정한 자리를 따라야 해서예요.
      remote.position = { x: spot.x, z: spot.z };
      remote.path = [];
      if (remote.flow.kind === "heading") applyStep(remote, arrivedAtBed(remote.flow, true));
      if (seat !== undefined) sitNow(remote, seat);
      return;
    }
    remote.path = path;
    remote.gesture = null;
    if (seat !== undefined) remote.seat = headToSeat(seat);
  };

  const sitNow = (remote: Remote, seat: number): void => {
    remote.seat = arrivedAtSeat(headToSeat(seat));
    remote.yawGoal = seatYaw(seat);
  };

  /** 벤치 자리로 가서 앉아요. 누워 있거나 다른 자리에 앉아 있으면 먼저 일어나요. */
  const goToSeat = (remote: Remote, seat: number): void => {
    if (isSeated(remote.seat)) {
      if (seatInUse(remote.seat) === seat) return;
      riseThen(remote, () => goToSeat(remote, seat));
      return;
    }
    if (!canStartGesture(remote.flow)) {
      if (remote.flow.kind === "leaving") remote.flow = { ...remote.flow, next: null };
      remote.queued = () => goToSeat(remote, seat);
      applyStep(remote, getUp(remote.flow, BED_TRANSITION_SECONDS));
      return;
    }
    remote.flow = FREE;
    remote.afterWalk = null;
    const spot = seatApproach(seat);
    if (Math.hypot(spot.x - remote.position.x, spot.z - remote.position.z) < 0.15) {
      remote.path = [];
      sitNow(remote, seat);
      return;
    }
    startWalk(remote, { kind: "spot", point: spot }, seat);
  };

  /** 벤치에서 일어나요. 앉으러 가던 중이면 그 자리에 멈춰요. */
  const standRemote = (remote: Remote): void => {
    if (remote.seat.kind === "heading") {
      remote.seat = NO_SEAT;
      remote.path = [];
    } else if (isSeated(remote.seat) && remote.seat.kind !== "rising") {
      riseThen(remote, null);
    }
  };

  const applyStep = (remote: Remote, step: FlowStep): void => {
    remote.flow = step.flow;
    if (step.walk) startWalk(remote, step.walk);
  };

  const add = (guest: Guest): void => {
    remove(guest.id);
    const avatar = createAvatar({ species: guest.animal, outfit: guest.outfit });
    parent.add(avatar.root);
    const companion = createCompanion(parent);
    const element = document.createElement("div");
    labelsRoot?.append(element);
    const label = createHeadLabels(element);
    label.setName(guest.nickname);
    // 누워 있는 사람은 침대 곁 자리에서 바로 누운 모습으로 시작해요. 벤치에 앉은 사람도 앉은 모습이에요.
    const lying = guest.bed !== null && guest.lying && guest.outfit === "patient";
    const sitting = !lying && guest.bench !== null;
    const start = lying
      ? bedApproach(BEDS[guest.bed as number])
      : sitting
        ? seatApproach(guest.bench as number)
        : { x: guest.x, z: guest.z };
    const remote: Remote = {
      guest,
      avatar,
      companion,
      label,
      pose: createPose(),
      flow: lying ? { kind: "lying", bed: guest.bed as number } : FREE,
      seat: sitting ? { kind: "sitting", seat: guest.bench as number } : NO_SEAT,
      afterRise: null,
      position: { x: start.x, z: start.z },
      path: [],
      yaw: sitting ? seatYaw(guest.bench as number) : Math.PI,
      yawGoal: null,
      walkPhase: 0,
      breathPhase: Math.random() * Math.PI * 2,
      walkWeight: 0,
      gesture: null,
      gestureElapsed: 0,
      queued: null,
      light: null,
      afterWalk: null,
      delayed: null,
      shownX: start.x,
      shownZ: start.z,
      visible: true,
      simple: false,
    };
    companion.setEnabled(guest.withCat, { walkX: start.x, walkZ: start.z, lyingBed: null });
    remotes.set(guest.id, remote);
  };

  const remove = (id: string): void => {
    const remote = remotes.get(id);
    if (!remote) return;
    parent.remove(remote.avatar.root);
    remote.companion.dispose();
    remote.label.dispose();
    remotes.delete(id);
  };

  /** 서 있을 때 하거나, 일어나는 중이면 다 일어난 뒤에 해요. */
  const whenStanding = (remote: Remote, action: () => void): void => {
    if (canStartGesture(remote.flow)) {
      action();
      return;
    }
    remote.queued = action;
    applyStep(remote, getUp(remote.flow, BED_TRANSITION_SECONDS));
  };

  const play = (remote: Remote, gesture: Gesture): void => {
    // 벤치로 가던 중이면 바로 앉은 채로 해요. 서버는 이미 앉은 줄 알아요.
    if (remote.seat.kind === "heading") {
      remote.position = seatApproach(remote.seat.seat);
      sitNow(remote, remote.seat.seat);
    }
    remote.flow = FREE;
    remote.path = [];
    remote.gesture = gesture;
    remote.gestureElapsed = 0;
  };

  const lightTarget = (event: Extract<WardEvent, { kind: "bless" }>, me: string | null): Spot | null => {
    if (event.bedId !== null) return bedHeadSpot(BEDS[event.bedId]);
    if (event.targetId === null) return null;
    if (event.targetId === me) return myHead();
    const target = remotes.get(event.targetId);
    return target ? { x: target.shownX, y: HEAD_HEIGHT * target.avatar.size, z: target.shownZ } : null;
  };

  let myId: string | null = null;
  let quality: Quality = "normal";

  return {
    get count() {
      return remotes.size;
    },
    setQuality(next) {
      quality = next;
    },
    reset(guests, me) {
      myId = me;
      for (const id of [...remotes.keys()]) remove(id);
      for (const guest of guests) if (guest.id !== me) add(guest);
    },
    apply(event) {
      const action = rosterAction(event, (id) => remotes.has(id), myId);
      if (action === "ignore") return;
      if (action === "add") {
        // join을 놓쳤어도 update가 오면 새로 그려요.
        if (event.kind === "join" || event.kind === "update") add(event.guest);
        return;
      }
      if (action === "remove") {
        if (event.kind === "leave") remove(event.id);
        return;
      }
      if (event.kind === "join" || event.kind === "leave") return;
      const remote = remotes.get(event.kind === "update" ? event.guest.id : (event as { id: string }).id);
      if (!remote) return;

      switch (event.kind) {
        case "update": {
          remote.guest = event.guest;
          remote.avatar.setChoice({ species: event.guest.animal, outfit: event.guest.outfit });
          remote.label.setName(event.guest.nickname);
          remote.companion.setEnabled(event.guest.withCat, {
            walkX: remote.position.x,
            walkZ: remote.position.z,
            lyingBed: null,
          });
          // 앉고 일어나는 event를 놓쳤어도 서버가 아는 대로 맞춰요.
          if (event.guest.bench === null && seatInUse(remote.seat) !== null) standRemote(remote);
          else if (event.guest.bench !== null && seatInUse(remote.seat) !== event.guest.bench) goToSeat(remote, event.guest.bench);
          const lyingNow = event.guest.bed !== null && event.guest.lying;
          if (!lyingNow && remote.flow.kind !== "free") {
            applyStep(remote, getUp(remote.flow, BED_TRANSITION_SECONDS));
          } else if (lyingNow && event.guest.bed !== null && event.guest.outfit === "patient" && remote.flow.kind === "free") {
            // 눕는 event를 놓쳤어도 서버가 아는 침대로 가서 누워요.
            applyStep(remote, tapBed(remote.flow, event.guest.bed, { canLie: true, isFree: true }, BED_TRANSITION_SECONDS));
          }
          return;
        }
        case "sit":
          remote.guest = { ...remote.guest, lying: false, bench: event.seat };
          remote.afterWalk = null;
          goToSeat(remote, event.seat);
          return;
        case "stand":
          remote.guest = { ...remote.guest, bench: null };
          standRemote(remote);
          return;
        case "walk":
          // 걸어가면 침대나 벤치에서 내려오지만 침대는 그대로 그 사람 것이에요. 이름표도 그대로예요.
          remote.guest = { ...remote.guest, lying: false, bench: null };
          remote.afterWalk = null;
          applyStep(remote, tapFloor(remote.flow, { x: event.x, z: event.z }, BED_TRANSITION_SECONDS));
          return;
        case "lie":
          remote.guest = { ...remote.guest, bed: event.bedId, lying: true, bench: null };
          applyStep(remote, tapBed(remote.flow, event.bedId, { canLie: true, isFree: true }, BED_TRANSITION_SECONDS));
          return;
        case "bed-claimed":
          // 침대를 새로 받았어요(처음 고르거나 옮겼어요). 눕는 것은 lie가 따로 와요.
          remote.guest = { ...remote.guest, bed: event.bedId, lying: false };
          return;
        case "bed-released":
          remote.guest = { ...remote.guest, bed: null, lying: false };
          if (remote.flow.kind === "heading") {
            remote.flow = FREE;
            remote.path = [];
          } else if (remote.flow.kind !== "free") {
            applyStep(remote, getUp(remote.flow, BED_TRANSITION_SECONDS));
          }
          return;
        case "get-up":
          remote.guest = { ...remote.guest, lying: false };
          if (remote.flow.kind === "heading") {
            remote.flow = FREE;
            remote.path = [];
          } else {
            applyStep(remote, getUp(remote.flow, BED_TRANSITION_SECONDS));
          }
          return;
        case "bow":
          whenStanding(remote, () => {
            play(remote, "bow");
            const text = blessingText(event.phrase);
            if (text) remote.label.showBubble(text);
          });
          return;
        case "bless": {
          const to = lightTarget(event, myId);
          whenStanding(remote, () => {
            if (to) remote.yawGoal = Math.atan2(to.x - remote.position.x, to.z - remote.position.z);
            play(remote, "pray");
            if (to) remote.light = { left: LIGHT_DELAY_SECONDS, to };
          });
          return;
        }
      }
    },
    update(dt, viewer, camera, stillMotion) {
      for (const remote of remotes.values()) {
        applyStep(remote, tickFlow(remote.flow, stillMotion ? BED_TRANSITION_SECONDS : dt, BED_TRANSITION_SECONDS));
        const seatStep = tickSeat(remote.seat, stillMotion ? BED_TRANSITION_SECONDS : dt, BED_TRANSITION_SECONDS);
        remote.seat = seatStep.flow;
        if (seatStep.stood && remote.afterRise) {
          const action = remote.afterRise;
          remote.afterRise = null;
          action();
        }
        if (remote.queued && remote.flow.kind === "free") {
          const action = remote.queued;
          remote.queued = null;
          action();
        }

        let walking = false;
        if (remote.path.length > 0) {
          const step = stepAlong(remote.position, remote.path, WALK_SPEED * dt);
          const dx = step.position.x - remote.position.x;
          const dz = step.position.z - remote.position.z;
          remote.position = step.position;
          remote.path = step.path;
          const walked = Math.hypot(dx, dz);
          if (walked > 0) {
            walking = true;
            remote.yawGoal = Math.atan2(dx, dz);
            remote.walkPhase += (walked / STRIDE_LENGTH) * Math.PI * 2;
          }
          if (remote.path.length === 0 && remote.flow.kind === "heading") {
            applyStep(remote, arrivedAtBed(remote.flow, true));
          }
          if (remote.path.length === 0 && remote.seat.kind === "heading") sitNow(remote, remote.seat.seat);
          if (remote.path.length === 0 && remote.afterWalk) {
            const action = remote.afterWalk;
            remote.afterWalk = null;
            action();
          }
        }
        if (remote.delayed) {
          remote.delayed.left -= dt;
          if (remote.delayed.left <= 0) {
            const action = remote.delayed.action;
            remote.delayed = null;
            action();
          }
        }
        if (remote.yawGoal !== null) {
          remote.yaw = turnToward(remote.yaw, remote.yawGoal, 1 - Math.exp(-dt * BODY_TURN_RATE));
        }
        if (remote.gesture) {
          remote.gestureElapsed += dt;
          if (remote.gestureElapsed >= gestureDuration(remote.gesture)) remote.gesture = null;
        }
        if (remote.light) {
          remote.light.left -= dt;
          if (remote.light.left <= 0) {
            offerings.sendLight(handOf(remote), remote.light.to, stillMotion);
            remote.light = null;
          }
        }

        const progress = bedProgress(remote.flow, BED_TRANSITION_SECONDS);
        remote.breathPhase = advanceBreath(remote.breathPhase, dt, stillMotion);
        composePose(remote.pose, {
          walkPhase: remote.walkPhase,
          breathPhase: remote.breathPhase,
          walkWeight: (remote.walkWeight += ((walking && !stillMotion ? 1 : 0) - remote.walkWeight) * (1 - Math.exp(-dt * WALK_BLEND_RATE))),
          gesture: remote.gesture,
          gestureElapsed: remote.gestureElapsed,
          bedProgress: progress,
          seatProgress: seatProgress(remote.seat, BED_TRANSITION_SECONDS),
          carrying: remote.guest.outfit === "visitor",
        });

        let x = remote.position.x;
        let z = remote.position.z;
        let yaw = remote.yaw;
        const flow = remote.flow;
        if (flow.kind === "entering" || flow.kind === "lying" || flow.kind === "leaving") {
          const bed = BEDS[flow.bed];
          const rest = bedRest(bed);
          x += (rest.x - x) * remote.pose.bedTravel;
          z += (rest.z - z) * remote.pose.bedTravel;
          yaw = turnToward(yaw, bedRestYaw(bed), remote.pose.bedTurn);
        }
        const seat = remote.seat;
        if (isSeated(seat) && seat.kind !== "none") {
          const rest = seatRest(seat.seat);
          x += (rest.x - x) * remote.pose.seatTravel;
          z += (rest.z - z) * remote.pose.seatTravel;
          yaw = turnToward(yaw, seatYaw(seat.seat), remote.pose.seatTurn);
        }
        remote.shownX = x;
        remote.shownZ = z;

        const distance = Math.hypot(x - viewer.x, z - viewer.z);
        const visible = distance < DRAW_DISTANCE;
        const simple = simpleAvatarAt(quality, distance);
        if (visible !== remote.visible || simple !== remote.simple) {
          remote.visible = visible;
          remote.simple = simple;
          remote.avatar.root.visible = visible;
          remote.avatar.setSimple(simple);
          // 멀리서 몸만 그릴 때는 곁의 고양이도 쉬어요.
          remote.companion.setVisible(visible && !simple);
        }
        remote.companion.update(
          dt,
          { walkX: remote.position.x, walkZ: remote.position.z, lyingBed: flow.kind === "lying" ? flow.bed : null },
          stillMotion,
          false,
        );
        if (visible) {
          remote.avatar.place(x, z, yaw);
          remote.avatar.apply(remote.pose);
        }
        remote.label.update(dt, camera, visible ? remote.avatar.headWorld(headPoint) : null);
      }
    },
    ownerOfBed(bed) {
      for (const remote of remotes.values()) {
        if (remote.guest.bed === bed && remote.guest.outfit === "patient") return remote.guest;
      }
      return null;
    },
    isSeatTaken(seat) {
      for (const remote of remotes.values()) {
        if (remote.guest.bench === seat || seatInUse(remote.seat) === seat) return true;
      }
      return false;
    },
    isBedTaken(bed) {
      for (const remote of remotes.values()) {
        const flow = remote.flow;
        if ((flow.kind === "heading" && flow.lie) || flow.kind === "entering" || flow.kind === "lying") {
          if (flow.bed === bed) return true;
        }
      }
      return false;
    },
    othersInRoom(roomIndex) {
      for (const remote of remotes.values()) {
        if (roomAt(remote.position.x, remote.position.z)?.index === roomIndex) return true;
      }
      return false;
    },
    handSpot(id) {
      const remote = remotes.get(id);
      return remote ? handOf(remote) : null;
    },
    headSpot(id) {
      const remote = remotes.get(id);
      return remote ? { x: remote.shownX, y: HEAD_HEIGHT * remote.avatar.size, z: remote.shownZ } : null;
    },
    lanterns(sink) {
      for (const remote of remotes.values()) {
        if (remote.visible) sink(remote, lanternPoint, remote.avatar.lanternWorld(lanternPoint));
        const cat = remote.companion.view;
        if (cat.root.visible) sink(remote.companion, lanternPoint, cat.lanternWorld(lanternPoint));
      }
    },
    lyingCount() {
      let count = 0;
      for (const remote of remotes.values()) if (remote.flow.kind === "lying" || remote.flow.kind === "entering") count++;
      return count;
    },
    bedOf(id) {
      const flow = remotes.get(id)?.flow;
      if (!flow) return null;
      return flow.kind === "lying" || flow.kind === "entering" || (flow.kind === "heading" && flow.lie) ? flow.bed : null;
    },
    idForAddress(address) {
      for (const [id, remote] of remotes) if (remote.guest.address === address) return id;
      return null;
    },
    guests() {
      return [...remotes.values()].map((remote) => remote.guest);
    },
    position(id) {
      const remote = remotes.get(id);
      return remote ? { x: remote.position.x, z: remote.position.z } : null;
    },
    hugTo(id, spot, face, low) {
      const remote = remotes.get(id);
      if (!remote) return;
      const embrace = (): void => {
        remote.yawGoal = Math.atan2(face.x - remote.position.x, face.z - remote.position.z);
        play(remote, low ? "hug-low" : "hug");
      };
      const go = (): void => {
        startWalk(remote, { kind: "spot", point: spot });
        if (remote.path.length === 0) embrace();
        else remote.afterWalk = embrace;
      };
      // 벤치에 앉아 있었으면 일어난 뒤에 다가가요.
      whenStanding(remote, () => (isSeated(remote.seat) ? riseThen(remote, go) : go()));
    },
    hugBack(id, face, delay) {
      const remote = remotes.get(id);
      if (!remote || remote.flow.kind !== "free") return;
      remote.delayed = {
        left: delay,
        action: () => {
          if (remote.flow.kind !== "free" || isSeated(remote.seat)) return;
          remote.yawGoal = Math.atan2(face.x - remote.position.x, face.z - remote.position.z);
          play(remote, "hug");
        },
      };
    },
    tap(origin, reach) {
      const shown = [...remotes.values()].filter((remote) => remote.visible);
      const boxes = shown.map((remote) => ({
        minX: remote.shownX - GUEST_TAP_HALF,
        maxX: remote.shownX + GUEST_TAP_HALF,
        minZ: remote.shownZ - GUEST_TAP_HALF,
        maxZ: remote.shownZ + GUEST_TAP_HALF,
        minY: 0,
        maxY: GUEST_TAP_HEIGHT,
      }));
      const picked = pickBox(origin, reach, boxes, WALL_BOXES);
      return picked === null ? null : shown[picked].guest;
    },
  };
}
