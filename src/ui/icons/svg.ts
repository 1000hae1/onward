/** 작은 인라인 SVG를 만드는 도구예요. 선 없이 면으로만 그리고, 그림은 꾸밈이라 aria-hidden이에요. */

const SVG_NS = "http://www.w3.org/2000/svg";

/** 선물 아이콘 크기예요. 이모지와 같은 28px이에요. */
export const GIFT_ICON_PX = 28;

export type Shape = { tag: "circle" | "ellipse" | "path" | "rect"; attrs: Record<string, string | number> };

export function svgIcon(className: string, shapes: readonly Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 28 28");
  svg.setAttribute("width", String(GIFT_ICON_PX));
  svg.setAttribute("height", String(GIFT_ICON_PX));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  for (const shape of shapes) {
    const element = document.createElementNS(SVG_NS, shape.tag);
    for (const [name, value] of Object.entries(shape.attrs)) element.setAttribute(name, String(value));
    svg.append(element);
  }
  return svg;
}
