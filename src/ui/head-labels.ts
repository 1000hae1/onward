import { Vector3 } from "three";
import type { Camera } from "three";

/** 말풍선이 머무는 시간이에요. */
const BUBBLE_SECONDS = 3;
/** 머리 중심에서 글자까지의 높이예요. 귀에 가리지 않게 올려요. */
const LABEL_LIFT = 0.42;

export interface HeadLabels {
  setName(name: string): void;
  showBubble(text: string): void;
  /** 화면을 그린 뒤에 불러요. headWorld가 null이면 아바타가 안 보이는 때예요. */
  update(dt: number, camera: Camera, headWorld: Vector3 | null): void;
  dispose(): void;
}

/** 아바타 머리 위의 닉네임과 말풍선이에요. 글자는 textContent로만 넣어요. */
export function createHeadLabels(root: HTMLElement): HeadLabels {
  root.classList.add("head-label");
  const bubble = document.createElement("p");
  bubble.className = "head-bubble";
  bubble.hidden = true;
  const name = document.createElement("p");
  name.className = "head-name";
  root.append(bubble, name);

  const point = new Vector3();
  let bubbleLeft = 0;
  let shownX = NaN;
  let shownY = NaN;
  let shown = false;

  const setShown = (next: boolean): void => {
    if (shown === next) return;
    shown = next;
    root.hidden = !next;
  };

  return {
    setName(text) {
      name.textContent = text;
    },
    showBubble(text) {
      bubble.textContent = text;
      bubble.hidden = false;
      bubbleLeft = BUBBLE_SECONDS;
    },
    dispose() {
      root.remove();
    },
    update(dt, camera, headWorld) {
      if (bubbleLeft > 0) {
        bubbleLeft -= dt;
        if (bubbleLeft <= 0) bubble.hidden = true;
      }
      if (!headWorld) {
        setShown(false);
        return;
      }
      point.copy(headWorld);
      point.y += LABEL_LIFT;
      point.project(camera);
      if (point.z > 1) {
        setShown(false);
        return;
      }
      setShown(true);
      const x = Math.round(((point.x + 1) / 2) * window.innerWidth);
      const y = Math.round(((1 - point.y) / 2) * window.innerHeight);
      if (x !== shownX || y !== shownY) {
        shownX = x;
        shownY = y;
        root.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    },
  };
}
