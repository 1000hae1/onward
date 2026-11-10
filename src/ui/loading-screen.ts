/**
 * '병동을 여는 중' 화면이에요. 치즈 고양이가 제자리에서 다다다 달리고, 아래 막대가 실제 로딩에 맞춰 차올라요.
 * 그림과 CSS는 index.html에 바로 들어 있어서 이 코드가 내려오기 전에도 보여요. 여기서는 움직임만 맡아요.
 * 원본: docs/loading-cat.html
 */

/** 이 시간이 지나도 다 열리지 않으면 기다려 달라는 말을 보여 줘요. */
export const SLOW_MS = 8000;
const FADE_MS = 400;

/** 지금까지 끝난 일이에요. */
export interface LoadingParts {
  /** 3D 화면 코드를 다 받았어요. */
  code: boolean;
  /** 병원 서버가 대답했어요. */
  server: boolean;
  /** 병동을 다 지었어요. */
  built: boolean;
}

/** 끝난 일로 막대 길이(0~1)를 정해요. 화면이 뜬 것만으로도 조금 차 있어요. */
export function loadingProgress(parts: LoadingParts): number {
  let value = 0.05;
  if (parts.code) value += 0.5;
  if (parts.server) value += 0.2;
  if (parts.built) value += 0.25;
  return Math.min(1, value);
}

/** 진행률에 맞는 한 걸음 길이(초)예요. 0.55초에서 0.30초로 짧아져서 점점 빨리 달려요. */
export function strideFor(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return Number((0.55 - 0.25 * p).toFixed(2));
}

/** 오래 걸릴 때 조금 지쳐서 느려진 걸음이에요. */
export const SLOW_STRIDE = 0.62;

export interface LoadingScreen {
  /** 0~1. 막대는 뒤로 가지 않아요. */
  setProgress(progress: number): void;
  showSlow(): void;
  /** 서버에 닿지 않아요. 고양이가 앉아서 고개를 갸웃하고 [다시 시도]를 보여 줘요. */
  showError(onRetry: () => void): void;
  clearError(): void;
  /** 0.4초 동안 사라져요. */
  hideLoading(): void;
  /** 바로 숨겨요. 방명록이나 WebGL 안내를 띄울 때 써요. */
  hideNow(): void;
}

export function createLoadingScreen(root: HTMLElement): LoadingScreen {
  const catWrap = root.querySelector<HTMLElement>("#loading-cat");
  const roam = catWrap?.querySelector<HTMLElement>(".cat-roam") ?? null;
  const track = root.querySelector<HTMLElement>('[role="progressbar"]');
  const fill = root.querySelector<HTMLElement>("#loading-fill");
  const slow = root.querySelector<HTMLElement>("#loading-slow");
  const error = root.querySelector<HTMLElement>("#loading-error");
  const retry = root.querySelector<HTMLButtonElement>("#loading-retry");

  let shown = 0;
  let isSlow = false;
  /** 8초가 지났어요. 실패 중에 지났으면 다시 시도할 때 보여 줘요. */
  let slowDue = false;
  let failed = false;
  let retryHandler: (() => void) | null = null;
  let slowTimer: number | null = null;

  retry?.addEventListener("click", () => {
    const run = retryHandler;
    retryHandler = null;
    run?.();
  });

  const setStride = (sec: number): void => {
    roam?.style.setProperty("--stride", `${sec}s`);
  };

  const showSlow = (): void => {
    if (failed || !slow) return;
    isSlow = true;
    slow.hidden = false;
    setStride(SLOW_STRIDE);
  };

  const setProgress = (progress: number): void => {
    const p = Math.max(0, Math.min(1, progress));
    if (p < shown) return;
    shown = p;
    if (fill) fill.style.transform = `scaleX(${p})`;
    track?.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    if (!isSlow) setStride(strideFor(p));
  };

  const stopSlowTimer = (): void => {
    if (slowTimer !== null) window.clearTimeout(slowTimer);
    slowTimer = null;
  };
  slowTimer = window.setTimeout(() => {
    slowDue = true;
    showSlow();
  }, SLOW_MS);
  setProgress(loadingProgress({ code: false, server: false, built: false }));

  return {
    setProgress,
    showSlow,
    showError(onRetry) {
      failed = true;
      retryHandler = onRetry;
      root.classList.add("is-error");
      catWrap?.classList.add("is-sitting");
      if (error) error.hidden = false;
      if (slow) slow.hidden = true;
      retry?.focus();
    },
    clearError() {
      failed = false;
      root.classList.remove("is-error");
      catWrap?.classList.remove("is-sitting");
      if (error) error.hidden = true;
      // 8초가 이미 지났으면 다시 기다리는 동안 느림 안내를 바로 보여 줘요.
      if (slowDue) showSlow();
    },
    hideLoading() {
      stopSlowTimer();
      setProgress(1);
      root.classList.add("is-leaving");
      window.setTimeout(() => root.remove(), FADE_MS);
    },
    hideNow() {
      stopSlowTimer();
      root.remove();
    },
  };
}

/** 브라우저가 지금까지 바뀐 화면을 실제로 그릴 때까지 기다려요. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
