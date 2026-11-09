/** 한마디와 선물은 번호로만 주고받아요. 번호의 뜻은 화면과 서버가 이 표를 함께 봐요. */

export const BLESSINGS = [
  "평안하시길",
  "편히 쉬시길",
  "좋은 밤 되시길",
  "행복하시길",
  "건강하시길",
  "좋은 아침이에요",
] as const;

export const GIFTS = ["네잎클로버", "오잎클로버", "귤", "홍시", "호빵"] as const;

export type BlessingId = number;
export type GiftId = number;

export function blessingText(id: BlessingId): string | null {
  return BLESSINGS[id] ?? null;
}

export function giftName(id: GiftId): string | null {
  return GIFTS[id] ?? null;
}
