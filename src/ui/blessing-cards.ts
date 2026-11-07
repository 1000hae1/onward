import { bedCardText, inboxCardText } from "../../shared/left-blessings";
import type { BlessingCard } from "../../shared/left-blessings";
import { createButton, createText } from "./widgets";

/** 카드가 하나씩 나타나는 간격과 머무는 시간이에요. */
const CARD_GAP_SECONDS = 1.8;
const CARD_STAY_SECONDS = 7;

export interface BlessingCards {
  /** 받은 침대에 남겨져 있던 평안을 카드로 하나씩 보여 줘요. */
  showBedCards(cards: readonly BlessingCard[], nowMs: number): void;
  /** 내가 없는 동안 도착한 평안을 모아 보여 주고, 하나씩 열어볼 수 있게 해요. */
  showInbox(cards: readonly BlessingCard[], nowMs: number): void;
  update(dt: number): void;
}

/** 남겨진 평안을 보여 주는 화면이에요. 닉네임이 들어간 글자는 모두 textContent로 넣어요. */
export function createBlessingCards(cardsRoot: HTMLElement, inboxRoot: HTMLElement): BlessingCards {
  const queue: { text: string; wait: number }[] = [];
  const shown: { element: HTMLElement; left: number }[] = [];

  const dismiss = (element: HTMLElement): void => {
    element.classList.add("left-card-out");
    // 사라지는 모습이 끝나면 지워요. 움직임을 줄이면 바로 사라져요.
    element.addEventListener("animationend", () => element.remove(), { once: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) element.remove();
  };

  return {
    showBedCards(cards, nowMs) {
      cards.forEach((card, index) => {
        queue.push({ text: bedCardText(card, nowMs), wait: index === 0 ? 0.6 : CARD_GAP_SECONDS });
      });
    },
    showInbox(cards, nowMs) {
      if (cards.length === 0) return;
      inboxRoot.replaceChildren();
      const panel = document.createElement("div");
      panel.className = "ward-panel inbox-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "내가 없는 동안 도착한 평안");
      const list = document.createElement("div");
      list.className = "inbox-list";
      cards.forEach((card, index) => {
        const open = createButton(`${index + 1}번째 평안 열어보기`, () => {
          const text = createText("p", inboxCardText(card, nowMs));
          text.className = "inbox-opened";
          open.replaceWith(text);
        });
        list.append(open);
      });
      panel.append(
        createText("h1", `내가 없는 동안 평안 ${cards.length}개가 도착했어요`),
        list,
        createButton("닫기", () => {
          inboxRoot.hidden = true;
          inboxRoot.replaceChildren();
        }),
      );
      inboxRoot.append(panel);
      inboxRoot.hidden = false;
    },
    update(dt) {
      if (queue.length > 0) {
        queue[0].wait -= dt;
        if (queue[0].wait <= 0) {
          const next = queue.shift() as { text: string };
          const element = createText("p", next.text);
          element.className = "left-card";
          element.setAttribute("role", "status");
          element.addEventListener("click", () => dismiss(element));
          cardsRoot.append(element);
          shown.push({ element, left: CARD_STAY_SECONDS });
        }
      }
      for (let index = shown.length - 1; index >= 0; index--) {
        shown[index].left -= dt;
        if (shown[index].left <= 0) {
          dismiss(shown[index].element);
          shown.splice(index, 1);
        }
      }
    },
  };
}
