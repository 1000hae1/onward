/** 글자와 배경의 대비(WCAG)를 계산해요. 3D 화면 위의 반투명 배경을 확인할 때 써요. */

export type Rgba = [number, number, number, number];

/** #rgb, #rrggbb, rgb(), rgba()를 읽어요. 읽지 못하면 null이에요. */
export function parseColor(text: string): Rgba | null {
  const value = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  return null;
}

/** 반투명한 색을 아래 색 위에 얹은 결과예요. */
export function over(top: Rgba, below: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + below[i] * (1 - a)).concat(1) as Rgba;
}

function luminance(color: Rgba): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = color[i] / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
