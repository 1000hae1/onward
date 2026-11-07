import { Group, Mesh } from "three";
import {
  CAT_BODY_Y,
  CAT_EYE_AT,
  CAT_HEAD_AT,
  CAT_LEG_BACK_Z,
  CAT_LEG_FRONT_Z,
  CAT_LEG_X,
  getCatKit,
  getCatMaterial,
} from "./cat-kit.ts";
import type { CatCoat } from "./cat-kit.ts";
import type { CatPose } from "./cat-pose";

export interface CatView {
  readonly root: Group;
  /** 발이 닿는 자리와 바라보는 방향이에요. */
  place(x: number, y: number, z: number, yaw: number): void;
  apply(pose: CatPose): void;
}

/** 관절로 이어진 고양이 모양이에요. 그리는 횟수는 몸통, 머리, 눈, 다리 넷으로 7번이에요. */
export function createCatView(coat: CatCoat): CatView {
  const kit = getCatKit(coat);
  const material = getCatMaterial();
  const body = new Mesh(kit.body, material);
  const head = new Mesh(kit.head, material);
  const eyes = new Mesh(kit.eyes, material);
  const frontLeft = new Mesh(kit.leg, material);
  const frontRight = new Mesh(kit.leg, material);
  const backLeft = new Mesh(kit.leg, material);
  const backRight = new Mesh(kit.leg, material);

  const root = new Group();
  root.add(body);
  body.position.y = CAT_BODY_Y;
  body.add(head, frontLeft, frontRight, backLeft, backRight);
  head.position.set(CAT_HEAD_AT[0], CAT_HEAD_AT[1], CAT_HEAD_AT[2]);
  head.add(eyes);
  eyes.position.set(CAT_EYE_AT[0], CAT_EYE_AT[1], CAT_EYE_AT[2]);
  frontLeft.position.set(-CAT_LEG_X, -0.01, CAT_LEG_FRONT_Z);
  frontRight.position.set(CAT_LEG_X, -0.01, CAT_LEG_FRONT_Z);
  backLeft.position.set(-CAT_LEG_X, -0.01, CAT_LEG_BACK_Z);
  backRight.position.set(CAT_LEG_X, -0.01, CAT_LEG_BACK_Z);

  return {
    root,
    place(x, y, z, yaw) {
      root.position.set(x, y, z);
      root.rotation.y = yaw;
    },
    apply(pose) {
      body.position.y = CAT_BODY_Y - pose.bodyLower;
      body.rotation.x = pose.bodyPitch;
      head.rotation.x = pose.headPitch;
      frontLeft.rotation.x = pose.legFrontLeft;
      frontRight.rotation.x = pose.legFrontRight;
      backLeft.rotation.x = pose.legBackLeft;
      backRight.rotation.x = pose.legBackRight;
      eyes.scale.y = pose.eyeOpen;
    },
  };
}
