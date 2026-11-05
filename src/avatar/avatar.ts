import { Group, Mesh } from "three";
import { getAvatarKit, getAvatarMaterial, HIP_Y, LEG_X, NECK_Y, SHOULDER_X, SHOULDER_Y } from "./kit";
import { CARRY_ARM_PITCH } from "./pose";
import type { Pose } from "./pose";
import { speciesById } from "./species";
import type { AvatarChoice } from "./species";

/** 누웠을 때 엉덩이 관절의 높이예요. 이불 위에 몸이 닿는 높이예요. */
const BED_HIP_Y = 0.805;
/** 머리가 베개에 얹히도록 완전히 눕지 않고 조금 기대요. */
const LYING_PITCH = -Math.PI / 2 + 0.12;

export interface Avatar {
  readonly root: Group;
  setChoice(choice: AvatarChoice): void;
  /** 자리와 방향을 정해요. rotationY 0은 +z 쪽을 봐요. */
  place(x: number, z: number, yaw: number): void;
  apply(pose: Pose): void;
}

/** 관절로 이어진 아바타예요. 지오메트리와 재질은 kit.ts의 것을 함께 써요. */
export function createAvatar(choice: AvatarChoice): Avatar {
  const material = getAvatarMaterial();
  const lookOf = (next: AvatarChoice) =>
    getAvatarKit(speciesById(next.species), next.outfit, CARRY_ARM_PITCH);
  const kit = lookOf(choice);

  const torso = new Mesh(kit.torso, material);
  const head = new Mesh(kit.head, material);
  const armLeft = new Mesh(kit.arm, material);
  const armRight = new Mesh(kit.armRight, material);
  const legLeft = new Mesh(kit.leg, material);
  const legRight = new Mesh(kit.leg, material);

  const root = new Group();
  const hips = new Group();
  hips.position.y = HIP_Y;
  root.add(hips);
  hips.add(torso, legLeft, legRight);
  torso.add(head, armLeft, armRight);

  legLeft.position.x = -LEG_X;
  legRight.position.x = LEG_X;
  armLeft.position.set(-SHOULDER_X, SHOULDER_Y, 0);
  armRight.position.set(SHOULDER_X, SHOULDER_Y, 0);
  head.position.y = NECK_Y;

  return {
    root,
    setChoice(next) {
      const look = lookOf(next);
      torso.geometry = look.torso;
      head.geometry = look.head;
      armLeft.geometry = look.arm;
      armRight.geometry = look.armRight;
      legLeft.geometry = look.leg;
      legRight.geometry = look.leg;
    },
    place(x, z, yaw) {
      root.position.x = x;
      root.position.z = z;
      root.rotation.y = yaw;
    },
    apply(pose) {
      root.position.y = pose.bedLift * (BED_HIP_Y - HIP_Y);
      hips.position.y = HIP_Y + pose.bob;
      hips.rotation.x = pose.bedLie * LYING_PITCH;
      hips.rotation.z = pose.sway;
      torso.rotation.x = pose.lean;
      head.rotation.x = pose.headPitch;
      // 회전 순서가 z 다음 x라서, 팔을 안쪽으로 모은 뒤 앞으로 들어요.
      armLeft.rotation.x = pose.armLeftPitch;
      armLeft.rotation.z = pose.armLeftIn;
      armRight.rotation.x = pose.armRightPitch;
      armRight.rotation.z = -pose.armRightIn;
      legLeft.rotation.x = pose.legLeftPitch;
      legRight.rotation.x = pose.legRightPitch;
    },
  };
}
