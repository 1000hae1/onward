/**
 * 사과나무 위에 띄우는 작은 기다림 표시예요. 원형 로딩과 짧은 문구가 있어요.
 * 나무가 화면에 보이면 나무 위에, 보이지 않으면(설정에서 열었을 때) 화면 가운데 아래에 떠요.
 * 글자는 textContent로만 넣어요.
 */
/** 화면 가장자리에서 띄우는 거리예요. */
const EDGE_PX = 12;

export interface TreeStatus {
  set(text: string | null, busy: boolean): void;
  /** 나무 위 화면 좌표예요. null이면 화면 가운데 아래에 둬요. */
  place(at: { x: number; y: number } | null): void;
  readonly shown: boolean;
}

export function createTreeStatus(parent: HTMLElement): TreeStatus {
  const root = document.createElement("p");
  root.id = "tree-status";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.hidden = true;
  const spinner = document.createElement("span");
  spinner.className = "tree-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  root.append(spinner, text);
  parent.append(root);

  let lastPlace = "";
  return {
    get shown() {
      return !root.hidden;
    },
    set(next, busy) {
      root.hidden = next === null;
      text.textContent = next ?? "";
      spinner.hidden = !busy;
    },
    place(at) {
      // 나무가 화면 가장자리에 있어도 글자가 잘리지 않게 화면 안쪽으로 당겨요.
      const half = root.offsetWidth / 2;
      const x = at ? Math.min(Math.max(at.x, half + EDGE_PX), window.innerWidth - half - EDGE_PX) : 0;
      const key = at ? `${Math.round(x)},${Math.round(at.y)}` : "center";
      if (key === lastPlace) return;
      lastPlace = key;
      root.classList.toggle("tree-status-center", at === null);
      if (at) {
        root.style.left = `${Math.round(x)}px`;
        root.style.top = `${Math.round(at.y)}px`;
      } else {
        root.style.left = "";
        root.style.top = "";
      }
    },
  };
}
