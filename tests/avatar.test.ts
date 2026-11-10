import assert from "node:assert/strict";
import { Color, Vector3 } from "three";
import type { BufferGeometry } from "three";
import { test } from "vitest";
import { CAT_COATS } from "../src/cat/cat-kit.ts";
import {
  EGG_HEIGHT,
  EGG_RADIUS,
  eggNormal,
  eggPoint,
  eggRadius,
  eggThetaAt,
  eggY,
} from "../src/avatar/egg.ts";
import {
  ARM_HALF_WIDTH,
  ARM_REACH,
  AVATAR_HEIGHT,
  getAvatarKit,
  getAvatarMaterial,
  kitTriangles,
} from "../src/avatar/kit.ts";
import {
  advanceBreath,
  BED_TRANSITION_SECONDS,
  CARRY_ARM_SWING,
  composePose,
  createPose,
  gestureDuration,
  gestureWeight,
} from "../src/avatar/pose.ts";
import { SPECIES, speciesById } from "../src/avatar/species.ts";
import { pickBox } from "../src/ward/camera-view.ts";
import { createNavGrid } from "../src/ward/movement.ts";
import {
  BED_BOXES,
  bedApproach,
  bedRest,
  bedRestYaw,
  BEDS,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_START,
  WALK_AREAS,
  WALL_BOXES,
} from "../shared/ward-layout.ts";

const idle = {
  walkPhase: 0,
  walkWeight: 0,
  breathPhase: 0,
  gesture: null,
  gestureElapsed: 0,
  bedProgress: 0,
  carrying: false,
};

const colorsOf = (geometry: BufferGeometry): Set<string> => {
  const colors = geometry.getAttribute("color");
  const distinct = new Set<string>();
  for (let index = 0; index < colors.count; index++) {
    distinct.add(
      [colors.getX(index), colors.getY(index), colors.getZ(index)].map((value) => value.toFixed(3)).join(),
    );
  }
  return distinct;
};

const key = (hex: string): string => {
  const { r, g, b } = new Color(hex);
  return [r, g, b].map((value) => value.toFixed(3)).join();
};

/** 화면에 보이는 0~255 RGB 공간의 거리예요. */
const colorDistance = (a: string, b: string): number => {
  const channels = (hex: string): number[] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

test("동물은 다섯 종이고 id와 이름이 겹치지 않아요", () => {
  assert.equal(SPECIES.length, 5);
  assert.equal(new Set(SPECIES.map((spec) => spec.id)).size, 5);
  assert.equal(new Set(SPECIES.map((spec) => spec.label)).size, 5);
});

test("달걀 몸은 목 없이 통통해서 폭이 키의 80%를 넘어요", () => {
  let widest = 0;
  for (let theta = 0; theta <= Math.PI; theta += 0.01) widest = Math.max(widest, eggRadius(theta));
  assert.ok((widest * 2) / EGG_HEIGHT >= 0.8);
  assert.ok(widest <= EGG_RADIUS * 1.01);
  // 아래쪽이 조금 더 통통한 달걀이에요.
  assert.ok(eggRadius(Math.PI / 2 - 0.4) > eggRadius(Math.PI / 2 + 0.4));
});

test("달걀 표면의 바깥 방향은 언제나 몸 밖을 향해요", () => {
  const point = new Vector3();
  const normal = new Vector3();
  for (const theta of [0.3, 1, Math.PI / 2, 2.2, 2.9]) {
    for (const phi of [0, 1, 2.5, Math.PI, -1.2]) {
      eggPoint(theta, phi, 1, point);
      eggNormal(theta, phi, normal);
      const fromAxis = new Vector3(point.x, 0, point.z);
      assert.ok(normal.dot(fromAxis) > 0, `${theta},${phi}`);
    }
  }
  for (const y of [0.1, 0.31, 0.5]) assert.ok(Math.abs(eggY(eggThetaAt(y)) - y) < 1e-9);
});

test("같은 동물과 옷차림은 지오메트리를 다시 만들지 않아요", () => {
  for (const spec of SPECIES) {
    for (const outfit of ["patient", "visitor"] as const) {
      const first = getAvatarKit(spec, outfit);
      assert.equal(getAvatarKit(spec, outfit), first);
    }
  }
});

test("옷차림이 달라도 발은 함께 쓰고, 재질은 반짝임 없는 하나예요", () => {
  const spec = speciesById("otter");
  const patient = getAvatarKit(spec, "patient");
  const visitor = getAvatarKit(spec, "visitor");
  assert.equal(patient.foot, visitor.foot);
  assert.notEqual(patient.body, visitor.body);
  const material = getAvatarMaterial();
  assert.equal(getAvatarMaterial(), material);
  assert.equal(material.metalness, 0);
  assert.ok(material.roughness >= 0.85);
});

test("환자는 양팔이 같은 도형이고, 문병객의 오른팔에만 꽃다발이 있어요", () => {
  const spec = speciesById("deer");
  const patient = getAvatarKit(spec, "patient");
  const visitor = getAvatarKit(spec, "visitor");
  assert.equal(patient.arm, patient.armRight);
  assert.notEqual(visitor.arm, visitor.armRight);
});

test("아바타 한 명의 삼각형 수가 휴대폰 목표 안에 있어요", () => {
  for (const spec of SPECIES) {
    assert.ok(kitTriangles(getAvatarKit(spec, "patient")) <= 1500, spec.id);
    assert.ok(kitTriangles(getAvatarKit(spec, "visitor")) <= 1500, spec.id);
  }
});

test("지오메트리마다 꼭짓점 색이 있어 재질 하나로 그릴 수 있어요", () => {
  const kit = getAvatarKit(speciesById("bear"), "patient");
  for (const geometry of [kit.body, kit.arm, kit.foot]) {
    assert.ok(geometry.getAttribute("color"));
    assert.ok(geometry.getAttribute("normal"));
  }
});

test("환자복은 줄무늬 없는 하늘색이고, 브이넥 사이로 배 무늬가 보여요", () => {
  const spec = speciesById("rabbit");
  const patient = colorsOf(getAvatarKit(spec, "patient").body);
  const visitor = colorsOf(getAvatarKit(spec, "visitor").body);
  for (const hex of ["#a9d8f2", "#86c2e6"]) {
    assert.ok(patient.has(key(hex)), hex);
    assert.ok(!visitor.has(key(hex)), hex);
  }
  assert.ok(!patient.has(key("#a3c9e2")), "예전 줄무늬 색이 남아 있어요");
  assert.ok(patient.has(key(spec.belly)));
});

test("아바타는 고양이 두 마리와 털색이 확실히 달라요", () => {
  for (const spec of SPECIES) {
    for (const coat of Object.values(CAT_COATS)) {
      assert.ok(colorDistance(spec.fur, coat.fur) >= 40, `${spec.id} ${coat.fur}`);
    }
  }
  // 아바타는 서 있는 달걀이라 고양이(몸 높이 0.17)보다 훨씬 커요.
  assert.ok(AVATAR_HEIGHT > 0.6);
});

test("동작은 천천히 시작해서 끝나면 원래대로 돌아와요", () => {
  for (const gesture of ["pray", "bow"] as const) {
    const duration = gestureDuration(gesture);
    assert.equal(gestureWeight(gesture, 0), 0);
    assert.equal(gestureWeight(gesture, duration / 2), 1);
    assert.equal(gestureWeight(gesture, duration), 0);
    assert.ok(gestureWeight(gesture, 0.1) < 0.5);
  }
});

test("걸을 때는 좌우로 뒤뚱거리며 발을 번갈아 들어요", () => {
  const left = composePose(createPose(), { ...idle, walkPhase: Math.PI / 2, walkWeight: 1 });
  assert.ok(left.sway > 0.08);
  assert.ok(left.footRightLift > 0);
  assert.equal(left.footLeftLift, 0);
  const right = composePose(createPose(), { ...idle, walkPhase: -Math.PI / 2, walkWeight: 1 });
  assert.ok(right.sway < -0.08);
  assert.ok(right.footLeftLift > 0);
  assert.equal(right.footRightLift, 0);
});

test("걸을 때 양발과 양팔은 서로 반대로 움직여요", () => {
  const pose = composePose(createPose(), { ...idle, walkPhase: 0.3, walkWeight: 1 });
  assert.ok(pose.footLeftStep > 0);
  assert.equal(pose.footRightStep, -pose.footLeftStep);
  assert.equal(pose.armRightSwing, -pose.armLeftSwing);
  // 왼발이 나갈 때 왼팔은 뒤로 가요.
  assert.ok(pose.armLeftSwing < 0);
});

test("멈춰 있으면 걸음 위상과 상관없이 차렷 자세예요", () => {
  const pose = composePose(createPose(), { ...idle, walkPhase: 1.2 });
  assert.equal(Math.abs(pose.sway), 0);
  assert.equal(Math.abs(pose.armLeftSwing), 0);
  assert.equal(Math.abs(pose.footLeftStep), 0);
  assert.equal(pose.bob, 0);
});

test("가만히 있으면 아주 살짝 숨을 쉬고, 걸을 때와 동작 줄이기에서는 멈춰요", () => {
  const breathing = composePose(createPose(), { ...idle, breathPhase: Math.PI / 2 });
  assert.ok(breathing.breathe > 0 && breathing.breathe <= 0.02);
  const walking = composePose(createPose(), { ...idle, breathPhase: Math.PI / 2, walkWeight: 1 });
  assert.equal(walking.breathe, 0);
  assert.equal(advanceBreath(1.3, 0.5, true), 0);
  const next = advanceBreath(0, 0.5, false);
  assert.ok(next > 0 && next < Math.PI * 2);
});

test("두 손 모으기는 짧은 두 팔이 배 앞 가운데에서 맞닿아요", () => {
  const pose = composePose(createPose(), { ...idle, gesture: "pray", gestureElapsed: 1 });
  assert.equal(pose.armLeftSwing, pose.armRightSwing);
  assert.equal(pose.armLeftLift, pose.armRightLift);
  // 팔 뭉치는 몸 가운데를 축으로 돌아요. 두 뭉치 가운데 사이가 뭉치 폭보다 좁으면 맞닿아요.
  const gap = 2 * ARM_REACH * Math.cos(pose.armLeftSwing);
  assert.ok(gap <= 2 * ARM_HALF_WIDTH, `${gap}`);
  assert.ok(gap >= ARM_HALF_WIDTH);
  assert.ok(ARM_REACH * Math.sin(pose.armLeftSwing) > ARM_REACH * 0.9);
});

test("목례는 몸 전체를 앞으로 숙이고 팔을 앞에 모아요", () => {
  const pose = composePose(createPose(), { ...idle, gesture: "bow", gestureElapsed: 0.6 });
  assert.ok(pose.lean > 0.3);
  assert.ok(pose.armLeftSwing > 1 && pose.armRightSwing > 1);
});

test("꽃다발을 든 팔은 앞으로 든 채 작게만 흔들려요", () => {
  const pose = composePose(createPose(), {
    ...idle,
    carrying: true,
    walkPhase: 0,
    walkWeight: 1,
  });
  assert.ok(Math.abs(pose.armRightSwing - CARRY_ARM_SWING) < 0.1);
  assert.ok(Math.abs(pose.armLeftSwing) > 0.3);
});

test("눕기는 서 있는 자세에서 다 누운 자세까지 이어져요", () => {
  const stand = composePose(createPose(), idle);
  assert.equal(stand.bedLie, 0);
  assert.equal(stand.bedTravel, 0);
  const lie = composePose(createPose(), { ...idle, bedProgress: 1, walkPhase: 1, walkWeight: 1 });
  assert.equal(lie.bedLie, 1);
  assert.equal(lie.bedTravel, 1);
  assert.equal(lie.bedLift, 1);
  assert.equal(lie.sway, 0);
  assert.equal(lie.footLeftLift, 0);
  // 몸을 다 눕히기 전에 침대 높이에 먼저 올라가요.
  const middle = composePose(createPose(), { ...idle, bedProgress: 0.6 });
  assert.ok(middle.bedLift > middle.bedLie);
  assert.ok(BED_TRANSITION_SECONDS > 0.5);
});

test("같은 Pose 객체를 다시 써서 매 프레임 새로 만들지 않아요", () => {
  const out = createPose();
  assert.equal(composePose(out, idle), out);
});

test("침대 36개 모두 곁 자리까지 걸어갈 수 있어요", () => {
  const nav = createNavGrid({
    areas: WALK_AREAS,
    obstacles: OBSTACLES,
    radius: PLAYER_RADIUS,
    cellSize: 0.2,
  });
  assert.equal(BEDS.length, 36);
  for (const bed of BEDS) {
    const spot = bedApproach(bed);
    assert.ok(nav.isFree(spot), `${bed.roomIndex}-${bed.index}`);
    assert.ok(nav.findPath(PLAYER_START, spot).length > 0, `${bed.roomIndex}-${bed.index}`);
  }
});

test("누운 자리는 침대 안이고, 얼굴 정면은 발치를 향해요", () => {
  for (const [index, bed] of BEDS.entries()) {
    const rest = bedRest(bed);
    const box = BED_BOXES[index];
    assert.ok(rest.x > box.minX && rest.x < box.maxX && rest.z > box.minZ && rest.z < box.maxZ);
    // 침대 좌표의 +x가 발치예요. 눕는 방향의 +z가 같은 쪽이어야 해요.
    const yaw = bedRestYaw(bed);
    const faceX = Math.sin(yaw);
    const faceZ = Math.cos(yaw);
    const footX = Math.cos(bed.rotationY);
    const footZ = -Math.sin(bed.rotationY);
    assert.ok(Math.abs(faceX - footX) < 1e-9 && Math.abs(faceZ - footZ) < 1e-9);
  }
});

test("침대 탭은 시선이 처음 닿는 침대만 잡고, 벽 너머는 잡지 않아요", () => {
  const box = BED_BOXES[0];
  const x = (box.minX + box.maxX) / 2;
  const z = (box.minZ + box.maxZ) / 2;
  // 침대 바로 위에서 내려다보면 잡혀요.
  assert.equal(pickBox({ x, y: 3, z }, { x, y: -1, z }, BED_BOXES, []), 0);
  // 빈 바닥을 내려다보면 잡히지 않아요.
  assert.equal(pickBox({ x: 0, y: 3, z: 0 }, { x: 0, y: -1, z: 0 }, BED_BOXES, WALL_BOXES), null);
  // 복도에서 병실 벽을 뚫고 침대를 볼 수는 없어요.
  const blocked = pickBox({ x: 0, y: 0.6, z }, { x, y: 0.6, z }, BED_BOXES, WALL_BOXES);
  assert.equal(blocked, null);
});


test("동물 크기는 곰, 사슴, 나머지 순이고 모습을 바꿔도 반영돼요", async () => {
  const { createAvatar } = await import("../src/avatar/avatar.ts");
  const avatar = createAvatar({ species: "rabbit", outfit: "patient" });
  const point = new Vector3();
  const normalHead = avatar.headWorld(point).y;
  for (const [species, scale] of [["bear", 1.3], ["deer", 1.1], ["otter", 1], ["penguin", 1], ["rabbit", 1]] as const) {
    avatar.setChoice({ species, outfit: "patient" });
    assert.equal(avatar.size, scale);
    assert.ok(Math.abs(avatar.headWorld(point).y - normalHead * scale) < 1e-8);
    // 침대 높이는 동물의 크기로 확대하지 않아요.
    assert.equal(avatar.root.scale.y, 1);
  }
});
