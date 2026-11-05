const WARD_LABEL = "온기병동 · 1/36";

const loading = document.querySelector<HTMLElement>("#loading");
if (loading) loading.textContent = "병동을 여는 중";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas) {
  // Three.js는 용량이 커서 따로 불러와요. 문구가 먼저 보이게 하기 위해서예요.
  import("./scene")
    .then(({ startScene }) => {
      startScene(canvas);
      if (loading) loading.hidden = true;
      const hud = document.querySelector<HTMLElement>("#hud");
      if (hud) {
        hud.textContent = WARD_LABEL;
        hud.hidden = false;
      }
    })
    .catch((error: unknown) => {
      // WebGL을 쓸 수 없어도 로딩 문구와 배경색은 그대로 보여요.
      console.warn("3D 화면을 시작하지 못했어요.", error);
    });
}
