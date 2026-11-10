import { stashGuestbookPath } from "./net/guestbook-path";
import { createWebglFallback } from "./ui/webgl-fallback";

// 가장 먼저 주소창의 방명록 토큰을 이 탭으로 옮기고 지워요. 방문 통계에도 토큰이 담긴 주소가 가지 않아요.
const guestbookToken = stashGuestbookPath();
import { createLoadingScreen, nextPaint } from "./ui/loading-screen";
import { applyLargeText, loadViewPrefs } from "./ui/view-prefs";

const loadingRoot = document.querySelector<HTMLElement>("#loading");
const loading = loadingRoot ? createLoadingScreen(loadingRoot) : null;
// 글자 크게는 입장 화면부터 적용해요.
applyLargeText(loadViewPrefs().largeText);

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const guestbookRoot = document.querySelector<HTMLElement>("#guestbook");
if (guestbookToken !== null && guestbookRoot) {
  // 방명록 링크로 왔어요. 3D 병동은 불러오지 않고 방명록만 가볍게 열어요.
  loading?.hide();
  if (canvas) canvas.hidden = true;
  void import("./guestbook/visitor-page").then(({ startGuestbookPage }) => startGuestbookPage(guestbookRoot, guestbookToken));
} else if (canvas) {
  // Three.js는 용량이 커서 따로 불러와요. 로딩 화면이 먼저 보이게 하기 위해서예요.
  import("./scene")
    .then(async ({ startScene }) => {
      loading?.step("code");
      // 막대가 차오른 모습을 먼저 그린 뒤 병동을 지어요. 짓는 동안은 화면이 멈춰 있어요.
      await nextPaint();
      startScene(canvas);
      loading?.step("built");
      await nextPaint();
      loading?.finish();
      // 상단의 병동 이름과 접속자 수는 화면이 서버 소식을 받아 채워요.
      const hud = document.querySelector<HTMLElement>("#hud");
      if (hud) hud.hidden = false;
    })
    .catch((error: unknown) => {
      // WebGL을 쓸 수 없으면 안내와 다시 시도 버튼을 보여 줘요.
      console.warn("3D 화면을 시작하지 못했어요.", error);
      loading?.hide();
      createWebglFallback().show();
    });
}
