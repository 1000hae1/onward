import { Vector3 } from "three";
import type { Camera, Object3D } from "three";
import { blessingText } from "../../shared/gestures";
import type { Guest, WardEvent } from "../../shared/protocol";
import { bedApproach, bedHeadSpot, bedRest, bedRestYaw, BEDS, roomAt } from "../../shared/ward-layout";
import { createAvatar } from "../avatar/avatar";
import type { Avatar } from "../avatar/avatar";
import {
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
import { turnToward } from "../ward/camera-view";
import type { NavGrid, Point } from "../ward/movement";
import { stepAlong } from "../ward/movement";
import type { Offerings } from "../ward/offerings";

const WALK_SPEED = 1.8;
const BODY_TURN_RATE = 10;
const WALK_BLEND_RATE = 9;
/** 이보다 먼 사람은 그리지 않아요. 휴대폰에서 버벅이지 않게 해요. */
const DRAW_DISTANCE = 15;
const HAND_REACH = 0.22;
const HAND_HEIGHT = 0.62;
const HEAD_HEIGHT = 1.0;

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
  position: Point;
  path: Point[];
  yaw: number;
  yawGoal: number | null;
  walkPhase: number;
  walkWeight: number;
  gesture: Gesture | null;
  gestureElapsed: number;
  /** 일어나는 중에 받은 동작은 다 일어난 뒤에 해요. */
  queued: (() => void) | null;
  /** 손을 모은 뒤 빛을 보낼 곳이에요. */
  light: { left: number; to: Spot } | null;
  shownX: number;
  shownZ: number;
  visible: boolean;
}

export interface RemoteGuests {
  readonly count: number;
  /** 들어올 때 받은 사람들로 다시 채워요. 나는 빼요. */
  reset(guests: readonly Guest[], me: string): void;
  apply(event: WardEvent): void;
  update(dt: number, viewer: Point, camera: Camera, stillMotion: boolean): void;
  isBedTaken(bed: number): boolean;
  othersInRoom(roomIndex: number): boolean;
  handSpot(id: string): Spot | null;
  headSpot(id: string): Spot | null;
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

  const handOf = (remote: Remote): Spot => ({
    x: remote.shownX + Math.sin(remote.yaw) * HAND_REACH,
    y: HAND_HEIGHT,
    z: remote.shownZ + Math.cos(remote.yaw) * HAND_REACH,
  });

  const startWalk = (remote: Remote, order: WalkOrder): void => {
    const spot = order.kind === "bed" ? bedApproach(BEDS[order.bed]) : order.point;
    const goal = nav.nearestFree(spot);
    const path = goal ? nav.findPath(remote.position, goal) : [];
    if (!goal || path.length === 0) {
      // 길을 못 찾으면 그 자리로 옮겨 놓아요. 서버가 정한 자리를 따라야 해서예요.
      remote.position = { x: spot.x, z: spot.z };
      remote.path = [];
      if (remote.flow.kind === "heading") applyStep(remote, arrivedAtBed(remote.flow, true));
      return;
    }
    remote.path = path;
    remote.gesture = null;
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
    // 누워 있는 사람은 침대 곁 자리에서 바로 누운 모습으로 시작해요.
    const lying = guest.bed !== null && guest.outfit === "patient";
    const start = lying ? bedApproach(BEDS[guest.bed as number]) : { x: guest.x, z: guest.z };
    const remote: Remote = {
      guest,
      avatar,
      companion,
      label,
      pose: createPose(),
      flow: lying ? { kind: "lying", bed: guest.bed as number } : FREE,
      position: { x: start.x, z: start.z },
      path: [],
      yaw: Math.PI,
      yawGoal: null,
      walkPhase: 0,
      walkWeight: 0,
      gesture: null,
      gestureElapsed: 0,
      queued: null,
      light: null,
      shownX: start.x,
      shownZ: start.z,
      visible: true,
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
    return target ? { x: target.shownX, y: HEAD_HEIGHT, z: target.shownZ } : null;
  };

  let myId: string | null = null;

  return {
    get count() {
      return remotes.size;
    },
    reset(guests, me) {
      myId = me;
      for (const id of [...remotes.keys()]) remove(id);
      for (const guest of guests) if (guest.id !== me) add(guest);
    },
    apply(event) {
      if (event.kind === "join") {
        if (event.guest.id !== myId) add(event.guest);
        return;
      }
      if (event.kind === "leave") {
        remove(event.id);
        return;
      }
      // 선물과 불빛은 협탁과 창가의 일이라 화면에서 따로 다뤄요.
      if (event.kind === "gift" || event.kind === "lamp" || event.kind === "cat-visit") return;
      const remote = remotes.get(event.kind === "update" ? event.guest.id : event.id);
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
          if (event.guest.bed === null && remote.flow.kind !== "free") {
            applyStep(remote, getUp(remote.flow, BED_TRANSITION_SECONDS));
          }
          return;
        }
        case "walk":
          applyStep(remote, tapFloor(remote.flow, { x: event.x, z: event.z }, BED_TRANSITION_SECONDS));
          return;
        case "lie":
          applyStep(remote, tapBed(remote.flow, event.bedId, { canLie: true, isFree: true }, BED_TRANSITION_SECONDS));
          return;
        case "get-up":
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
        composePose(remote.pose, {
          walkPhase: remote.walkPhase,
          walkWeight: (remote.walkWeight += ((walking && !stillMotion ? 1 : 0) - remote.walkWeight) * (1 - Math.exp(-dt * WALK_BLEND_RATE))),
          gesture: remote.gesture,
          gestureElapsed: remote.gestureElapsed,
          bedProgress: progress,
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
        remote.shownX = x;
        remote.shownZ = z;

        const visible = Math.hypot(x - viewer.x, z - viewer.z) < DRAW_DISTANCE;
        if (visible !== remote.visible) {
          remote.visible = visible;
          remote.avatar.root.visible = visible;
          remote.companion.setVisible(visible);
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
      return remote ? { x: remote.shownX, y: HEAD_HEIGHT, z: remote.shownZ } : null;
    },
  };
}
