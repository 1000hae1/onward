/** 사과의 한도와 한마디예요. protocol이 불러오므로 다른 모듈을 불러오지 않아요. */

/** 사과에 다는 한마디예요. 번호로만 주고받아요. */
export const APPLE_PHRASES = ["평안하시길", "편히 쉬시길", "좋은 밤 되시길", "행복하시길", "건강하시길"] as const;
/** 짧은 글의 최대 글자 수예요. */
export const APPLE_NOTE_MAX = 100;
/** 나무에 열리는 자리 수예요. 그보다 많으면 가장 오래된 사과 자리에 새 사과가 열려요. */
export const APPLE_SLOTS = 40;
