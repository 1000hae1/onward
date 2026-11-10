import { stashGuestbookPath } from "./net/guestbook-path";
import { createWebglFallback } from "./ui/webgl-fallback";

// 가장 먼저 주소창의 방명록 토큰을 이 탭으로 옮기고 지워요. 방문 통계에도 토큰이 담긴 주소가 가지 않아요.
const guestbookToken = stashGuestbookPath();
import { createLoadingScreen, loadingProgress, nextPaint } from "./ui/loading-screen";
import type { LoadingParts } from "./ui/loading-screen";
import { applyLargeText, loadViewPrefs } from "./ui/view-prefs";

/** 병원 서버가 이 시간 안에 대답하지 않으면 닿지 않은 것으로 봐요. */
const HEALTH_TIMEOUT_MS = 10_000;

const loadingRoot = document.querySelector<HTMLElement>("#loading");
const loading = loadingRoot ? createLoadingScreen(loadingRoot) : null;
// 글자 크게는 입장 화면부터 적용해요.
applyLargeText(loadViewPrefs().largeText);

/** 병원 서버에 닿는지 확인해요. 대답(버전 정보)을 돌려주고, 닿지 않으면 실패해요. */
async function checkServer(): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`health ${response.status}`);
    return await response.text();
  } finally {
    window.clearTimeout(timer);
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const guestbookRoot = document.querySelector<HTMLElement>("#guestbook");
if (guestbookToken !== null && guestbookRoot) {
  // 방명록 링크로 왔어요. 3D 병동은 불러오지 않고 방명록만 가볍게 열어요.
  loading?.hideNow();
  if (canvas) canvas.hidden = true;
  void import("./guestbook/visitor-page").then(({ startGuestbookPage }) => startGuestbookPage(guestbookRoot, guestbookToken));
} else if (canvas) {
  const parts: LoadingParts = { code: false, server: false, built: false };
  const advance = (part: keyof LoadingParts): void => {
    parts[part] = true;
    loading?.setProgress(loadingProgress(parts));
  };

  // Three.js는 용량이 커서 따로 불러와요. 로딩 화면이 먼저 보이게 하기 위해서예요.
  // 서버 확인과 동시에 받아요. 서버에 닿지 않아 다시 시도해도 코드는 다시 받지 않아요.
  const sceneCode = import("./scene").then((module) => {
    advance("code");
    return module;
  });

  /** 서버가 대답할 때까지 기다려요. 닿지 않으면 고양이가 앉고, [다시 시도]를 누르면 다시 물어봐요. */
  const waitForServer = (): Promise<string> =>
    new Promise((resolve) => {
      const attempt = (): void => {
        checkServer()
          .then((health) => {
            advance("server");
            resolve(health);
          })
          .catch((error: unknown) => {
            console.warn("병원 서버에 닿지 않았어요.", error);
            loading?.showError(() => {
              loading.clearError();
              attempt();
            });
          });
      };
      attempt();
    });

  const showWebglFallback = (error: unknown): void => {
    // WebGL을 쓸 수 없으면 안내와 다시 시도 버튼을 보여 줘요.
    console.warn("3D 화면을 시작하지 못했어요.", error);
    loading?.hideNow();
    createWebglFallback().show();
  };

  const serverReady = waitForServer();
  sceneCode
    .then(async ({ startScene }) => {
      const health = await serverReady;
      // 막대가 차오른 모습을 먼저 그린 뒤 병동을 지어요. 짓는 동안은 화면이 멈춰 있어요.
      await nextPaint();
      startScene(canvas, health);
      advance("built");
      await nextPaint();
      loading?.hideLoading();
      // 상단의 병동 이름과 접속자 수는 화면이 서버 소식을 받아 채워요.
      const hud = document.querySelector<HTMLElement>("#hud");
      if (hud) hud.hidden = false;
    })
    .catch(showWebglFallback);
}
