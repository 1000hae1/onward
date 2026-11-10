import { CylinderGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry, Vector3 } from "three";
import type { BufferGeometry, Object3D } from "three";
import { blobs, merged, paint, place } from "../avatar/shapes.ts";
import type { BlobSpec, Vec3 } from "../avatar/species";
import type { Placement } from "../../shared/ward-layout";
import { nurseBowAngle, NURSE_BOW_SECONDS } from "./nurse-greeting";
import { addLanternShading } from "../avatar/lantern-shading";

/**
 * 간호사실의 병아리 간호사예요. 이 병동만의 모습으로 그렸어요.
 * 버터색 둥근 몸에 하얀 가운을 입고, 청록 하트가 달린 간호사 모자 아래로 깃털 세 가닥이 삐죽 나와 있어요.
 * 간호사는 병동 직원이라 닉네임이 없고, 평안·선물·신고의 대상이 아니에요.
 */

const FEATHER = "#ffe08a";
const FEATHER_DEEP = "#f6c95a";
const GOWN = "#fbfdfd";
const TEAL = "#5f9e98";
const TEAL_LIGHT = "#9fcfc8";
const BEAK = "#f39a3d";
const CHEEK = "#ffb4a0";
const EYE = "#2c2a28";

/** 허리 높이예요. 인사할 때 이 높이를 축으로 윗몸을 숙여요. */
const WAIST_Y = 0.45;
/** 머리 꼭대기 높이예요. 말풍선이 이 위에 떠요. */
const HEAD_TOP_Y = 1.78;

/** 크게 보이는 몸통과 머리는 면을 넉넉히 써서 둥글게 그려요. */
const roundBall = (color: string, at: Vec3, size: Vec3): BufferGeometry =>
  place(paint(new SphereGeometry(1, 16, 12), color), at, [0, 0, 0], size);

/** 발이에요. 숙여도 움직이지 않아요. */
function buildLower(): BufferGeometry {
  const parts: BlobSpec[] = [
    { shape: "ball", color: BEAK, at: [0.13, 0.035, 0.07], size: [0.09, 0.035, 0.13], mirror: true },
    // 가운 아랫단이에요. 숙일 때 다리 쪽이 비지 않게 받쳐요.
    { shape: "ball", color: GOWN, at: [0, 0.32, 0], size: [0.36, 0.26, 0.34] },
  ];
  return merged(blobs(parts));
}

/** 허리 위예요. 기준점이 허리라서 그대로 돌리면 고개 숙여 인사하는 모습이 돼요. */
function buildUpper(): BufferGeometry {
  const lift: Vec3 = [0, -WAIST_Y, 0];
  const parts: BlobSpec[] = [
    // 하얀 가운 소매와 소매 끝으로 나온 날개 끝이에요.
    { shape: "ball", color: GOWN, at: [0.42, 0.86, 0], size: [0.12, 0.17, 0.14], tilt: [0, 0, 0.35], mirror: true },
    { shape: "ball", color: FEATHER_DEEP, at: [0.48, 0.71, 0.03], size: [0.08, 0.1, 0.1], tilt: [0, 0, 0.3], mirror: true },
    // 청록 깃과 앞단추, 펜을 꽂은 앞주머니예요.
    { shape: "ball", color: TEAL, at: [0, 1.11, 0.01], size: [0.31, 0.05, 0.29] },
    { shape: "ball", color: TEAL, at: [0, 0.9, 0.43], size: [0.026, 0.026, 0.014], small: true },
    { shape: "ball", color: TEAL, at: [0, 0.72, 0.445], size: [0.026, 0.026, 0.014], small: true },
    { shape: "ball", color: TEAL_LIGHT, at: [0.22, 0.66, 0.37], size: [0.09, 0.075, 0.03], tilt: [-0.3, 0.45, 0] },
    { shape: "pill", color: "#e9879a", at: [0.25, 0.75, 0.37], size: [0.013, 0.07, 1], tilt: [-0.3, 0.45, 0], small: true },
    // 눈과 볼, 부리예요.
    { shape: "ball", color: EYE, at: [0.115, 1.41, 0.322], size: [0.034, 0.046, 0.02], tilt: [-0.15, 0.35, 0], mirror: true, small: true },
    { shape: "ball", color: CHEEK, at: [0.205, 1.3, 0.258], size: [0.06, 0.036, 0.02], tilt: [0, 0.65, 0], mirror: true, small: true },
    { shape: "cone", color: BEAK, at: [0, 1.32, 0.375], size: [0.05, 0.1, 0], tilt: [Math.PI / 2, 0, 0], small: true },
    // 모자 아래로 삐죽 나온 깃털 세 가닥이에요.
    { shape: "cone", color: FEATHER, at: [0, 1.66, 0.22], size: [0.035, 0.12, 0], tilt: [0.75, 0, 0], small: true },
    { shape: "cone", color: FEATHER, at: [0.07, 1.64, 0.21], size: [0.03, 0.1, 0], tilt: [0.75, 0, -0.45], mirror: true, small: true },
    // 둥근 간호사 모자와 모자 앞의 청록 하트예요.
    { shape: "ball", color: TEAL, at: [0.022, 1.765, 0.185], size: [0.026, 0.026, 0.012], mirror: true, small: true },
    { shape: "cone", color: TEAL, at: [0, 1.737, 0.188], size: [0.04, 0.045, 0], tilt: [Math.PI, 0, 0], small: true },
  ];
  return merged([
    // 통통한 몸통은 가운이 감싸고, 큰 머리는 노란 깃털이에요.
    place(roundBall(GOWN, [0, 0.76, 0], [0.46, 0.46, 0.43]), lift),
    place(roundBall(FEATHER, [0, 1.38, 0.02], [0.34, 0.33, 0.33]), lift),
    place(place(paint(new CylinderGeometry(0.18, 0.21, 0.14, 16), GOWN), [0, 1.72, 0], [-0.18, 0, 0]), lift),
    place(place(paint(new CylinderGeometry(0.212, 0.214, 0.035, 16), TEAL), [0, 1.67, 0.01], [-0.18, 0, 0]), lift),
    ...blobs(parts, lift),
  ]);
}

export interface ChickNurse {
  readonly root: Group;
  /** 고개를 숙여 인사해요. stillMotion이면 숙이지 않아요. */
  bow(stillMotion: boolean): void;
  update(dt: number): void;
  /** 말풍선을 띄울 머리 위 자리를 target에 써요. */
  headWorld(target: Vector3): Vector3;
}

let shared: { lower: BufferGeometry; upper: BufferGeometry; material: MeshLambertMaterial } | null = null;

function parts(): NonNullable<typeof shared> {
  if (!shared) {
    const material = new MeshLambertMaterial({ vertexColors: true });
    // 소등 뒤에는 머리 위 등불이 간호사도 비춰요.
    addLanternShading(material);
    shared = { lower: buildLower(), upper: buildUpper(), material };
  }
  return shared;
}

/** 간호사 한 명이에요. 그리는 횟수는 아래와 윗몸으로 두 번이에요. */
export function createChickNurse(parent: Object3D, placement: Placement): ChickNurse {
  const { lower, upper, material } = parts();
  const root = new Group();
  root.position.set(placement.x, 0, placement.z);
  root.rotation.y = placement.rotationY;
  root.add(new Mesh(lower, material));
  const top = new Mesh(upper, material);
  top.position.y = WAIST_Y;
  root.add(top);
  parent.add(root);

  const head = new Vector3(0, HEAD_TOP_Y - WAIST_Y, 0);
  let bowing: number | null = null;

  return {
    root,
    bow(stillMotion) {
      if (!stillMotion) bowing = 0;
    },
    update(dt) {
      if (bowing === null) return;
      bowing += dt;
      if (bowing >= NURSE_BOW_SECONDS) bowing = null;
      top.rotation.x = nurseBowAngle(bowing ?? 0);
    },
    headWorld(target) {
      root.updateWorldMatrix(true, true);
      return top.localToWorld(target.copy(head));
    },
  };
}
