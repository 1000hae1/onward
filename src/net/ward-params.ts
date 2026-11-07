/** 주소의 ?ward=3&instance=1 을 읽어요. 없거나 맞지 않으면 3병동 1번이에요. */
export interface WardParams {
  ward: number;
  instance: number;
}

const DEFAULT_WARD = 3;
const DEFAULT_INSTANCE = 1;
const MAX_WARD = 99;
export const MAX_INSTANCE = 20;

function readNumber(value: string | null, max: number, fallback: number): number {
  if (value === null || !/^\d{1,3}$/.test(value)) return fallback;
  const number = Number(value);
  return number >= 1 && number <= max ? number : fallback;
}

export function readWardParams(search: string): WardParams {
  const params = new URLSearchParams(search);
  return {
    ward: readNumber(params.get("ward"), MAX_WARD, DEFAULT_WARD),
    instance: readNumber(params.get("instance"), MAX_INSTANCE, DEFAULT_INSTANCE),
  };
}

export function wardLabel(ward: number, count: number | null, capacity: number): string {
  return count === null ? `onWard ${ward}병동` : `onWard ${ward}병동 · ${count}/${capacity}`;
}

const GUEST_KEY = "onward.guest";

/** 이 브라우저를 가리키는 무작위 값이에요. 나중에 서명된 토큰으로 바꿀 거예요. */
export function loadGuestId(): string {
  try {
    const saved = window.localStorage.getItem(GUEST_KEY);
    if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(GUEST_KEY, fresh);
    return fresh;
  } catch {
    // 저장소를 못 쓰면 이번 방문 동안만 쓰는 값이에요.
    return crypto.randomUUID();
  }
}
