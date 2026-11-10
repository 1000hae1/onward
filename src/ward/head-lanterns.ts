import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { Camera, Texture } from "three";
import { LANTERN_RANGE, LANTERN_SHADE_SLOTS, lanternShadeSlots } from "../avatar/lantern-shading";
import {
  fadeLook,
  isOutdoors,
  lanternBob,
  lanternWanted,
  MAX_REAL_LANTERN_LIGHTS,
  pickRealLights,
  stepFade,
} from "./lantern-rules";
import type { LanternSink, LightCandidate } from "./lantern-rules";
import type { TimeSlot } from "./time-of-day";

const LANTERN_COLOR = "#ffe2b8";
/** 한 번에 그리는 등불의 최대 수예요. 넘치면 카메라에서 먼 것부터 빼요. */
const CAPACITY = 32;
/** 빛 구슬은 지름 7cm예요. */
const ORB_RADIUS = 0.035;
/** 구슬 둘레의 은은한 빛 번짐 크기예요(미터). */
const GLOW_SIZE = 0.32;
const GLOW_GAIN = 0.55;
/** 발밑 빛 웅덩이의 지름이에요(미터). */
const POOL_SIZE = 1.3;
const POOL_GAIN = 0.2;
/** 바닥과 겹쳐 깜빡이지 않게 살짝 띄워요. */
const POOL_LIFT = 0.012;
/**
 * 등불 하나의 밝기예요. 진짜 조명과 가벼운 방식이 같은 값을 써요.
 * decay 1이라 머리 꼭대기만 하얗게 타지 않고 어깨와 몸까지 고르게 닿아요.
 */
const LANTERN_INTENSITY = 1.3;
const LANTERN_DECAY = 1;

interface Lantern {
  x: number;
  y: number;
  z: number;
  groundY: number;
  /** 떠다니는 높이까지 더한, 화면에 보이는 높이예요. */
  shownY: number;
  fade: number;
  phase: number;
  /** 이번 프레임에 그 캐릭터가 보였는지예요. 보이지 않으면 꺼져 가다 사라져요. */
  seen: boolean;
}

export interface HeadLanterns {
  /** 프레임마다 캐릭터를 알려 주기 전에 불러요. */
  begin(): void;
  /** 캐릭터 하나의 등불 자리를 알려 줘요. */
  readonly add: LanternSink;
  /** 알려 준 등불을 켜고 끄고, 빛을 나눠 줘요. 그리기 바로 전에 불러요. */
  update(dt: number, camera: Camera, stillMotion: boolean): void;
  setSlot(slot: TimeSlot): void;
  /** 저사양이면 false예요. 진짜 조명 없이 모두 가벼운 방식으로 비춰요. */
  setRealLights(allowed: boolean): void;
}

/**
 * 캐릭터마다 머리 위에 떠 있는 작은 등불이에요.
 * 화면에 가까운 4개는 진짜 PointLight로 비추고, 나머지는 재질 안의 가벼운 계산(lantern-shading.ts)으로 비춰요.
 * 구슬, 빛 번짐, 바닥 빛 웅덩이는 모두 한 번씩만 그려요.
 */
export function createHeadLanterns(parent: Object3D, softCircle: Texture): HeadLanterns {
  const lanterns = new Map<object, Lantern>();
  let slot: TimeSlot = "day";
  let realAllowed = true;
  let seconds = 0;
  const base = new Color(LANTERN_COLOR);
  const tint = new Color();

  const orbMaterial = new MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const orbs = new InstancedMesh(new SphereGeometry(ORB_RADIUS, 12, 8), orbMaterial, CAPACITY);
  orbs.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  orbs.instanceMatrix.setUsage(DynamicDrawUsage);
  orbs.instanceColor.setUsage(DynamicDrawUsage);

  const poolGeometry = new PlaneGeometry(POOL_SIZE, POOL_SIZE);
  poolGeometry.rotateX(-Math.PI / 2);
  const poolMaterial = new MeshBasicMaterial({
    map: softCircle,
    color: "#ffffff",
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const pools = new InstancedMesh(poolGeometry, poolMaterial, CAPACITY);
  pools.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  pools.instanceMatrix.setUsage(DynamicDrawUsage);
  pools.instanceColor.setUsage(DynamicDrawUsage);

  const glowPositions = new BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  const glowColors = new BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  const glowGeometry = new BufferGeometry();
  glowGeometry.setAttribute("position", glowPositions);
  glowGeometry.setAttribute("color", glowColors);
  const glows = new Points(
    glowGeometry,
    new PointsMaterial({
      map: softCircle,
      size: GLOW_SIZE,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }),
  );

  for (const mesh of [orbs, pools, glows]) {
    // 자리가 매 프레임 바뀌어서 화면 밖 판단은 하지 않아요.
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    parent.add(mesh);
  }
  orbs.count = 0;
  pools.count = 0;

  // 조명 개수가 바뀌면 모든 재질의 셰이더를 다시 만들어서, 4개를 늘 두고 밝기만 바꿔요.
  const lights = Array.from({ length: MAX_REAL_LANTERN_LIGHTS }, () => {
    const light = new PointLight(LANTERN_COLOR, 0, LANTERN_RANGE, LANTERN_DECAY);
    parent.add(light);
    return light;
  });
  /** 낮이거나 저사양이면 조명을 장면에서 빼요. 시간대나 품질이 바뀔 때만 바뀌어요. */
  const syncLightsVisible = (): void => {
    const visible = realAllowed && slot !== "day";
    for (const light of lights) {
      light.visible = visible;
      if (!visible) light.intensity = 0;
    }
  };
  syncLightsVisible();

  const matrix = new Matrix4();
  const viewProjection = new Matrix4();
  const frustum = new Frustum();
  const point = new Vector3();
  const active: Lantern[] = [];
  const candidates: LightCandidate[] = [];
  const shade = lanternShadeSlots();

  const add: LanternSink = (key, at, groundY) => {
    let lantern = lanterns.get(key);
    if (!lantern) {
      lantern = { x: 0, y: 0, z: 0, groundY: 0, shownY: 0, fade: 0, phase: Math.random() * Math.PI * 2, seen: false };
      lanterns.set(key, lantern);
    }
    lantern.x = at.x;
    lantern.y = at.y;
    lantern.z = at.z;
    lantern.groundY = groundY;
    lantern.seen = true;
  };

  return {
    add,
    begin() {
      for (const lantern of lanterns.values()) lantern.seen = false;
    },
    setSlot(next) {
      if (next === slot) return;
      slot = next;
      syncLightsVisible();
    },
    setRealLights(allowed) {
      if (allowed === realAllowed) return;
      realAllowed = allowed;
      syncLightsVisible();
    },
    update(dt, camera, stillMotion) {
      seconds += dt;
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      const eye = camera.position;

      active.length = 0;
      for (const [key, lantern] of lanterns) {
        // 보이지 않게 된 캐릭터(떠난 사람, 멀어진 고양이)의 등불은 그 자리에서 꺼져요.
        const wanted = lantern.seen && lanternWanted(slot, isOutdoors(lantern.x, lantern.z));
        lantern.fade = stepFade(lantern.fade, wanted, dt);
        if (lantern.fade <= 0) {
          if (!lantern.seen) lanterns.delete(key);
          continue;
        }
        active.push(lantern);
      }
      // 넘치면 카메라에 가까운 것부터 그려요.
      const distanceOf = (lantern: Lantern): number => Math.hypot(lantern.x - eye.x, lantern.y - eye.y, lantern.z - eye.z);
      if (active.length > CAPACITY) {
        active.sort((a, b) => distanceOf(a) - distanceOf(b));
        active.length = CAPACITY;
      }

      candidates.length = 0;
      active.forEach((lantern, index) => {
        const strength = fadeLook(lantern.fade);
        const y = lantern.y + lanternBob(seconds, lantern.phase, stillMotion);
        lantern.shownY = y;

        matrix.makeTranslation(lantern.x, y, lantern.z);
        orbs.setMatrixAt(index, matrix);
        orbs.setColorAt(index, tint.copy(base).multiplyScalar(strength));

        matrix.makeTranslation(lantern.x, lantern.groundY + POOL_LIFT, lantern.z);
        pools.setMatrixAt(index, matrix);
        pools.setColorAt(index, tint.copy(base).multiplyScalar(strength * POOL_GAIN));

        glowPositions.setXYZ(index, lantern.x, y, lantern.z);
        tint.copy(base).multiplyScalar(strength * GLOW_GAIN);
        glowColors.setXYZ(index, tint.r, tint.g, tint.b);

        candidates.push({
          distance: distanceOf(lantern),
          inView: frustum.containsPoint(point.set(lantern.x, y, lantern.z)),
          strength,
        });
      });

      const count = active.length;
      orbs.count = count;
      pools.count = count;
      glowGeometry.setDrawRange(0, count);
      orbs.instanceMatrix.needsUpdate = true;
      pools.instanceMatrix.needsUpdate = true;
      if (orbs.instanceColor) orbs.instanceColor.needsUpdate = true;
      if (pools.instanceColor) pools.instanceColor.needsUpdate = true;
      glowPositions.needsUpdate = true;
      glowColors.needsUpdate = true;
      orbs.visible = count > 0;
      pools.visible = count > 0;
      glows.visible = count > 0;

      // 가까운 4개는 진짜 조명, 나머지는 가벼운 방식이에요. 같은 등불을 두 번 비추지 않아요.
      const real = pickRealLights(candidates, MAX_REAL_LANTERN_LIGHTS, realAllowed && slot !== "day");
      lights.forEach((light, lightIndex) => {
        const index = real[lightIndex];
        if (index === undefined) {
          light.intensity = 0;
          return;
        }
        const lantern = active[index];
        light.position.set(lantern.x, lantern.shownY, lantern.z);
        light.intensity = LANTERN_INTENSITY * candidates[index].strength;
      });

      let filled = 0;
      for (let index = 0; index < count && filled < LANTERN_SHADE_SLOTS; index++) {
        if (real.includes(index)) continue;
        const lantern = active[index];
        point.set(lantern.x, lantern.shownY, lantern.z).applyMatrix4(camera.matrixWorldInverse);
        shade[filled].set(point.x, point.y, point.z, LANTERN_INTENSITY * candidates[index].strength);
        filled++;
      }
      for (let index = filled; index < LANTERN_SHADE_SLOTS; index++) shade[index].w = 0;
    },
  };
}
