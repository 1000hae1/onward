/** 화면 패널에서 함께 쓰는 작은 부품이에요. 글자는 모두 textContent로 넣어요. */

export function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

/** 앞에 이모지가 붙은 버튼이에요. 이모지는 꾸밈이라 화면 낭독기는 글자만 읽어요. */
export function createEmojiButton(emoji: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = createButton("", onClick);
  element.classList.add("emoji-button");
  const icon = document.createElement("span");
  icon.className = "button-emoji";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = emoji;
  const text = document.createElement("span");
  text.className = "button-label";
  text.textContent = label;
  element.append(icon, text);
  return element;
}

export interface ChoiceRow<T> {
  readonly element: HTMLElement;
  select(value: T): void;
}

/** 여럿 중 하나를 고르는 버튼 줄이에요. */
export function createChoiceRow<T>(
  items: readonly { value: T; label: string }[],
  onPick: (value: T) => void,
): ChoiceRow<T> {
  const element = document.createElement("div");
  element.className = "ward-row";
  const buttons = items.map((item) => ({
    value: item.value,
    button: createButton(item.label, () => onPick(item.value)),
  }));
  element.append(...buttons.map((item) => item.button));
  return {
    element,
    select(value) {
      for (const item of buttons) {
        item.button.setAttribute("aria-pressed", String(item.value === value));
      }
    },
  };
}

export interface PictureChoiceRow<T> extends ChoiceRow<T> {
  /** 카드마다 그림 주소를 정해요. null이면 그림 없이 이름만 보여요. */
  setPictures(source: (value: T) => string | null): void;
}

/** 그림과 이름이 함께 있는 고르기 카드 줄이에요. 그림은 꾸밈이라 읽어 주지 않아요. */
export function createPictureChoiceRow<T>(
  items: readonly { value: T; label: string }[],
  onPick: (value: T) => void,
): PictureChoiceRow<T> {
  const element = document.createElement("div");
  element.className = "ward-row picture-row";
  const cards = items.map((item) => {
    const button = createButton("", () => onPick(item.value));
    button.className = "picture-choice";
    const picture = document.createElement("img");
    picture.alt = "";
    picture.hidden = true;
    picture.decoding = "async";
    const name = document.createElement("span");
    name.textContent = item.label;
    button.append(picture, name);
    return { value: item.value, button, picture };
  });
  element.append(...cards.map((card) => card.button));
  return {
    element,
    select(value) {
      for (const card of cards) {
        card.button.setAttribute("aria-pressed", String(card.value === value));
      }
    },
    setPictures(source) {
      for (const card of cards) {
        const next = source(card.value);
        card.picture.hidden = next === null;
        if (next !== null && card.picture.getAttribute("src") !== next) card.picture.src = next;
      }
    },
  };
}

export function createText(tag: "h1" | "p" | "label", text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

