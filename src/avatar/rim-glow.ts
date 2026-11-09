import { Color } from "three";
import type { MeshLambertMaterial, MeshStandardMaterial } from "three";

/**
 * 저녁과 밤에 동물들의 실루엣이 어둠에 묻히지 않게 하는 은은한 테두리 빛이에요.
 * 배경은 그대로 어둡고, 이 효과를 받은 재질(아바타와 고양이)만 가장자리가 살짝 밝아져요.
 * 세기는 조명(lighting.ts)이 시간대에 맞춰 바꿔요. 낮에는 0이라 아무 차이가 없어요.
 */
const uniforms = {
  rimStrength: { value: 0 },
  rimFill: { value: 0 },
  rimColor: { value: new Color("#ffe6c4") },
};

/** 재질에 테두리 빛을 더해요. 모든 재질이 같은 값을 함께 써요. */
export function addRimGlow(material: MeshStandardMaterial | MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float rimStrength;\nuniform float rimFill;\nuniform vec3 rimColor;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        {
          float facing = abs(dot(normal, normalize(vViewPosition)));
          float rim = pow(1.0 - facing, 2.2);
          // 가장자리는 따뜻한 빛, 몸 전체는 제 색이 아주 조금 비쳐요.
          totalEmissiveRadiance += rimColor * rim * rimStrength + diffuseColor.rgb * rimFill;
        }`,
      );
  };
  material.customProgramCacheKey = () => "rim-glow";
  material.needsUpdate = true;
}

/** strength는 가장자리 빛, fill은 몸 전체에 비치는 약한 빛의 세기예요. */
export function setRimGlow(strength: number, fill: number): void {
  uniforms.rimStrength.value = strength;
  uniforms.rimFill.value = fill;
}
