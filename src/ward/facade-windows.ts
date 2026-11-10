/**
 * 건물 바깥 창문의 자리를 정해요. three에 기대지 않는 순수 함수라 테스트에서 바로 써요.
 * 창은 벽 가운데를 기준으로 좌우 대칭으로 놓고, 양 끝에는 margin만큼 벽을 남겨요.
 */

export interface FacadeWindowOptions {
  /** 창 가운데 사이의 거리예요. */
  spacing: number;
  /** 창 하나의 폭이에요. */
  width: number;
  /** 창 바깥 끝에서 벽 모서리까지 적어도 남길 거리예요. */
  margin: number;
}

/** 벽(from~to)을 따라 창 가운데 자리를 돌려줘요. 늘 벽 가운데를 기준으로 대칭이에요. */
export function facadeWindowCenters(from: number, to: number, options: FacadeWindowOptions): number[] {
  const { spacing, width, margin } = options;
  const usable = to - from - margin * 2 - width;
  if (usable < 0) return [];
  const count = Math.floor(usable / spacing + 1e-9) + 1;
  const middle = (from + to) / 2;
  const first = middle - ((count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, index) => first + index * spacing);
}

/**
 * 창마다 짝 번호를 줘요. 가운데를 사이에 두고 마주 보는 창은 같은 번호예요.
 * 불 켜짐을 짝 단위로 정해서 한쪽 창만 튀어 보이지 않게 해요.
 */
export function mirrorPairIndex(index: number, count: number): number {
  return Math.min(index, count - 1 - index);
}
