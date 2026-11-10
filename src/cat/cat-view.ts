import { Group, Mesh } from "three";
import { CAT_BUILDS, catEyeAt, getCatKit, getCatMaterial } from "./cat-kit.ts";
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
  const build = CAT_BUILDS[coat];
  const eyeAt = catEyeAt(coat);
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
  body.position.y = build.bodyY;
  body.add(head, frontLeft, frontRight, backLeft, backRight);
  head.position.set(build.headAt[0], build.headAt[1], build.headAt[2]);
  head.add(eyes);
  eyes.position.set(eyeAt[0], eyeAt[1], eyeAt[2]);
  frontLeft.position.set(-build.legX, build.legJointY, build.legFrontZ);
  frontRight.position.set(build.legX, build.legJointY, build.legFrontZ);
  backLeft.position.set(-build.legX, build.legJointY, build.legBackZ);
  backRight.position.set(build.legX, build.legJointY, build.legBackZ);

  return {
    root,
    place(x, y, z, yaw) {
      root.position.set(x, y, z);
      root.rotation.y = yaw;
    },
    apply(pose) {
      body.position.y = build.bodyY - pose.bodyLower * build.lowerScale;
      body.rotation.x = pose.bodyPitch * build.pitchScale;
      head.rotation.x = pose.headPitch;
      frontLeft.rotation.x = pose.legFrontLeft;
      frontRight.rotation.x = pose.legFrontRight;
      backLeft.rotation.x = pose.legBackLeft;
      backRight.rotation.x = pose.legBackRight;
      eyes.scale.y = pose.eyeOpen;
    },
  };
}
