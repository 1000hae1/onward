import { Group, Mesh, Object3D } from "three";
import type { Vector3 } from "three";
import { ARM_REACH, ARM_Y, FOOT_X, getAvatarKit, getAvatarMaterial, HEAD_CENTER_Y } from "./kit";
import type { Pose } from "./pose";
import { speciesById } from "./species";
import type { AvatarChoice } from "./species";
import { EGG_DEPTH, eggRadius, eggY } from "./egg";

/** 이불 위에 올라선 높이예요. */
const BED_STAND_Y = 0.62;
/**
 * 누울 때 뒤로 기대는 각도예요. 달걀 몸은 완전히 누우면 발치에서 얼굴이 가려져서,
 * 등받이를 세운 병원 침대처럼 비스듬히 기대고 머리를 베개 쪽에 둬요.
 */
export const LYING_PITCH = -0.75;
/** 이불에 살짝 묻히는 깊이예요. */
const BED_SINK = 0.015;

/** 기댄 몸의 가장 낮은 곳(등과 엉덩이)이 이불에 닿도록 올리는 높이예요. */
export function lyingRaise(pitch: number): number {
  let lowest = 0;
  for (let theta = 0; theta <= Math.PI; theta += 0.02) {
    const backZ = -eggRadius(theta) * EGG_DEPTH;
    lowest = Math.min(lowest, eggY(theta) * Math.cos(pitch) - backZ * Math.sin(pitch));
  }
  return -lowest - BED_SINK;
}

const BED_LIE_RAISE = lyingRaise(LYING_PITCH);

export interface Avatar {
  readonly root: Group;
  setChoice(choice: AvatarChoice): void;
  /** 자리와 방향을 정해요. rotationY 0은 +z 쪽을 봐요. */
  place(x: number, z: number, yaw: number): void;
  apply(pose: Pose): void;
  /** 얼굴 가운데가 있는 곳을 target에 써요. */
  headWorld(target: Vector3): Vector3;
}

/**
 * 달걀 몸 아바타예요. 지오메트리와 재질은 kit.ts의 것을 함께 써요.
 * root(자리) → base(침대에 오르고 눕기) → 발 둘, shell(뒤뚱, 숙이기) → squash(숨쉬기) → 몸과 팔이에요.
 */
export function createAvatar(choice: AvatarChoice): Avatar {
  const material = getAvatarMaterial();
  const lookOf = (next: AvatarChoice) => getAvatarKit(speciesById(next.species), next.outfit);
  const kit = lookOf(choice);

  const body = new Mesh(kit.body, material);
  const armLeft = new Mesh(kit.arm, material);
  const armRight = new Mesh(kit.armRight, material);
  const footLeft = new Mesh(kit.foot, material);
  const footRight = new Mesh(kit.foot, material);

  const root = new Group();
  const base = new Group();
  const shell = new Group();
  const squash = new Group();
  const armPivotLeft = new Group();
  const armPivotRight = new Group();
  const head = new Object3D();

  root.add(base);
  base.add(shell, footLeft, footRight);
  shell.add(squash);
  squash.add(body, armPivotLeft, armPivotRight, head);
  armPivotLeft.add(armLeft);
  armPivotRight.add(armRight);

  // 뒤뚱거림을 먼저, 숙이기를 다음에, 비틀기를 마지막에 돌려요.
  shell.rotation.order = "YXZ";
  armPivotLeft.position.y = ARM_Y;
  armPivotRight.position.y = ARM_Y;
  armLeft.position.x = -ARM_REACH;
  armRight.position.x = ARM_REACH;
  // 오른팔은 왼팔 도형을 거울처럼 뒤집어 그려요.
  armRight.scale.x = -1;
  footLeft.position.x = -FOOT_X;
  footRight.position.x = FOOT_X;
  head.position.y = HEAD_CENTER_Y;

  return {
    root,
    setChoice(next) {
      const look = lookOf(next);
      body.geometry = look.body;
      armLeft.geometry = look.arm;
      armRight.geometry = look.armRight;
      footLeft.geometry = look.foot;
      footRight.geometry = look.foot;
    },
    place(x, z, yaw) {
      root.position.x = x;
      root.position.z = z;
      root.rotation.y = yaw;
    },
    headWorld(target) {
      return head.getWorldPosition(target);
    },
    apply(pose) {
      base.position.y = pose.bedLift * BED_STAND_Y + pose.bedLie * BED_LIE_RAISE;
      base.rotation.x = pose.bedLie * LYING_PITCH;
      shell.position.y = pose.bob;
      shell.rotation.set(pose.lean, pose.twist, pose.sway);
      squash.scale.set(1 - pose.breathe / 2, 1 + pose.breathe, 1 - pose.breathe / 2);
      // 왼팔은 +각도, 오른팔은 -각도로 돌아야 둘 다 앞으로 와요.
      armPivotLeft.rotation.y = pose.armLeftSwing;
      armPivotRight.rotation.y = -pose.armRightSwing;
      armLeft.position.y = pose.armLeftLift;
      armRight.position.y = pose.armRightLift;
      footLeft.position.y = pose.footLeftLift;
      footRight.position.y = pose.footRightLift;
      footLeft.position.z = pose.footLeftStep;
      footRight.position.z = pose.footRightStep;
    },
  };
}
