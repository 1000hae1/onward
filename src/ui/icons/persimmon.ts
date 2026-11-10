import { svgIcon } from "./svg";
import type { Shape } from "./svg";

const BODY = "#E8692E";
const LEAF = "#4E7A3A";

/** 홍시 모양이에요. 진한 주홍색 동그라미에 위쪽 하이라이트, 초록 꼭지 네 갈래예요. */
export const PERSIMMON_SHAPES: readonly Shape[] = [
  // 열매예요. 위아래가 살짝 납작해요.
  { tag: "ellipse", attrs: { cx: 14, cy: 16.5, rx: 11, ry: 9.5, fill: BODY } },
  // 위쪽 왼편에 빛이 닿은 자리예요.
  { tag: "ellipse", attrs: { cx: 9.5, cy: 12.5, rx: 3.2, ry: 1.8, fill: "#FFFFFF", "fill-opacity": 0.45, transform: "rotate(-30 9.5 12.5)" } },
  // 꼭지 네 갈래예요. 위에서 비스듬히 본 모습이라 좌우 갈래가 길어요.
  { tag: "ellipse", attrs: { cx: 9.6, cy: 7.6, rx: 3.6, ry: 1.5, fill: LEAF, transform: "rotate(-12 9.6 7.6)" } },
  { tag: "ellipse", attrs: { cx: 18.4, cy: 7.6, rx: 3.6, ry: 1.5, fill: LEAF, transform: "rotate(12 18.4 7.6)" } },
  { tag: "ellipse", attrs: { cx: 12.2, cy: 9, rx: 2.6, ry: 1.4, fill: LEAF, transform: "rotate(-40 12.2 9)" } },
  { tag: "ellipse", attrs: { cx: 15.8, cy: 9, rx: 2.6, ry: 1.4, fill: LEAF, transform: "rotate(40 15.8 9)" } },
  // 꼭지 가운데 짧은 줄기예요.
  { tag: "rect", attrs: { x: 13.2, y: 3.6, width: 1.6, height: 4.2, rx: 0.8, fill: LEAF } },
];

export function persimmonIcon(): SVGSVGElement {
  return svgIcon("gift-icon gift-icon-svg", PERSIMMON_SHAPES);
}
