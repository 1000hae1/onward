import { Color, Vector4 } from "three";
import type { MeshLambertMaterial, MeshStandardMaterial } from "three";

/**
 * 진짜 조명을 받지 못한 등불이 캐릭터를 비추는 가벼운 방식이에요.
 * 등불 자리(카메라 기준 좌표)와 세기를 배열로 넘기면, 등불에 가까운 면, 그중에서도 위를 향한 머리와 어깨가 따뜻하게 밝아져요.
 * 진짜 PointLight(decay 1)와 같은 식을 써서 두 방식의 밝기가 맞아요.
 * 배열 길이는 고정이라 등불 수가 바뀌어도 셰이더를 다시 만들지 않아요.
 */
export const LANTERN_SHADE_SLOTS = 24;
/** 등불 빛이 닿는 거리예요(미터). 진짜 조명의 distance와 같아요. */
export const LANTERN_RANGE = 2.6;

const uniforms = {
  lanternSpots: { value: Array.from({ length: LANTERN_SHADE_SLOTS }, () => new Vector4(0, 0, 0, 0)) },
  lanternColor: { value: new Color("#ffe2b8") },
  lanternRange: { value: LANTERN_RANGE },
};

/** 재질이 등불 빛을 받게 해요. 모든 재질이 같은 값을 함께 써요. */
export function addLanternShading(material: MeshStandardMaterial | MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec4 lanternSpots[${LANTERN_SHADE_SLOTS}];
uniform vec3 lanternColor;
uniform float lanternRange;`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        {
          vec3 lanternSum = vec3(0.0);
          vec3 lanternFrag = -vViewPosition;
          for (int i = 0; i < ${LANTERN_SHADE_SLOTS}; i++) {
            vec4 spot = lanternSpots[i];
            if (spot.w <= 0.0) continue;
            vec3 toLight = spot.xyz - lanternFrag;
            float d = max(length(toLight), 0.1);
            float facing = saturate(dot(normal, toLight / d));
            float reach = saturate(1.0 - pow(d / lanternRange, 4.0));
            lanternSum += spot.w * facing * reach * reach / d;
          }
          reflectedLight.directDiffuse += lanternColor * lanternSum * BRDF_Lambert(diffuseColor.rgb);
        }`,
      );
  };
  material.customProgramCacheKey = () => "lantern-shade";
  material.needsUpdate = true;
}

/** 가벼운 방식으로 비출 등불이에요. 카메라 기준 좌표와 세기를 i번째 칸에 써요. 남는 칸은 꺼 둬요. */
export function lanternShadeSlots(): readonly Vector4[] {
  return uniforms.lanternSpots.value;
}
