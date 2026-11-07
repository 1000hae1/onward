import { checkNickname, nicknameMessage, swapNicknameAnimal } from "../../shared/nickname";
import { SPECIES, speciesById } from "../avatar/species";
import type { Outfit, SpeciesId } from "../avatar/species";
import type { Profile } from "./profile";
import { createButton, createChoiceRow, createText } from "./widgets";

export interface EntryOptions {
  initial: Profile;
  /** 고르는 동안 뒤의 병동에서 바로 보여 줘요. */
  onPreview(profile: Profile): void;
  onEnter(profile: Profile): void;
  /** 서버가 닉네임을 받지 않아 다시 열 때 보여 줄 안내예요. */
  message?: string;
}

/** 병동에 들어가기 전에 모습과 닉네임, 고양이와 함께 갈지 고르는 화면이에요. */
export function createEntryScreen(root: HTMLElement, options: EntryOptions): void {
  let profile = options.initial;
  let serverMessage = options.message ?? "";

  const form = document.createElement("form");
  form.className = "ward-panel entry-form";
  form.noValidate = true;

  const speciesRow = createChoiceRow<SpeciesId>(
    SPECIES.map((spec) => ({ value: spec.id, label: spec.label })),
    (species) => {
      const nickname = profile.nicknameAuto
        ? swapNicknameAnimal(profile.nickname, speciesById(species).label)
        : profile.nickname;
      if (profile.nicknameAuto) input.value = nickname;
      update({ ...profile, species, nickname });
    },
  );
  const outfitRow = createChoiceRow<Outfit>(
    [
      { value: "patient", label: "환자" },
      { value: "visitor", label: "문병객" },
    ],
    (outfit) => update({ ...profile, outfit }),
  );

  const nameLabel = createText("label", "닉네임");
  nameLabel.setAttribute("for", "entry-nickname");
  const input = document.createElement("input");
  input.id = "entry-nickname";
  input.type = "text";
  input.autocomplete = "off";
  input.enterKeyHint = "go";
  input.value = profile.nickname;
  input.addEventListener("input", () => {
    serverMessage = "";
    update({ ...profile, nickname: input.value, nicknameAuto: false });
  });
  const message = createText("p", "");
  message.className = "entry-message";
  message.setAttribute("aria-live", "polite");

  const catQuestion = createText("p", "고양이와 함께 들어갈까요?");
  const catRow = createChoiceRow<boolean>(
    [
      { value: true, label: "함께 갈게요" },
      { value: false, label: "혼자 갈게요" },
    ],
    (withCat) => update({ ...profile, withCat }),
  );

  const enter = createButton("병동에 들어갈게요", () => undefined);
  enter.type = "submit";
  enter.className = "entry-enter";

  form.append(
    createText("h1", "어떤 모습으로 머물까요?"),
    speciesRow.element,
    outfitRow.element,
    nameLabel,
    input,
    message,
    catQuestion,
    catRow.element,
    enter,
  );
  root.append(form);

  function render(): void {
    speciesRow.select(profile.species);
    outfitRow.select(profile.outfit);
    catRow.select(profile.withCat);
    const checked = checkNickname(profile.nickname);
    message.textContent = checked.ok ? serverMessage : nicknameMessage(checked.problem);
    enter.disabled = !checked.ok;
  }

  function update(next: Profile): void {
    profile = next;
    render();
    options.onPreview(profile);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const checked = checkNickname(profile.nickname);
    if (!checked.ok) return;
    root.hidden = true;
    root.replaceChildren();
    options.onEnter({ ...profile, nickname: checked.value });
  });

  render();
  options.onPreview(profile);
  root.hidden = false;
}
