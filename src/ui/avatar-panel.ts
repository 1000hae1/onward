import { DEFAULT_CHOICE, parseAvatarChoice, SPECIES } from "../avatar/species";
import type { AvatarChoice, Outfit } from "../avatar/species";
import type { Gesture } from "../avatar/pose";

const STORAGE_KEY = "onward.avatar";

const OUTFITS: readonly { id: Outfit; label: string }[] = [
  { id: "patient", label: "환자" },
  { id: "visitor", label: "문병객" },
];

const GESTURES: readonly { id: Gesture; label: string }[] = [
  { id: "pray", label: "손 모으기" },
  { id: "bow", label: "목례" },
];

/** 저장된 선택을 읽어요. 사생활 보호 모드처럼 저장소를 못 쓰면 없는 것으로 봐요. */
export function loadAvatarChoice(): AvatarChoice | null {
  try {
    return parseAvatarChoice(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveAvatarChoice(choice: AvatarChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // 저장하지 못해도 지금 화면에서는 고른 모습 그대로 머물러요.
  }
}

export interface AvatarPanelOptions {
  initial: AvatarChoice | null;
  onChoice(choice: AvatarChoice): void;
  onGesture(gesture: Gesture): void;
  /** 고르는 칸을 펼치거나 접을 때 알려 줘요. */
  onOpenChange(open: boolean): void;
}

export interface AvatarPanel {
  setGesturesEnabled(enabled: boolean): void;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

/** 모습을 고르고 동작을 하는 화면 아래 패널이에요. 처음 온 사람에게는 펼쳐서 보여줘요. */
export function createAvatarPanel(root: HTMLElement, options: AvatarPanelOptions): AvatarPanel {
  let choice = options.initial ?? DEFAULT_CHOICE;
  let open = options.initial === null;

  const picker = document.createElement("div");
  picker.className = "avatar-picker";
  const title = document.createElement("p");
  title.textContent = "어떤 모습으로 머물까요?";

  const speciesButtons = SPECIES.map((spec) => ({
    id: spec.id,
    element: button(spec.label, () => choose({ ...choice, species: spec.id })),
  }));
  const outfitButtons = OUTFITS.map((outfit) => ({
    id: outfit.id,
    element: button(outfit.label, () => choose({ ...choice, outfit: outfit.id })),
  }));

  const speciesRow = document.createElement("div");
  speciesRow.className = "avatar-row";
  speciesRow.append(...speciesButtons.map((item) => item.element));
  const outfitRow = document.createElement("div");
  outfitRow.className = "avatar-row";
  outfitRow.append(...outfitButtons.map((item) => item.element));
  picker.append(title, speciesRow, outfitRow);

  const actions = document.createElement("div");
  actions.className = "avatar-row avatar-actions";
  const gestureButtons = GESTURES.map((gesture) =>
    button(gesture.label, () => options.onGesture(gesture.id)),
  );
  const toggle = button("", () => {
    open = !open;
    render();
  });
  actions.append(...gestureButtons, toggle);
  root.append(picker, actions);

  function render(): void {
    picker.hidden = !open;
    options.onOpenChange(open);
    toggle.textContent = open ? "닫기" : "모습 바꾸기";
    toggle.setAttribute("aria-expanded", String(open));
    for (const item of speciesButtons) {
      item.element.setAttribute("aria-pressed", String(item.id === choice.species));
    }
    for (const item of outfitButtons) {
      item.element.setAttribute("aria-pressed", String(item.id === choice.outfit));
    }
  }

  function choose(next: AvatarChoice): void {
    choice = next;
    saveAvatarChoice(next);
    options.onChoice(next);
    render();
  }

  render();
  root.hidden = false;

  let gesturesEnabled = true;
  return {
    setGesturesEnabled(enabled) {
      if (enabled === gesturesEnabled) return;
      gesturesEnabled = enabled;
      for (const element of gestureButtons) element.disabled = !enabled;
    },
  };
}
