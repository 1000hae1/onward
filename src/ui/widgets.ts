/** 화면 패널에서 함께 쓰는 작은 부품이에요. 글자는 모두 textContent로 넣어요. */

export function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
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

export function createText(tag: "h1" | "p" | "label", text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

