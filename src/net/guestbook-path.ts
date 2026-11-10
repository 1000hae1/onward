/**
 * 주소가 /guestbook/{토큰}이면 토큰을 이 탭(sessionStorage)에 옮기고 주소창은 /guestbook으로 바로 바꿔요.
 * main.ts가 가장 먼저 불러요. 방문 통계 비콘이나 다른 스크립트가 주소를 읽기 전에 토큰이 사라져요.
 * 새로고침해도 탭에 둔 토큰으로 같은 방명록이 열려요. 무거운 모듈을 불러오지 않으려고 따로 둬요.
 */
import { GUESTBOOK_BARE_PATH, readGuestbookPath } from "../../shared/guestbook-path";

/** 방명록 화면을 보는 동안의 토큰이에요. */
export const GUESTBOOK_KEY = "onward.guestbook";
/** [병실에 문병 가기]를 누른 뒤 병동 화면이 읽는 토큰이에요. */
export const VISITING_KEY = "onward.visiting";

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** 방명록 화면을 열어야 하면 토큰을, 아니면 null을 돌려줘요. 토큰을 읽을 수 없는 /guestbook이면 빈 글자예요. */
export function stashGuestbookPath(): string | null {
  const fromPath = readGuestbookPath(window.location.pathname);
  if (fromPath) {
    write(GUESTBOOK_KEY, fromPath);
    try {
      window.history.replaceState(null, "", `${GUESTBOOK_BARE_PATH}${window.location.search}`);
    } catch {
      // 주소를 바꾸지 못해도 여는 데는 상관없어요.
    }
    return fromPath;
  }
  if (window.location.pathname.replace(/\/$/, "") !== GUESTBOOK_BARE_PATH) return null;
  const saved = read(GUESTBOOK_KEY);
  return saved && TOKEN.test(saved) ? saved : "";
}

export function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // 저장하지 못해도 이번에는 그대로 써요.
  }
}

export function remove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 지우지 못해도 괜찮아요.
  }
}
