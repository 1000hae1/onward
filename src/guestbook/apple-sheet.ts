/** 사과 달기 시트예요. 이름(2~10자), 한마디 5개 가운데 하나, 짧은 글(선택, 100자)을 받아요. */
import { APPLE_NOTE_MAX, APPLE_PHRASES, appleProblemText, checkApple } from "../../shared/guestbook-rules";
import { NICKNAME_MAX } from "../../shared/nickname";

export interface AppleSheetOptions {
  /** 이 기기에 저장된 닉네임이 있으면 이름 칸에 미리 넣어요. */
  initialName: string;
  /** 서버에 보내요. 거절되면 안내 문구를, 잘 달리면 null을 돌려줘요. */
  submit(draft: { name: string; phrase: number; note: string | null }): Promise<string | null>;
}

export interface AppleSheet {
  open(): void;
  close(): void;
}

let sheetCount = 0;

export function createAppleSheet(host: HTMLElement, options: AppleSheetOptions): AppleSheet {
  const id = `gb-sheet-${++sheetCount}`;
  const backdrop = document.createElement("div");
  backdrop.className = "gb-backdrop";
  backdrop.hidden = true;
  const sheet = document.createElement("form");
  sheet.className = "gb-sheet";
  sheet.hidden = true;
  sheet.noValidate = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", `${id}-title`);

  const handle = document.createElement("div");
  handle.className = "gb-handle";
  handle.setAttribute("aria-hidden", "true");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gb-text-button gb-sheet-close";
  close.textContent = "닫기";
  const title = document.createElement("h2");
  title.id = `${id}-title`;
  title.textContent = "사과 하나 달아 주기";

  const nameField = document.createElement("label");
  nameField.className = "gb-field";
  nameField.append(document.createTextNode("이름"));
  const name = document.createElement("input");
  name.type = "text";
  name.setAttribute("autocomplete", "nickname");
  name.maxLength = NICKNAME_MAX;
  name.placeholder = "2~10자";
  name.value = options.initialName;
  nameField.append(name);

  const chips = document.createElement("fieldset");
  chips.className = "gb-chips";
  const legend = document.createElement("legend");
  legend.textContent = "한마디";
  chips.append(legend);
  let phrase = 0;
  const chipButtons = APPLE_PHRASES.map((text, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "gb-chip";
    chip.textContent = text;
    chip.addEventListener("click", () => {
      phrase = index;
      renderChips();
    });
    chips.append(chip);
    return chip;
  });
  const renderChips = (): void => {
    chipButtons.forEach((chip, index) => chip.setAttribute("aria-pressed", String(index === phrase)));
  };

  const noteField = document.createElement("label");
  noteField.className = "gb-field";
  noteField.append(document.createTextNode("짧은 글 (선택)"));
  const note = document.createElement("textarea");
  note.maxLength = APPLE_NOTE_MAX;
  note.rows = 3;
  const counter = document.createElement("span");
  counter.className = "gb-counter";
  counter.setAttribute("aria-live", "off");
  const renderCounter = (): void => {
    counter.textContent = `${Array.from(note.value).length} / ${APPLE_NOTE_MAX}`;
  };
  note.addEventListener("input", renderCounter);
  noteField.append(note, counter);

  const error = document.createElement("p");
  error.className = "gb-error";
  error.setAttribute("role", "alert");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "gb-primary";
  submit.textContent = "사과 달기";

  sheet.append(handle, close, title, nameField, chips, noteField, error, submit);
  host.append(backdrop, sheet);

  let opener: HTMLElement | null = null;
  const hide = (): void => {
    sheet.hidden = true;
    backdrop.hidden = true;
    opener?.focus();
  };

  close.addEventListener("click", hide);
  backdrop.addEventListener("click", hide);
  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  sheet.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const draft = { name: name.value, phrase, note: note.value };
    const checked = checkApple(draft);
    if (!checked.ok) {
      error.textContent = appleProblemText(checked);
      (checked.field === "note" ? note : checked.field === "name" ? name : chipButtons[0]).focus();
      return;
    }
    error.textContent = "";
    submit.disabled = true;
    void options.submit(checked.value).then((problem) => {
      submit.disabled = false;
      if (problem) {
        error.textContent = problem;
        return;
      }
      note.value = "";
      renderCounter();
      hide();
    });
  });

  return {
    open() {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      error.textContent = "";
      renderChips();
      renderCounter();
      backdrop.hidden = false;
      sheet.hidden = false;
      (name.value ? chipButtons[phrase] : name).focus();
    },
    close: hide,
  };
}
