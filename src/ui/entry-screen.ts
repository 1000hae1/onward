import { checkNickname, nicknameMessage, swapNicknameAnimal } from "../../shared/nickname";
import { SPECIES, speciesById } from "../avatar/species";
import type { Outfit, SpeciesId } from "../avatar/species";
import { avatarPortrait } from "../avatar/portraits";
import type { Profile } from "./profile";
import { createButton, createChoiceRow, createPictureChoiceRow, createText } from "./widgets";
import { entryHeading } from "./entry-text";

export interface EntryOptions {
  initial: Profile;
  /** 고르는 동안 뒤의 병동에서 바로 보여 줘요. */
  onPreview(profile: Profile): void;
  onEnter(profile: Profile): void;
  /** 서버가 닉네임을 받지 않아 다시 열 때 보여 줄 안내예요. */
  message?: string;
  /** 방명록 링크로 왔으면 "따뜻한 곰님에게 문병 왔어요"처럼 바뀌어요. */
  title?: string;
  /** 방명록 링크로 왔으면 옷은 고르지 않고 평상복이에요. */
  lockOutfit?: Outfit;
  /** 이 기기에 저장된 모습과 게스트 토큰이 있으면 "돌아왔네요"로 맞아요. */
  returning?: boolean;
}

/** 병동에 들어가기 전에 모습과 닉네임, 고양이와 함께 갈지 고르는 화면이에요. */
export function createEntryScreen(root: HTMLElement, options: EntryOptions): void {
  const lock = options.lockOutfit;
  let profile = lock ? { ...options.initial, outfit: lock } : options.initial;
  let serverMessage = options.message ?? "";

  const form = document.createElement("form");
  form.className = "ward-panel entry-form";
  form.noValidate = true;

  const speciesRow = createPictureChoiceRow<SpeciesId>(
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
  outfitRow.element.hidden = lock !== undefined;

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

  const heading = entryHeading({
    returning: options.returning === true,
    nickname: options.initial.nickname,
    visitTitle: options.title,
  });
  const enter = createButton(heading.enter, () => undefined);
  enter.type = "submit";
  enter.className = "entry-enter";

  const headingNote = heading.note ? createText("p", heading.note) : null;
  if (headingNote) headingNote.className = "entry-note";
  form.append(
    createText("h1", heading.title),
    ...(headingNote ? [headingNote] : []),
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
    speciesRow.setPictures((species) => avatarPortrait(species, profile.outfit));
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
