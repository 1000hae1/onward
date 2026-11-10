/**
 * '병동을 여는 중' 화면이에요. 통통한 동물이 제자리에서 뒤뚱뒤뚱 걷고, 아래 얇은 막대가
 * 실제 로딩 단계에 맞춰 차올라요. 오래 걸리면 "조금만 기다려 주세요"를 보여 줘요.
 * Three.js보다 먼저 떠야 해서 가볍게 DOM만 써요.
 */

/** 이 시간이 지나도 다 열리지 않으면 기다려 달라는 말을 보여 줘요. */
const SLOW_MS = 8000;
const FADE_MS = 400;

/** 실제로 지나가는 단계와 그때의 막대 길이예요. */
export const LOADING_STEPS = {
  /** 이 화면이 떴어요. */
  start: 0.08,
  /** 3D 화면 코드를 다 받았어요. */
  code: 0.55,
  /** 병동을 다 지었어요. */
  built: 0.9,
  /** 첫 화면을 그렸어요. */
  done: 1,
} as const;

export type LoadingStep = keyof typeof LOADING_STEPS;

export interface LoadingScreen {
  /** 단계가 뒤로 가지는 않아요. */
  step(step: LoadingStep): void;
  /** 막대를 끝까지 채우고 부드럽게 사라져요. */
  finish(): void;
  /** 바로 숨겨요. 오류 화면을 띄울 때 써요. */
  hide(): void;
}

/** 환자복을 입은 통통한 동물이에요. 글자는 없고 그림뿐이라 화면 낭독기에는 숨겨요. */
const CRITTER_SVG = `
<svg class="loading-critter" viewBox="0 0 120 120" width="96" height="96" aria-hidden="true" focusable="false">
  <ellipse class="loading-shadow" cx="60" cy="108" rx="30" ry="5" />
  <g class="loading-foot loading-foot-left"><ellipse cx="46" cy="101" rx="10" ry="6" fill="#e8b9a8" /></g>
  <g class="loading-foot loading-foot-right"><ellipse cx="74" cy="101" rx="10" ry="6" fill="#e8b9a8" /></g>
  <g class="loading-body">
    <ellipse cx="38" cy="26" rx="8" ry="11" fill="#c9a98a" />
    <ellipse cx="82" cy="26" rx="8" ry="11" fill="#c9a98a" />
    <ellipse cx="38" cy="27" rx="4" ry="6" fill="#efc9b6" />
    <ellipse cx="82" cy="27" rx="4" ry="6" fill="#efc9b6" />
    <ellipse cx="60" cy="64" rx="36" ry="39" fill="#c9a98a" />
    <path d="M27 70 Q60 52 93 70 L92 86 Q60 108 28 86 Z" fill="#a9d3e6" />
    <path d="M44 61 L60 74 L76 61" fill="none" stroke="#86b6cc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="60" cy="84" r="2" fill="#f4fafc" />
    <circle cx="60" cy="93" r="2" fill="#f4fafc" />
    <ellipse cx="60" cy="49" rx="16" ry="11" fill="#f2e2cf" />
    <circle cx="49" cy="41" r="3.2" fill="#2c2a28" />
    <circle cx="71" cy="41" r="3.2" fill="#2c2a28" />
    <ellipse cx="60" cy="47" rx="3.6" ry="2.6" fill="#7a5a48" />
    <ellipse cx="42" cy="50" rx="5" ry="3" fill="#f2a99a" opacity="0.7" />
    <ellipse cx="78" cy="50" rx="5" ry="3" fill="#f2a99a" opacity="0.7" />
    <ellipse cx="24" cy="74" rx="7" ry="11" fill="#c9a98a" transform="rotate(18 24 74)" />
    <ellipse cx="96" cy="74" rx="7" ry="11" fill="#c9a98a" transform="rotate(-18 96 74)" />
  </g>
</svg>`;

export function createLoadingScreen(root: HTMLElement): LoadingScreen {
  root.replaceChildren();
  root.classList.add("loading-screen");
  root.insertAdjacentHTML("beforeend", CRITTER_SVG);

  const title = document.createElement("p");
  title.className = "loading-title";
  title.textContent = "병동을 여는 중";

  const track = document.createElement("div");
  track.className = "loading-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", "병동을 여는 중");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  const fill = document.createElement("div");
  fill.className = "loading-fill";
  track.append(fill);

  const slow = document.createElement("p");
  slow.className = "loading-slow";
  slow.textContent = "조금만 기다려 주세요";
  slow.hidden = true;

  root.append(title, track, slow);

  let shown = 0;
  const show = (value: number): void => {
    if (value <= shown) return;
    shown = value;
    fill.style.transform = `scaleX(${value})`;
    track.setAttribute("aria-valuenow", String(Math.round(value * 100)));
  };
  show(LOADING_STEPS.start);

  const slowTimer = window.setTimeout(() => {
    slow.hidden = false;
  }, SLOW_MS);

  const hide = (): void => {
    window.clearTimeout(slowTimer);
    root.hidden = true;
  };

  return {
    step(step) {
      show(LOADING_STEPS[step]);
    },
    finish() {
      window.clearTimeout(slowTimer);
      show(LOADING_STEPS.done);
      root.classList.add("loading-leaving");
      window.setTimeout(hide, FADE_MS);
    },
    hide,
  };
}

/** 브라우저가 지금까지 바뀐 화면을 실제로 그릴 때까지 기다려요. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
