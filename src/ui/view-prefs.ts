import type { Quality, QualityChoice } from "../ward/quality.ts";

const STORAGE_KEY = "onward.view";

/** 보는 방법 설정이에요. 이 기기에만 저장해요. 사람에 대한 정보는 없어요. */
export interface ViewPrefs {
  /** 가볍게 보기: auto(자동) / light(켜기) / normal(끄기) */
  quality: QualityChoice;
  largeText: boolean;
  /** 자동일 때 지난번에 잰 결과예요. 다음에 열 때 안티에일리어싱을 정하는 데 써요. */
  lastAuto: Quality | null;
}

export const DEFAULT_VIEW: ViewPrefs = { quality: "auto", largeText: false, lastAuto: null };

const isQuality = (value: unknown): value is Quality => value === "normal" || value === "light";

/** 저장된 값을 읽어요. 맞지 않는 칸은 기본값으로 둬요. */
export function parseViewPrefs(raw: string | null): ViewPrefs {
  if (raw === null) return DEFAULT_VIEW;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_VIEW;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_VIEW;
  const { quality, largeText, lastAuto } = value as Record<string, unknown>;
  return {
    quality: quality === "auto" || isQuality(quality) ? quality : DEFAULT_VIEW.quality,
    largeText: largeText === true,
    lastAuto: isQuality(lastAuto) ? lastAuto : null,
  };
}

export function loadViewPrefs(): ViewPrefs {
  try {
    return parseViewPrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveViewPrefs(prefs: ViewPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 저장하지 못해도 지금 화면에서는 고른 그대로예요.
  }
}

/** 글자 크게를 화면 전체에 적용해요. 글자는 모두 rem이라 html 크기만 바꾸면 돼요. */
export function applyLargeText(on: boolean): void {
  document.documentElement.classList.toggle("large-text", on);
}
