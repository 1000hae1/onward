/**
 * WebGL을 쓸 수 없거나 그리는 도중에 끊겼을 때 보여 주는 안내예요.
 * [다시 시도]는 페이지를 새로 불러와요. 컨텍스트가 스스로 돌아오면 안내를 닫아요.
 */
export interface WebglFallback {
  show(): void;
  hide(): void;
}

export function createWebglFallback(): WebglFallback {
  const root = document.querySelector<HTMLElement>("#webgl-fallback");
  let built = false;
  const build = (): void => {
    if (!root || built) return;
    built = true;
    const message = document.createElement("p");
    message.textContent = "이 기기에서는 병실을 보여주기 어려워요.";
    const hint = document.createElement("p");
    hint.className = "fallback-hint";
    hint.textContent = "다른 앱을 닫거나 브라우저를 새로 연 뒤 다시 시도해 주세요.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "다시 시도";
    retry.addEventListener("click", () => window.location.reload());
    root.append(message, hint, retry);
  };
  return {
    show() {
      build();
      if (!root) return;
      root.hidden = false;
      document.querySelector<HTMLElement>("#loading")?.setAttribute("hidden", "");
      root.querySelector("button")?.focus();
    },
    hide() {
      if (root) root.hidden = true;
    },
  };
}
