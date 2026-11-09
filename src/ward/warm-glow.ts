import { AdditiveBlending, Sprite, SpriteMaterial } from "three";
import type { Object3D, Texture } from "three";
import { HUG_SECONDS } from "../../shared/hug-rules";

const POOL = 3;
const FADE_SECONDS = 0.8;
const SIZE = 1.5;

export interface WarmGlows {
  /** 두 사람 사이에 작은 온기 빛을 띄워요. delay초 뒤에 시작해 꼭 안는 동안 머물러요. */
  show(at: { x: number; y: number; z: number }, delay: number): void;
  update(dt: number, stillMotion: boolean): void;
}

/** 안아 줄 때 둘을 감싸는 따뜻한 빛이에요. */
export function createWarmGlows(parent: Object3D, softCircle: Texture): WarmGlows {
  const glows = Array.from({ length: POOL }, () => {
    const material = new SpriteMaterial({
      map: softCircle,
      color: "#ffd9a0",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const sprite = new Sprite(material);
    sprite.visible = false;
    parent.add(sprite);
    return { sprite, material, delay: 0, age: -1 };
  });
  const total = HUG_SECONDS + FADE_SECONDS * 2;

  return {
    show(at, delay) {
      const glow = glows.find((candidate) => candidate.age < 0) ?? glows[0];
      glow.sprite.position.set(at.x, at.y, at.z);
      glow.delay = delay;
      glow.age = 0;
    },
    update(dt, stillMotion) {
      for (const glow of glows) {
        if (glow.age < 0) continue;
        if (glow.delay > 0) {
          glow.delay -= dt;
          continue;
        }
        glow.age += dt;
        if (glow.age >= total) {
          glow.age = -1;
          glow.sprite.visible = false;
          continue;
        }
        const fade = Math.min(1, glow.age / FADE_SECONDS, (total - glow.age) / FADE_SECONDS);
        // 숨쉬듯 아주 조금 커졌다 작아져요. 동작 줄이기를 켜면 그대로예요.
        const pulse = stillMotion ? 1 : 1 + 0.06 * Math.sin(glow.age * 2.4);
        glow.sprite.visible = true;
        glow.material.opacity = 0.55 * fade;
        glow.sprite.scale.setScalar(SIZE * (0.7 + 0.3 * fade) * pulse);
      }
    },
  };
}
