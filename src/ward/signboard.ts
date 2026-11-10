import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Shape,
} from "three";
import type { Object3D } from "three";
import { loadGowunFonts } from "../ui/fonts";
import {
  SIGN_FRAME,
  SIGN_MOON,
  SIGN_STARS,
  SIGN_SUBTITLE,
  SIGN_SUBTITLE_TEXT,
  SIGN_TEXTURE,
  SIGN_TITLE,
  SIGN_TITLE_TEXT,
  easeLit,
  starOpacity,
  stepLit,
  twinkleOpacity,
} from "./signboard-layout";
import type { Box, SignStar } from "./signboard-layout";

/** 간판의 가로 길이(m)예요. 세로는 텍스처 비율(약 3:1)을 따라요. */
const SIGN_WIDTH = 6.6;
const SIGN_HEIGHT = (SIGN_WIDTH * SIGN_TEXTURE.height) / SIGN_TEXTURE.width;
const SIGN_DEPTH = 0.14;
/** 벽에서 간판 뒷면까지 띄운 거리예요. 빛 번짐 판이 그 사이에 들어가요. */
const WALL_GAP = 0.04;
/** 텍스처 1px이 몇 m인지예요. */
const PX = SIGN_WIDTH / SIGN_TEXTURE.width;

const TITLE_FONT = '"Gowun Batang", "Nanum Myeongjo", serif';
const SUBTITLE_FONT = '"Gowun Dodum", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

interface Palette {
  frame: string;
  body: string;
  title: string;
  subtitle: string;
  moon: string;
  /** 낮에만 있어요. 위쪽 가장자리에 햇빛 받은 선이에요. */
  sunLine?: string;
  /** 낮에만 있어요. 달 표면의 무늬예요. */
  moonMark?: string;
  /** 밤에만 있어요. 글자와 달 둘레의 은은한 빛이에요. */
  glow?: string;
}

const DAY: Palette = {
  frame: "#3A445E",
  body: "#2A3247",
  title: "#F1E6CC",
  subtitle: "#D3CBBB",
  moon: "#EFE0B0",
  sunLine: "#4A5674",
  moonMark: "#DCCB97",
};

const NIGHT: Palette = {
  frame: "#2E3850",
  body: "#1E2433",
  title: "#F6E7B8",
  subtitle: "#D7CFBF",
  moon: "#FBF0CC",
  glow: "rgba(246, 231, 184, 0.55)",
};

const DAY_STAR = { dot: "#C9C2B0", sparkle: "#DCCB97" } as const;
const NIGHT_STAR = { dot: new Color("#F3EBDD"), sparkle: new Color("#F6E7B8") } as const;
const HALO_COLOR = "#F6E7B8";
const HALO_OPACITY = 0.16;

export interface SignboardOptions {
  /** 간판 가운데 높이예요. */
  y: number;
  /** 간판이 붙는 벽면의 z예요. 간판은 +z 쪽을 바라봐요. */
  wallZ: number;
  /** 비스듬히 볼 때도 글자가 흐려지지 않게 하는 값이에요. 렌더러가 지원하는 만큼만 넣어요. */
  anisotropy: number;
}

export interface Signboard {
  /** lit이면 불 켜진 밤 간판이에요. immediate이면 2초 전환 없이 바로 바꿔요. */
  setLit(lit: boolean, immediate: boolean): void;
  /** 별 반짝임과 둘레 빛 번짐을 켤지예요. 저사양이나 움직임 줄이기에서는 꺼요. */
  setLively(lively: boolean): void;
  update(dt: number): void;
}

function roundRectPath(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

/** 네 갈래로 뾰족한 십자 별이에요. */
function sparklePath(context: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const w = r * 0.17;
  context.beginPath();
  context.moveTo(x, y - r);
  context.quadraticCurveTo(x + w, y - w, x + r, y);
  context.quadraticCurveTo(x + w, y + w, x, y + r);
  context.quadraticCurveTo(x - w, y + w, x - r, y);
  context.quadraticCurveTo(x - w, y - w, x, y - r);
  context.closePath();
}

/** 칸 가운데에 글자를 써요. 칸보다 넓으면 글자 크기를 줄여요. */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  box: Box,
  weight: string,
  family: string,
  size: number,
  color: string,
  glow: string | undefined,
): void {
  context.font = `${weight}${size}px ${family}`;
  const width = context.measureText(text).width;
  if (width > box.w) context.font = `${weight}${Math.floor((size * box.w) / width)}px ${family}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const x = box.x + box.w / 2;
  const y = box.y + box.h / 2;
  context.fillStyle = color;
  if (glow) {
    context.save();
    context.shadowColor = glow;
    context.shadowBlur = size * 0.16;
    context.fillText(text, x, y);
    context.restore();
  }
  context.fillText(text, x, y);
}

/** 간판 앞면을 그려요. 밤 별은 따로 반짝여야 해서 낮에만 별을 그려 넣어요. */
function drawFace(context: CanvasRenderingContext2D, palette: Palette, withText: boolean, dayStars: boolean): void {
  const { width, height } = SIGN_TEXTURE;
  const { border, outerRadius, innerRadius } = SIGN_FRAME;
  context.clearRect(0, 0, width, height);

  roundRectPath(context, 0, 0, width, height, outerRadius);
  context.fillStyle = palette.frame;
  context.fill();
  if (palette.sunLine) {
    // 위쪽 테두리에만 햇빛이 닿아요.
    context.save();
    context.beginPath();
    context.rect(0, 0, width, border + 10);
    context.clip();
    roundRectPath(context, 8, 8, width - 16, height - 16, outerRadius - 8);
    context.strokeStyle = palette.sunLine;
    context.lineWidth = 7;
    context.stroke();
    context.restore();
  }
  roundRectPath(context, border, border, width - border * 2, height - border * 2, innerRadius);
  context.fillStyle = palette.body;
  context.fill();

  const moon = SIGN_MOON;
  context.save();
  if (palette.glow) {
    context.shadowColor = palette.glow;
    context.shadowBlur = 64;
  }
  context.beginPath();
  context.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  context.fillStyle = palette.moon;
  context.fill();
  context.restore();
  if (palette.moonMark) {
    context.fillStyle = palette.moonMark;
    context.beginPath();
    context.ellipse(moon.x - 52, moon.y - 38, 30, 24, -0.4, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(moon.x + 46, moon.y + 54, 20, 16, 0.3, 0, Math.PI * 2);
    context.fill();
  }

  if (withText) {
    fitText(context, SIGN_TITLE_TEXT, SIGN_TITLE, "700 ", TITLE_FONT, 250, palette.title, palette.glow);
    fitText(context, SIGN_SUBTITLE_TEXT, SIGN_SUBTITLE, "", SUBTITLE_FONT, 82, palette.subtitle, palette.glow);
  }

  if (dayStars) {
    for (const star of SIGN_STARS) {
      context.globalAlpha = starOpacity(star, false);
      context.fillStyle = DAY_STAR[star.kind];
      if (star.kind === "dot") {
        context.beginPath();
        context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      } else {
        sparklePath(context, star.x, star.y, star.r);
      }
      context.fill();
    }
    context.globalAlpha = 1;
  }
}

function faceTexture(anisotropy: number): { texture: CanvasTexture; context: CanvasRenderingContext2D | null } {
  const canvas = document.createElement("canvas");
  canvas.width = SIGN_TEXTURE.width;
  canvas.height = SIGN_TEXTURE.height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return { texture, context: canvas.getContext("2d") };
}

/** 밤 별 한 개의 모양이에요. 흰색으로 그리고 색과 밝기는 별마다 따로 줘요. */
function starSprite(kind: SignStar["kind"]): CanvasTexture {
  const size = kind === "dot" ? 64 : 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const half = size / 2;
  if (context) {
    if (kind === "dot") {
      const gradient = context.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(DOT_CORE, "rgba(255,255,255,1)");
      gradient.addColorStop(0.55, "rgba(255,255,255,0.3)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    } else {
      const glow = context.createRadialGradient(half, half, 0, half, half, half * 0.45);
      glow.addColorStop(0, "rgba(255,255,255,0.45)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, size, size);
      context.shadowColor = "rgba(255,255,255,0.8)";
      context.shadowBlur = 6;
      context.fillStyle = "#ffffff";
      sparklePath(context, half, half, half * SPARKLE_REACH);
      context.fill();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 점 별 그림에서 꽉 찬 가운데가 차지하는 비율이에요. 그 바깥은 번짐이에요. */
const DOT_CORE = 0.3;
/** 십자 별 그림에서 갈래 끝이 닿는 비율이에요. */
const SPARKLE_REACH = 0.9;

/** 가운데가 비고 둘레로 사라지는 둥근 빛이에요. 간판 뒤에 깔아서 가장자리만 은은하게 보여요. */
function haloTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function roundedBox(): ExtrudeGeometry {
  const w = SIGN_WIDTH;
  const h = SIGN_HEIGHT;
  const r = SIGN_FRAME.outerRadius * PX;
  const shape = new Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return new ExtrudeGeometry(shape, { depth: SIGN_DEPTH, bevelEnabled: false, curveSegments: 6 });
}

/** 텍스처 픽셀 자리를 간판 앞면의 자리(m)로 바꿔요. */
function faceX(px: number): number {
  return (px / SIGN_TEXTURE.width - 0.5) * SIGN_WIDTH;
}
function faceY(py: number): number {
  return (0.5 - py / SIGN_TEXTURE.height) * SIGN_HEIGHT;
}

/**
 * 병원 앞 남색 라이트박스 간판이에요. 낮에는 불 꺼진 간판, 밤에는 글자와 달이 은은하게 빛나고 별이 반짝여요.
 * 앞면 텍스처는 낮과 밤 두 장을 한 번만 그려 두고 투명도만 바꿔요. 밤 별은 따로 그려 반짝임에 텍스처를 다시 그리지 않아요.
 */
export function buildSignboard(parent: Object3D, options: SignboardOptions): Signboard {
  const group = new Group();
  group.position.set(0, options.y, options.wallZ + WALL_GAP);
  parent.add(group);

  const frameDay = new Color(DAY.frame);
  const frameNight = new Color(NIGHT.frame);
  const bodyMaterial = new MeshLambertMaterial({ color: frameDay.clone() });
  group.add(new Mesh(roundedBox(), bodyMaterial));

  const front = SIGN_DEPTH + 0.004;
  const faceGeometry = new PlaneGeometry(SIGN_WIDTH, SIGN_HEIGHT);
  const day = faceTexture(options.anisotropy);
  const night = faceTexture(options.anisotropy);
  const dayMaterial = new MeshBasicMaterial({ map: day.texture, alphaTest: 0.5, toneMapped: false });
  const nightMaterial = new MeshBasicMaterial({
    map: night.texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const dayFace = new Mesh(faceGeometry, dayMaterial);
  dayFace.position.z = front;
  const nightFace = new Mesh(faceGeometry, nightMaterial);
  nightFace.position.z = front + 0.008;
  nightFace.renderOrder = 1;
  group.add(dayFace, nightFace);

  const draw = (withText: boolean): void => {
    if (day.context) drawFace(day.context, DAY, withText, true);
    if (night.context) drawFace(night.context, NIGHT, withText, false);
    day.texture.needsUpdate = true;
    night.texture.needsUpdate = true;
  };
  // 글꼴이 오기 전에는 글자 없이 그려요. 기본 글꼴로 그린 간판이 잠깐이라도 보이지 않게 해요.
  draw(false);
  void loadGowunFonts([
    { font: `700 250px ${TITLE_FONT}`, text: SIGN_TITLE_TEXT },
    { font: `82px ${SUBTITLE_FONT}`, text: SIGN_SUBTITLE_TEXT },
  ]).then(() => draw(true));

  // 밤 별이에요. 점 별과 십자 별을 각각 한 번에 그려요.
  const starGeometry = new PlaneGeometry(1, 1);
  const kinds = (["dot", "sparkle"] as const).map((kind) => {
    const stars = SIGN_STARS.filter((star) => star.kind === kind);
    const mesh = new InstancedMesh(
      starGeometry,
      new MeshBasicMaterial({
        map: starSprite(kind),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      stars.length,
    );
    const matrix = new Matrix4();
    stars.forEach((star, index) => {
      const size = (kind === "dot" ? (star.r * 2) / DOT_CORE : (star.r * 2) / SPARKLE_REACH) * PX;
      matrix.makeScale(size, size, 1).setPosition(faceX(star.x), faceY(star.y), front + 0.016);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new Color(0, 0, 0));
    });
    mesh.computeBoundingSphere();
    mesh.renderOrder = 2;
    group.add(mesh);
    return { kind, stars, mesh };
  });

  const halo = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: haloTexture(),
      color: HALO_COLOR,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  halo.scale.set(SIGN_WIDTH * 1.35, SIGN_HEIGHT * 2, 1);
  halo.position.z = WALL_GAP * -0.5;
  group.add(halo);

  let lit = 0;
  let target = 0;
  let lively = true;
  let seconds = 0;
  let dirty = true;
  const starColor = new Color();

  const apply = (): void => {
    const eased = easeLit(lit);
    bodyMaterial.color.lerpColors(frameDay, frameNight, eased);
    nightMaterial.opacity = eased;
    nightFace.visible = eased > 0;
    const haloMaterial = halo.material;
    haloMaterial.opacity = HALO_OPACITY * eased;
    halo.visible = lively && eased > 0;
    for (const { kind, stars, mesh } of kinds) {
      mesh.visible = eased > 0;
      if (!mesh.visible) continue;
      stars.forEach((star, index) => {
        // 더해 그리는 빛이라 색의 세기가 곧 투명도예요.
        starColor.copy(NIGHT_STAR[kind]).multiplyScalar(twinkleOpacity(star, seconds, lively) * eased);
        mesh.setColorAt(index, starColor);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };
  apply();

  return {
    setLit(next, immediate) {
      target = next ? 1 : 0;
      if (immediate) lit = target;
      dirty = true;
    },
    setLively(next) {
      if (next === lively) return;
      lively = next;
      dirty = true;
    },
    update(dt) {
      if (lit !== target) {
        lit = stepLit(lit, target, dt);
        dirty = true;
      }
      // 반짝임은 불이 켜져 있을 때만 시간을 따라가요.
      if (lively && lit > 0) {
        seconds += dt;
        dirty = true;
      }
      if (!dirty) return;
      dirty = false;
      apply();
    },
  };
}
