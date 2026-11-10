import { svgIcon } from "./svg";
import type { Shape } from "./svg";

const BUN = "#F6EEDC";

/** 호빵 모양이에요. 크림색 둥근 빵 윗부분, 아래쪽 옅은 그림자, 위로 올라가는 김 두 줄이에요. 선 없이 면으로만 그려요. */
export const HOPPANG_SHAPES: readonly Shape[] = [
  // 바닥에 드리운 그림자예요.
  { tag: "ellipse", attrs: { cx: 14, cy: 24.9, rx: 10, ry: 1.5, fill: "#000000", "fill-opacity": 0.22 } },
  // 둥근 빵이에요.
  { tag: "path", attrs: { d: "M3.8 20.6 C3.8 14.6 8.4 11.5 14 11.5 C19.6 11.5 24.2 14.6 24.2 20.6 C24.2 23 22.6 24 20.4 24 L7.6 24 C5.4 24 3.8 23 3.8 20.6 Z", fill: BUN } },
  // 빵 아래쪽이 조금 어두워요.
  { tag: "path", attrs: { d: "M3.9 20.4 C9 22 19 22 24.1 20.4 C24.1 22.9 22.6 24 20.4 24 L7.6 24 C5.4 24 3.9 22.9 3.9 20.4 Z", fill: "#E3D3B2" } },
  // 위로 올라가는 김 두 줄이에요. 선이 아니라 가는 물결 띠로 그려요.
  {
    tag: "path",
    attrs: {
      d: "M10.4 10 C8.9 8.4 11.6 6.6 10.2 4.4 C10 4 10.6 3.6 11 4 C12.7 6.4 10 8.3 11.6 9.6 C11.9 10 10.8 10.4 10.4 10 Z",
      fill: BUN,
      "fill-opacity": 0.85,
    },
  },
  {
    tag: "path",
    attrs: {
      d: "M16.4 10 C14.9 8.4 17.6 6.6 16.2 4.4 C16 4 16.6 3.6 17 4 C18.7 6.4 16 8.3 17.6 9.6 C17.9 10 16.8 10.4 16.4 10 Z",
      fill: BUN,
      "fill-opacity": 0.85,
    },
  },
];

export function hoppangIcon(): SVGSVGElement {
  return svgIcon("gift-icon gift-icon-svg", HOPPANG_SHAPES);
}
