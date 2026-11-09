/** 화면 전체를 덮는 안내예요. 잠들었을 때와 들어올 수 없을 때 써요. 글자는 textContent로만 넣어요. */
export interface Gate {
  show(text: string, hint?: string): void;
  hide(): void;
}

export function createGate(root: HTMLElement): Gate {
  const message = document.createElement("p");
  message.className = "gate-message";
  const hint = document.createElement("p");
  hint.className = "gate-hint";
  root.append(message, hint);
  return {
    show(text, extra) {
      message.textContent = text;
      hint.textContent = extra ?? "";
      hint.hidden = !extra;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}
