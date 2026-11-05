import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import type { Object3D, Texture } from "three";
import { addInstances, createRandom, transform } from "./parts";

const DOME_RADIUS = 450;
const STAR_RADIUS = 430;
/** 구름이 한 바퀴 도는 데 약 2시간이 걸려요. 눈에 띄지 않게 아주 천천히 흘러요. */
const CLOUD_DRIFT_PER_SECOND = (Math.PI * 2) / 7200;

export interface SkyOptions {
  starCount: number;
}

export interface SkyHandles {
  zenith: Color;
  horizon: Color;
  stars: PointsMaterial;
  sun: SpriteMaterial;
  moon: SpriteMaterial;
  clouds: MeshBasicMaterial;
  /** dt가 0이면 구름이 멈춰 있어요. */
  update(dt: number): void;
}

function buildDome(parent: Object3D): { zenith: Color; horizon: Color } {
  const zenith = new Color();
  const horizon = new Color();
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { zenith: { value: zenith }, horizon: { value: horizon } },
    vertexShader: /* glsl */ `
      varying float vHeight;
      void main() {
        vHeight = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      varying float vHeight;
      void main() {
        float t = pow(clamp(vHeight, 0.0, 1.0), 0.55);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 24, 12), material);
  dome.renderOrder = -10;
  parent.add(dome);
  return { zenith, horizon };
}

function buildStars(parent: Object3D, softCircle: Texture, count: number): PointsMaterial {
  const random = createRandom(11);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    // 지평선 근처는 산에 가려서 조금 위쪽에만 뿌려요.
    const height = 0.06 + random() * 0.94;
    const ring = Math.sqrt(1 - height * height);
    positions[i * 3] = Math.cos(angle) * ring * STAR_RADIUS;
    positions[i * 3 + 1] = height * STAR_RADIUS;
    positions[i * 3 + 2] = Math.sin(angle) * ring * STAR_RADIUS;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    map: softCircle,
    color: "#fff7e6",
    size: 4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new Points(geometry, material);
  stars.frustumCulled = false;
  parent.add(stars);
  return material;
}

function buildGlow(
  parent: Object3D,
  softCircle: Texture,
  color: string,
  position: readonly [number, number, number],
  size: number,
): SpriteMaterial {
  const material = new SpriteMaterial({
    map: softCircle,
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const sprite = new Sprite(material);
  sprite.position.set(...position);
  sprite.scale.setScalar(size);
  parent.add(sprite);
  return material;
}

function buildClouds(parent: Object3D): { material: MeshBasicMaterial; group: Group } {
  const random = createRandom(23);
  const material = new MeshBasicMaterial({ color: "#ffffff", fog: false });
  const matrices = [];
  for (let cluster = 0; cluster < 9; cluster++) {
    const angle = (cluster / 9) * Math.PI * 2 + random() * 0.4;
    const radius = 240 + random() * 110;
    const height = 58 + random() * 44;
    const centerX = Math.cos(angle) * radius;
    const centerZ = Math.sin(angle) * radius;
    const facing = -angle + Math.PI / 2;
    for (let puff = 0; puff < 5; puff++) {
      const spread = (puff - 2) * 11;
      const size = 9 + random() * 7;
      matrices.push(
        transform(
          centerX + Math.cos(facing) * spread,
          height + random() * 4,
          centerZ - Math.sin(facing) * spread,
          facing,
          size * 1.5,
          size * 0.42,
          size,
        ),
      );
    }
  }
  const group = new Group();
  addInstances(group, new IcosahedronGeometry(1, 1), material, matrices);
  parent.add(group);
  return { material, group };
}

/** 사방을 덮는 하늘이에요. 낮에는 해와 구름, 밤에는 달과 별이 떠요. */
export function buildSky(parent: Object3D, softCircle: Texture, options: SkyOptions): SkyHandles {
  const { zenith, horizon } = buildDome(parent);
  const stars = buildStars(parent, softCircle, options.starCount);
  const sun = buildGlow(parent, softCircle, "#fff4d6", [-55, 96, -390], 56);
  const moon = buildGlow(parent, softCircle, "#f4f1e0", [38, 92, -392], 19);
  const { material: clouds, group } = buildClouds(parent);
  return {
    zenith,
    horizon,
    stars,
    sun,
    moon,
    clouds,
    update(dt) {
      group.rotation.y += dt * CLOUD_DRIFT_PER_SECOND;
    },
  };
}
