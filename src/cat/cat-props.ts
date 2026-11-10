import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry, Vector3 } from "three";
import type { BufferGeometry, Object3D } from "three";
import type { SceneFrame } from "./cat-play";

/** 놀이 소품이에요. 털실 공, 깃털 낚싯대, 작은 하트예요. 모양과 재질은 한 번만 만들어 함께 써요. */

const YARN_RADIUS = 0.05;
const HEART_RISE = 0.35;
const HEART_SECONDS = 1.6;
/** 쓰다듬는 사람 손 높이쯤에서 낚싯대를 잡아요. */
const WAND_HAND_HEIGHT = 0.8;

let shared: {
  yarn: BufferGeometry;
  rod: BufferGeometry;
  feather: BufferGeometry;
  heartLobe: BufferGeometry;
  heartTip: BufferGeometry;
  yarnMaterial: MeshLambertMaterial;
  rodMaterial: MeshLambertMaterial;
  featherMaterial: MeshLambertMaterial;
  heartMaterial: MeshLambertMaterial;
} | null = null;

function parts() {
  if (shared) return shared;
  shared = {
    yarn: new SphereGeometry(YARN_RADIUS, 10, 8),
    rod: new CylinderGeometry(0.006, 0.006, 1, 5).translate(0, 0.5, 0),
    feather: new ConeGeometry(0.03, 0.12, 6).rotateX(Math.PI),
    heartLobe: new SphereGeometry(0.03, 8, 6),
    heartTip: new ConeGeometry(0.042, 0.06, 8).rotateX(Math.PI),
    yarnMaterial: new MeshLambertMaterial({ color: "#d9707a", emissive: "#2a1012" }),
    rodMaterial: new MeshLambertMaterial({ color: "#a47a52" }),
    featherMaterial: new MeshLambertMaterial({ color: "#8fc1d9", emissive: "#10202a" }),
    heartMaterial: new MeshLambertMaterial({ color: "#ff8fa3", emissive: "#5a1a26" }),
  };
  return shared;
}

export interface CatProps {
  /** 장면에 맞춰 소품을 보이거나 감춰요. hand는 낚싯대를 잡은 사람의 자리예요. */
  show(frame: SceneFrame | null, hand: { x: number; z: number } | null): void;
  dispose(): void;
}

const up = new Vector3(0, 1, 0);
const along = new Vector3();

export function createCatProps(parent: Object3D): CatProps {
  const p = parts();
  const yarn = new Mesh(p.yarn, p.yarnMaterial);
  const rod = new Mesh(p.rod, p.rodMaterial);
  const feather = new Mesh(p.feather, p.featherMaterial);
  const heart = new Group();
  const left = new Mesh(p.heartLobe, p.heartMaterial);
  const right = new Mesh(p.heartLobe, p.heartMaterial);
  const tip = new Mesh(p.heartTip, p.heartMaterial);
  left.position.set(-0.022, 0, 0);
  right.position.set(0.022, 0, 0);
  tip.position.set(0, -0.03, 0);
  heart.add(left, right, tip);
  const all = [yarn, rod, feather, heart];
  for (const item of all) {
    item.visible = false;
    parent.add(item);
  }
  let heartYaw = 0;

  return {
    show(frame, hand) {
      yarn.visible = frame?.yarn != null;
      if (frame?.yarn) {
        yarn.position.set(frame.yarn.x, frame.yarn.y, frame.yarn.z);
        yarn.rotation.x = frame.yarn.rolled / YARN_RADIUS;
      }
      const wand = frame?.wand ?? null;
      feather.visible = wand !== null;
      rod.visible = wand !== null && hand !== null;
      if (wand) {
        feather.position.set(wand.x, wand.y, wand.z);
        if (hand) {
          // 사람 손에서 깃털까지 낚싯대를 이어요.
          rod.position.set(hand.x, WAND_HAND_HEIGHT, hand.z);
          along.set(wand.x - hand.x, wand.y - WAND_HAND_HEIGHT, wand.z - hand.z);
          const length = along.length();
          rod.scale.set(1, length, 1);
          rod.quaternion.setFromUnitVectors(up, along.normalize());
        }
      }
      heart.visible = frame?.heart != null;
      if (frame && frame.heart !== null) {
        const t = frame.heart / HEART_SECONDS;
        const scale = Math.min(1, t * 5) * (1 - Math.max(0, t - 0.7) / 0.3);
        heart.scale.setScalar(Math.max(0.01, scale));
        heart.position.set(frame.x, frame.y + 0.42 + t * HEART_RISE, frame.z);
        heartYaw += 0.02;
        heart.rotation.y = Math.sin(heartYaw) * 0.4;
      }
    },
    dispose() {
      for (const item of all) parent.remove(item);
    },
  };
}
