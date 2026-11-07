import assert from "node:assert/strict";
import { test } from "vitest";
import { getAvatarKit, getAvatarMaterial, kitTriangles } from "../src/avatar/kit.ts";
import {
  BED_TRANSITION_SECONDS,
  CARRY_ARM_PITCH,
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
  gesture: null,
  gestureElapsed: 0,
  bedProgress: 0,
  carrying: false,
};

test("동물은 다섯 종이고 id와 이름이 겹치지 않아요", () => {
  assert.equal(SPECIES.length, 5);
  assert.equal(new Set(SPECIES.map((spec) => spec.id)).size, 5);
  assert.equal(new Set(SPECIES.map((spec) => spec.label)).size, 5);
});

test("같은 동물과 옷차림은 지오메트리를 다시 만들지 않아요", () => {
  for (const spec of SPECIES) {
    for (const outfit of ["patient", "visitor"] as const) {
      const first = getAvatarKit(spec, outfit, CARRY_ARM_PITCH);
      assert.equal(getAvatarKit(spec, outfit, CARRY_ARM_PITCH), first);
    }
  }
});

test("옷차림이 달라도 머리는 함께 쓰고, 재질은 언제나 하나예요", () => {
  const spec = speciesById("otter");
  const patient = getAvatarKit(spec, "patient", CARRY_ARM_PITCH);
  const visitor = getAvatarKit(spec, "visitor", CARRY_ARM_PITCH);
  assert.equal(patient.head, visitor.head);
  assert.notEqual(patient.torso, visitor.torso);
  assert.equal(getAvatarMaterial(), getAvatarMaterial());
});

test("환자는 양팔이 같은 도형이고, 문병객의 오른팔에만 꽃다발이 있어요", () => {
  const spec = speciesById("deer");
  const patient = getAvatarKit(spec, "patient", CARRY_ARM_PITCH);
  const visitor = getAvatarKit(spec, "visitor", CARRY_ARM_PITCH);
  assert.equal(patient.arm, patient.armRight);
  assert.notEqual(visitor.arm, visitor.armRight);
});

test("아바타 한 명의 삼각형 수가 휴대폰 목표 안에 있어요", () => {
  for (const spec of SPECIES) {
    assert.ok(kitTriangles(getAvatarKit(spec, "patient", CARRY_ARM_PITCH)) <= 1500, spec.id);
    assert.ok(kitTriangles(getAvatarKit(spec, "visitor", CARRY_ARM_PITCH)) <= 1500, spec.id);
  }
});

test("지오메트리마다 꼭짓점 색이 있어 재질 하나로 그릴 수 있어요", () => {
  const kit = getAvatarKit(speciesById("bear"), "patient", CARRY_ARM_PITCH);
  for (const geometry of [kit.torso, kit.head, kit.arm, kit.leg]) {
    assert.ok(geometry.getAttribute("color"));
    assert.ok(geometry.getAttribute("normal"));
  }
});

test("환자복은 줄무늬 없는 민무늬예요", () => {
  const { torso } = getAvatarKit(speciesById("rabbit"), "patient", CARRY_ARM_PITCH);
  const colors = torso.getAttribute("color");
  const distinct = new Set<string>();
  for (let index = 0; index < colors.count; index++) {
    distinct.add(
      [colors.getX(index), colors.getY(index), colors.getZ(index)]
        .map((value) => value.toFixed(3))
        .join(),
    );
  }
  // 옷, 깃, 단추, 꼬리의 네 가지 색뿐이에요.
  assert.equal(distinct.size, 4);
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

test("걸을 때 양다리와 양팔은 서로 반대로 움직여요", () => {
  const pose = composePose(createPose(), { ...idle, walkPhase: Math.PI / 2, walkWeight: 1 });
  assert.ok(pose.legLeftPitch > 0);
  assert.equal(pose.legRightPitch, -pose.legLeftPitch);
  assert.equal(pose.armRightPitch, -pose.armLeftPitch);
  // 왼다리가 나갈 때 왼팔은 반대로 가요.
  assert.ok(pose.armLeftPitch < 0);
});

test("멈춰 있으면 걸음 위상과 상관없이 차렷 자세예요", () => {
  const pose = composePose(createPose(), { ...idle, walkPhase: 1.2 });
  assert.equal(Math.abs(pose.legLeftPitch), 0);
  assert.equal(Math.abs(pose.armLeftPitch), 0);
  assert.equal(pose.bob, 0);
});

test("두 손 모으기는 양손을 같은 각도로 가슴 앞에 모아요", () => {
  const pose = composePose(createPose(), { ...idle, gesture: "pray", gestureElapsed: 1 });
  assert.equal(pose.armLeftPitch, pose.armRightPitch);
  assert.equal(pose.armLeftIn, pose.armRightIn);
  assert.ok(pose.armLeftPitch < -1);
  // 어깨 너비 0.185를 팔 길이 약 0.3으로 좁히면 손끝이 가운데 닿아요.
  assert.ok(Math.abs(0.185 - Math.sin(pose.armLeftIn) * 0.31) < 0.02);
});

test("목례는 허리와 고개를 숙여요", () => {
  const pose = composePose(createPose(), { ...idle, gesture: "bow", gestureElapsed: 0.6 });
  assert.ok(pose.lean > 0.3);
  assert.ok(pose.headPitch > 0.1);
});

test("꽃다발을 든 팔은 앞으로 든 채 작게만 흔들려요", () => {
  const pose = composePose(createPose(), {
    ...idle,
    carrying: true,
    walkPhase: Math.PI / 2,
    walkWeight: 1,
  });
  assert.ok(Math.abs(pose.armRightPitch - CARRY_ARM_PITCH) < 0.1);
  assert.ok(Math.abs(pose.armLeftPitch) > 0.3);
});

test("눕기는 서 있는 자세에서 다 누운 자세까지 이어져요", () => {
  const stand = composePose(createPose(), idle);
  assert.equal(stand.bedLie, 0);
  assert.equal(stand.bedTravel, 0);
  const lie = composePose(createPose(), { ...idle, bedProgress: 1 });
  assert.equal(lie.bedLie, 1);
  assert.equal(lie.bedTravel, 1);
  assert.equal(lie.bedLift, 1);
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
