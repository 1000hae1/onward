import { HUG_ANSWER_MS } from "../../shared/hug-rules";
import { FAREWELL_MS } from "../../shared/discharge-rules";
import { createButton, createText } from "./widgets";

/** 배웅하기를 누른 뒤 고맙다는 말을 잠깐 보여 주는 시간이에요. */
const THANKS_SECONDS = 2;
/** 배웅 카드는 이만큼 지나면 저절로 입장 화면으로 넘어가요. */
const CARD_SECONDS = 12;

export interface Moments {
  /** 안아 주기 요청이에요. 10초 안에 답이 없으면 조용히 닫고 아무것도 보내지 않아요. */
  hugOffer(text: string, onAnswer: (accept: boolean) => void): void;
  /** 같은 병실의 누군가 퇴원해요. [배웅하기]는 1분 동안만 보여요. */
  farewell(id: string, text: string, onFarewell: () => void): void;
  /** 그 사람이 나가면 배웅 안내를 닫아요. */
  dismissFarewell(id: string): void;
  /** 퇴원하는 사람에게 보여 주는 마지막 카드예요. */
  farewellCard(text: string, onDone: () => void): void;
  update(dt: number): void;
}

interface Timed {
  element: HTMLElement;
  left: number;
  onTimeout?: () => void;
}

/** 화면 가운데 아래쪽에 잠깐 뜨는 작은 카드들이에요. 글자는 모두 textContent로만 넣어요. */
export function createMoments(root: HTMLElement): Moments {
  let hug: Timed | null = null;
  const farewells = new Map<string, Timed>();
  let card: Timed | null = null;

  const panel = (): HTMLElement => {
    const element = document.createElement("div");
    element.className = "ward-panel moment-card";
    return element;
  };

  const sync = (): void => {
    root.hidden = !hug && farewells.size === 0 && !card;
  };

  const closeHug = (): void => {
    hug?.element.remove();
    hug = null;
    sync();
  };

  return {
    hugOffer(text, onAnswer) {
      // 먼저 온 요청은 답하지 않은 채로 닫아요. 보낸 분께는 아무 말도 가지 않아요.
      closeHug();
      const element = panel();
      element.setAttribute("role", "dialog");
      element.setAttribute("aria-label", "안아 주기 요청");
      const row = document.createElement("div");
      row.className = "ward-row";
      row.append(
        createButton("안길게요", () => {
          closeHug();
          onAnswer(true);
        }),
        createButton("다음에요", () => {
          closeHug();
          onAnswer(false);
        }),
      );
      element.append(createText("p", text), row);
      root.append(element);
      hug = { element, left: HUG_ANSWER_MS / 1000 };
      sync();
    },
    farewell(id, text, onFarewell) {
      farewells.get(id)?.element.remove();
      const element = panel();
      const button = createButton("배웅하기", () => {
        onFarewell();
        element.replaceChildren(createText("p", "배웅해 드렸어요"));
        const entry = farewells.get(id);
        if (entry) entry.left = Math.min(entry.left, THANKS_SECONDS);
      });
      const row = document.createElement("div");
      row.className = "ward-row";
      row.append(button);
      element.append(createText("p", text), row);
      root.append(element);
      farewells.set(id, { element, left: FAREWELL_MS / 1000 });
      sync();
    },
    dismissFarewell(id) {
      const entry = farewells.get(id);
      if (!entry) return;
      entry.element.remove();
      farewells.delete(id);
      sync();
    },
    farewellCard(text, onDone) {
      card?.element.remove();
      const element = panel();
      element.classList.add("farewell-card");
      element.setAttribute("role", "dialog");
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        element.remove();
        card = null;
        sync();
        onDone();
      };
      element.append(
        createText("h1", text),
        createText("p", "언제든 다시 들러 주세요."),
        createButton("입장 화면으로", finish),
      );
      root.append(element);
      card = { element, left: CARD_SECONDS, onTimeout: finish };
      sync();
    },
    update(dt) {
      if (hug) {
        hug.left -= dt;
        if (hug.left <= 0) closeHug();
      }
      for (const [id, entry] of farewells) {
        entry.left -= dt;
        if (entry.left <= 0) {
          entry.element.remove();
          farewells.delete(id);
          sync();
        }
      }
      if (card) {
        card.left -= dt;
        if (card.left <= 0) card.onTimeout?.();
      }
    },
  };
}
