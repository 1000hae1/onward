import { Box3, Sphere, Vector3, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { createAvatar } from "./avatar";
import { createPose } from "./pose";
import { SPECIES } from "./species";
import type { Outfit, SpeciesId } from "./species";

/**
 * 동물 고르기 카드에 쓰는 작은 그림이에요. 실제 아바타 부품으로 동물과 옷차림마다 한 번씩만 그리고,
 * 다 그리면 그림판을 바로 정리해서 병동 화면과 WebGL을 오래 나눠 쓰지 않아요.
 */

const PIXELS = 192;
const OUTFITS: readonly Outfit[] = ["patient", "visitor"];

let portraits: Map<string, string> | null = null;

const keyOf = (species: SpeciesId, outfit: Outfit): string => `${species}:${outfit}`;

function renderAll(): Map<string, string> {
  const result = new Map<string, string>();
  const canvas = document.createElement("canvas");
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    // 그림을 못 그려도 카드에는 이름이 남아요.
    return result;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(PIXELS, PIXELS, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  scene.add(new HemisphereLight("#fff8ee", "#d9cfc2", 2.2));
  const key = new DirectionalLight("#fff1dc", 1.5);
  key.position.set(1.2, 2.2, 2.4);
  scene.add(key);

  const camera = new PerspectiveCamera(26, 1, 0.1, 10);

  const avatar = createAvatar({ species: SPECIES[0].id, outfit: "patient" });
  // 귀와 꼬리가 보이도록 살짝 비스듬히 세워요.
  avatar.place(0, 0, 0.42);
  avatar.apply(createPose());
  scene.add(avatar.root);

  // 가장 큰 체격과 귀·뿔까지 담는 공통 구도로 동물 사이의 크기 차이를 유지해요.
  const bounds = new Box3();
  for (const spec of SPECIES) {
    for (const outfit of OUTFITS) {
      avatar.setChoice({ species: spec.id, outfit });
      bounds.union(new Box3().setFromObject(avatar.root));
    }
  }
  const sphere = bounds.getBoundingSphere(new Sphere());
  const distance = sphere.radius * 1.08 / Math.sin(camera.fov * Math.PI / 360);
  camera.position.copy(sphere.center).add(new Vector3(0.45, 0.32, 1.85).normalize().multiplyScalar(distance));
  camera.lookAt(sphere.center);

  for (const spec of SPECIES) {
    for (const outfit of OUTFITS) {
      avatar.setChoice({ species: spec.id, outfit });
      renderer.render(scene, camera);
      result.set(keyOf(spec.id, outfit), canvas.toDataURL("image/png"));
    }
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return result;
}

/** 동물과 옷차림에 맞는 그림 주소예요. 그릴 수 없는 기기면 null이에요. */
export function avatarPortrait(species: SpeciesId, outfit: Outfit): string | null {
  portraits ??= renderAll();
  return portraits.get(keyOf(species, outfit)) ?? null;
}
