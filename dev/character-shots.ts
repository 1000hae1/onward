/**
 * 개발용: 3D 캐릭터를 배경이 투명한 PNG로 뽑아요. npm run dev에서 /dev/characters.html로 열어요(주소창에는 /dev/characters로 바뀌어 보여요).
 * 화면 그대로 쓰는 도형과 자세 계산(composePose, composeCatPose)을 써서 병동 속 모습과 같아요.
 */
import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  NeutralToneMapping,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { BufferGeometry } from "three";
import { createAvatar } from "../src/avatar/avatar";
import { composePose, createPose } from "../src/avatar/pose";
import type { Gesture } from "../src/avatar/pose";
import { SPECIES } from "../src/avatar/species";
import type { SpeciesId } from "../src/avatar/species";
import { createCatView } from "../src/cat/cat-view";
import { composeCatPose, createCatPose } from "../src/cat/cat-pose";
import { createChickNurse } from "../src/ward/chick-nurse";
import { buildBeds } from "../src/ward/room";
import { bedRest, bedRestYaw } from "../shared/ward-layout";
import type { BedPlacement } from "../shared/ward-layout";

const SIZE = 1024;
/** 정면에서 15도 위에서 봐요. */
const ELEVATION = (15 * Math.PI) / 180;
/** 그림 둘레에 남기는 여백 비율이에요. */
const MARGIN = 0.05;

interface Shot {
  file: string;
  label: string;
  group: string;
  /** 카메라가 있는 쪽이에요. 0이면 +z(캐릭터 정면)에서 봐요. */
  azimuth?: number;
  /** 내려다보는 각도예요. 없으면 15도예요. */
  elevation?: number;
  build(stage: Object3D): void;
}

/** 서 있거나 두 손을 모은 동물 한 마리예요. gesture가 있으면 그 동작이 가장 깊은 때로 멈춰요. */
function animal(species: SpeciesId, outfit: "patient" | "visitor", gesture: Gesture | null) {
  return (stage: Object3D): void => {
    const avatar = createAvatar({ species, outfit });
    const pose = composePose(createPose(), {
      walkPhase: 0,
      walkWeight: 0,
      breathPhase: 0,
      gesture,
      gestureElapsed: 1,
      bedProgress: 0,
      carrying: outfit === "visitor",
    });
    avatar.apply(pose);
    stage.add(avatar.root);
  };
}

/** 침대에 누워 잠든 동물이에요. 침대 머리는 -x, 얼굴은 +x(발치)를 봐요. */
function sleeping(species: SpeciesId) {
  return (stage: Object3D): void => {
    const bed: BedPlacement = { x: 0, z: 0, rotationY: 0, roomIndex: 0, index: 0 };
    buildBeds(stage, [bed]);
    const avatar = createAvatar({ species, outfit: "patient" });
    const rest = bedRest(bed);
    avatar.place(rest.x, rest.z, bedRestYaw(bed));
    avatar.setAsleep(true);
    avatar.apply(
      composePose(createPose(), {
        walkPhase: 0,
        walkWeight: 0,
        breathPhase: 0,
        gesture: null,
        gestureElapsed: 0,
        bedProgress: 1,
        carrying: false,
      }),
    );
    stage.add(avatar.root);
  };
}

const PATIENTS = SPECIES.map((spec) => ({ id: spec.id, label: spec.label }));

const SHOTS: Shot[] = [
  ...PATIENTS.map(({ id, label }) => ({
    file: `onward-${id}-stand.png`,
    label,
    group: "환자복 · 서 있는 자세",
    build: animal(id, "patient", null),
  })),
  ...PATIENTS.map(({ id, label }) => ({
    file: `onward-${id}-pray.png`,
    label,
    group: "환자복 · 두 손 모은 자세",
    build: animal(id, "patient", "pray"),
  })),
  {
    file: "onward-rabbit-sleep.png",
    label: "토끼 · 침대에서 잠든 자세",
    group: "그 밖의 모습",
    // 누운 몸은 이불에 반쯤 묻혀서, 정면(발치)에서는 얼굴이 가려져요. 발치 비스듬한 쪽에서 30도로 내려다봐요.
    azimuth: 1.15,
    elevation: (30 * Math.PI) / 180,
    build: sleeping("rabbit"),
  },
  {
    file: "onward-chick-nurse-greet.png",
    label: "병아리 간호사 · 인사",
    group: "그 밖의 모습",
    build(stage) {
      const nurse = createChickNurse(stage, { x: 0, z: 0, rotationY: 0 });
      // 고개를 반쯤 숙인 때에서 멈춰요. 끝까지 숙이면 얼굴이 가려져요.
      nurse.bow(false);
      nurse.update(0.32);
    },
  },
  {
    file: "onward-ward-cat-sit.png",
    label: "병동 고양이 · 앉은 자세",
    group: "그 밖의 모습",
    build(stage) {
      const cat = createCatView("ward");
      cat.place(0, 0, 0, 0);
      cat.apply(
        composeCatPose(createCatPose(), {
          walkPhase: 0,
          walkWeight: 0,
          sit: 1,
          curl: 0,
          lookUp: 0,
          blink: 0,
          nose: 0,
        }),
      );
      stage.add(cat.root);
    },
  },
  {
    file: "onward-visitor-bear.png",
    label: "문병객 곰 · 꽃다발",
    group: "그 밖의 모습",
    build: animal("bear", "visitor", null),
  },
];

const canvas = document.querySelector<HTMLCanvasElement>("#shot")!;
const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 1;
// 바닥이 없어서 그림자는 캐릭터 몸에만 져요(팔이 몸에, 귀가 머리에).
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.background = null;

// 병동 낮 조명을 바탕으로, 따뜻하고 밝게 맞췄어요.
scene.add(new HemisphereLight("#fff6ea", "#eadfce", 2.0));
const key = new DirectionalLight("#fff1dc", 1.25);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.015;
key.shadow.radius = 4;
scene.add(key, key.target);
const fill = new DirectionalLight("#ffe9cf", 0.35);
scene.add(fill, fill.target);

const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
let stage: Group | null = null;

/** 보이는 모든 꼭짓점을 월드 좌표로 하나씩 넘겨요. 인스턴스 침대도 칸마다 넘겨요. */
function eachVertex(root: Object3D, visit: (point: Vector3) => void): void {
  const point = new Vector3();
  const instance = new Matrix4();
  const world = new Matrix4();
  root.updateWorldMatrix(true, true);
  root.traverseVisible((node) => {
    if (!(node instanceof Mesh)) return;
    const geometry = node.geometry as BufferGeometry;
    const positions = geometry.getAttribute("position");
    const count = node instanceof InstancedMesh ? node.count : 1;
    for (let i = 0; i < count; i++) {
      if (node instanceof InstancedMesh) {
        node.getMatrixAt(i, instance);
        world.multiplyMatrices(node.matrixWorld, instance);
      } else {
        world.copy(node.matrixWorld);
      }
      for (let v = 0; v < positions.count; v++) {
        visit(point.fromBufferAttribute(positions, v).applyMatrix4(world));
      }
    }
  });
}

/** 캐릭터가 그림 가운데에 꽉 차도록 정사각 정사영 카메라를 맞춰요. */
function frame(root: Object3D, azimuth: number, elevation: number): void {
  const box = new Box3().setFromObject(root);
  const center = box.getCenter(new Vector3());
  const radius = box.getSize(new Vector3()).length();
  const dir = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );
  camera.position.copy(center).addScaledVector(dir, radius * 3);
  camera.lookAt(center);
  camera.updateMatrixWorld();

  // 카메라 기준 좌우·위아래로 꼭짓점이 퍼진 범위를 재요.
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const offset = new Vector3();
  eachVertex(root, (point) => {
    offset.subVectors(point, center);
    const x = offset.dot(right);
    const y = offset.dot(up);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  const half = (Math.max(maxX - minX, maxY - minY) / 2) * (1 + MARGIN * 2);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  camera.left = midX - half;
  camera.right = midX + half;
  camera.top = midY + half;
  camera.bottom = midY - half;
  camera.near = 0.01;
  camera.far = radius * 6;
  camera.updateProjectionMatrix();

  // 빛은 카메라 쪽 왼편 위에서 와요. 그림자 카메라는 캐릭터만 감싸요.
  const lightDir = new Vector3(Math.sin(azimuth - 0.6), 1.3, Math.cos(azimuth - 0.6)).normalize();
  key.position.copy(center).addScaledVector(lightDir, radius * 2);
  key.target.position.copy(center);
  const shadowCam = key.shadow.camera;
  shadowCam.left = shadowCam.bottom = -radius;
  shadowCam.right = shadowCam.top = radius;
  shadowCam.near = 0.01;
  shadowCam.far = radius * 4;
  shadowCam.updateProjectionMatrix();
  const fillDir = new Vector3(Math.sin(azimuth + 1.1), 0.4, Math.cos(azimuth + 1.1)).normalize();
  fill.position.copy(center).addScaledVector(fillDir, radius * 2);
  fill.target.position.copy(center);
}

function show(shot: Shot, azimuth = shot.azimuth ?? 0, elevation = shot.elevation ?? ELEVATION): void {
  if (stage) scene.remove(stage);
  stage = new Group();
  shot.build(stage);
  stage.traverse((node) => {
    if (node instanceof Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  scene.add(stage);
  frame(stage, azimuth, elevation);
  renderer.render(scene, camera);
}

function download(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("PNG를 만들지 못했어요."));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }, "image/png");
  });
}

const status = document.querySelector<HTMLElement>("#status")!;
const allButton = document.querySelector<HTMLButtonElement>("#all")!;
const groups = document.querySelector<HTMLElement>("#groups")!;
const buttons: HTMLButtonElement[] = [];

async function take(shot: Shot): Promise<void> {
  show(shot);
  await download(shot.file);
  status.textContent = `${shot.file}를 받았어요.`;
}

const groupBoxes = new Map<string, HTMLElement>();
for (const shot of SHOTS) {
  let box = groupBoxes.get(shot.group);
  if (!box) {
    const title = document.createElement("h2");
    title.textContent = shot.group;
    box = document.createElement("div");
    box.className = "buttons";
    groups.append(title, box);
    groupBoxes.set(shot.group, box);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = shot.label;
  button.title = shot.file;
  button.addEventListener("mouseenter", () => show(shot));
  button.addEventListener("focus", () => show(shot));
  button.addEventListener("click", () => {
    void take(shot);
  });
  box.append(button);
  buttons.push(button);
}

allButton.addEventListener("click", async () => {
  for (const button of [...buttons, allButton]) button.disabled = true;
  try {
    for (const [index, shot] of SHOTS.entries()) {
      status.textContent = `${index + 1}/${SHOTS.length} ${shot.file}를 만들고 있어요.`;
      await take(shot);
      // 브라우저가 연달아 받는 파일을 막지 않도록 조금씩 쉬어요.
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    status.textContent = `${SHOTS.length}개를 모두 받았어요.`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    for (const button of [...buttons, allButton]) button.disabled = false;
  }
});

// 개발 중 자동 확인용이에요(e2e나 콘솔에서 window.__characters.show(0)).
(window as unknown as { __characters: unknown }).__characters = {
  files: SHOTS.map((shot) => shot.file),
  show: (index: number, azimuth?: number, elevation?: number) => show(SHOTS[index], azimuth, elevation),
};

show(SHOTS[0]);
