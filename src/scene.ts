import {
  Color,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  WebGLRenderer,
} from "three";

const BREATH_SECONDS = 6;

/** 로딩 화면 뒤에서 조명이 은은하게 밝아졌다 어두워지는 작은 씬을 띄워요. */
export function startScene(canvas: HTMLCanvasElement): void {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  scene.background = new Color("#1b2433");

  const camera = new PerspectiveCamera(50, 1, 0.1, 50);
  camera.position.z = 5;

  const wall = new Mesh(
    new PlaneGeometry(40, 40),
    new MeshStandardMaterial({ color: "#3a4557", roughness: 1 }),
  );
  scene.add(wall);

  const lamp = new PointLight("#ffd9a0", 0, 0, 1.5);
  lamp.position.set(0, 0, 2.5);
  scene.add(lamp);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  renderer.setAnimationLoop((timeMs) => {
    const phase = reduceMotion.matches
      ? 0.5
      : (1 - Math.cos((timeMs / 1000 / BREATH_SECONDS) * 2 * Math.PI)) / 2;
    lamp.intensity = 2 + phase * 4;
    renderer.render(scene, camera);
  });
}
