/** 화면 가운데 위쪽에 잠깐 떠오르는 안내예요. 여러 개면 차례로 보여 줘요. 글자는 textContent로만 넣어요. */
export interface Notice {
  show(text: string, seconds?: number): void;
  update(dt: number): void;
}

const DEFAULT_SECONDS = 6;

export function createNotice(root: HTMLElement): Notice {
  const queue: { text: string; seconds: number }[] = [];
  let left = 0;

  const next = (): void => {
    const item = queue.shift();
    if (!item) {
      root.hidden = true;
      return;
    }
    root.textContent = item.text;
    root.hidden = false;
    left = item.seconds;
  };

  return {
    show(text, seconds = DEFAULT_SECONDS) {
      queue.push({ text, seconds });
      if (root.hidden) next();
    },
    update(dt) {
      if (root.hidden) return;
      left -= dt;
      if (left <= 0) next();
    },
  };
}
