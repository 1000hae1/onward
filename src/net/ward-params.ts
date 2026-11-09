/** 주소의 ?ward=1&instance=1 을 읽어요. 없거나 맞지 않으면 1병동 1번이에요. */
export interface WardParams {
  ward: number;
  instance: number;
}

const DEFAULT_WARD = 1;
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

/**
 * 상단의 병동 이름이에요. 두 기기가 같은 병실인지 견줘 볼 수 있게 병실 번호(instance)도 보여 줘요.
 * 서버에 닿지 않아 혼자 머무는 중이면 그렇다고 알려요.
 */
export function wardLabel(ward: number, instance: number, count: number | null, capacity: number, solo = false): string {
  const name = `온기병동 ${ward}병동 ${instance}호`;
  if (count !== null) return `${name} · ${count}/${capacity}`;
  return solo ? `${name} · 혼자 머무는 중` : name;
}

/** 예전에 이 브라우저가 스스로 만들던 값이에요. 이제는 쓰지 않아서 보이면 지워요. */
const LEGACY_GUEST_KEY = "onward.guest";
const TOKEN_KEY = "onward.token";
/** 서버가 서명해 준 게스트 토큰의 모양이에요. 서명이 맞는지는 서버만 알 수 있어요. */
const TOKEN_PATTERN = /^1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

/** 서버가 준 게스트 토큰이에요. 없거나 모양이 틀리면 null이고, 서버가 새로 만들어 줘요. */
export function loadGuestToken(): string | null {
  try {
    window.localStorage.removeItem(LEGACY_GUEST_KEY);
    const saved = window.localStorage.getItem(TOKEN_KEY);
    return saved && TOKEN_PATTERN.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** 이 브라우저가 다음 방문까지 기억할 수 있는지예요. 사생활 보호 모드나 일부 앱 안 브라우저는 못 해요. */
export function storageWorks(storage: Pick<Storage, "setItem" | "getItem" | "removeItem"> | null = safeLocalStorage()): boolean {
  if (!storage) return false;
  const key = "onward.check";
  try {
    storage.setItem(key, "1");
    const ok = storage.getItem(key) === "1";
    storage.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveGuestToken(token: string): void {
  if (!TOKEN_PATTERN.test(token)) return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 저장하지 못하면 이번 방문 동안만 같은 사람이에요.
  }
}

/** 테스트용 ?clockShift=분 이에요. 화면의 시각만 앞당기거나 늦춰서 소등과 밤을 미리 볼 수 있어요. */
export function readClockShiftMs(search: string): number {
  const value = new URLSearchParams(search).get("clockShift");
  if (value === null || !/^-?\d{1,5}$/.test(value)) return 0;
  return Number(value) * 60_000;
}

/** 테스트용 ?debug=1 이에요. 켜면 화면 구석에 연결 정보를 작게 보여 줘요. 서버에는 아무것도 알리지 않아요. */
export function readDebugFlag(search: string): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}
