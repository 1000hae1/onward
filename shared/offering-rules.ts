/** 협탁 선물과 창가 램프의 칸 규칙이에요. 화면과 상관없는 순수 함수예요. */

/** 협탁 하나에 놓을 수 있는 선물 수예요. 귤 바구니와 홍시 접시가 나머지 칸을 써요. */
export const GIFT_SLOTS_PER_STAND = 2;
/** 창 하나에 놓을 수 있는 램프 수예요. */
export const LAMPS_PER_WINDOW = 12;

export interface PlacedGift {
  /** 놓인 순서예요. 작을수록 오래됐어요. */
  order: number;
  gift: number;
}

/** 빈 칸이 있으면 그 칸에, 없으면 가장 오래된 선물 칸에 놓아요. */
export function chooseGiftSlot(slots: readonly (PlacedGift | null)[]): number {
  const empty = slots.indexOf(null);
  if (empty !== -1) return empty;
  let oldest = 0;
  slots.forEach((slot, index) => {
    const current = slots[oldest];
    if (slot && current && slot.order < current.order) oldest = index;
  });
  return oldest;
}

export function canAddLamp(count: number): boolean {
  return count < LAMPS_PER_WINDOW;
}

/** 램프 칸의 위치예요. 창 폭 전체에 고르게 놓아서 -1에서 1 사이 값을 돌려줘요. */
export function lampSlotPosition(slot: number): number {
  return (slot + 0.5) / LAMPS_PER_WINDOW * 2 - 1;
}
