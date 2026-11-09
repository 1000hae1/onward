/**
 * 주소가 /visit/{토큰}이면 토큰을 이 탭(sessionStorage)에 옮기고 주소창에서 바로 지워요.
 * main.ts가 가장 먼저 불러요. 방문 통계 비콘이나 다른 스크립트가 주소를 읽기 전에 토큰이 사라져요.
 * 무거운 모듈을 불러오지 않으려고 따로 둬요.
 */
import { readVisitPath } from "../../shared/visit-path";

export const VISITING_KEY = "onward.visiting";

/** 옮겼으면 토큰을, 아니면 null을 돌려줘요. */
export function stashVisitPath(): string | null {
  const token = readVisitPath(window.location.pathname);
  if (!token) return null;
  try {
    window.sessionStorage.setItem(VISITING_KEY, token);
  } catch {
    // 저장하지 못해도 이번에는 돌려준 값으로 들어가요.
  }
  try {
    window.history.replaceState(null, "", `/${window.location.search}`);
  } catch {
    // 주소를 바꾸지 못해도 들어가는 데는 상관없어요.
  }
  return token;
}
