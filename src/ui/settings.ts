import { swapNicknameAnimal } from "../../shared/nickname";
import { SPECIES, speciesById } from "../avatar/species";
import type { Outfit, SpeciesId } from "../avatar/species";
import type { Profile } from "./profile";
import { createButton, createChoiceRow, createText } from "./widgets";

export interface SettingsOptions {
  initial: Profile;
  onChange(profile: Profile): void;
  onOpenChange(open: boolean): void;
}

/** 입장한 뒤에 모습과 고양이를 바꾸는 패널이에요. 오른쪽 위 버튼으로 열어요. */
export function createSettings(root: HTMLElement, options: SettingsOptions): void {
  let profile = options.initial;
  let open = false;

  const toggle = createButton("설정", () => setOpen(!open));
  toggle.className = "settings-toggle";

  const sheet = document.createElement("div");
  sheet.className = "ward-panel settings-sheet";

  const speciesRow = createChoiceRow<SpeciesId>(
    SPECIES.map((spec) => ({ value: spec.id, label: spec.label })),
    (species) => {
      const nickname = profile.nicknameAuto
        ? swapNicknameAnimal(profile.nickname, speciesById(species).label)
        : profile.nickname;
      change({ ...profile, species, nickname });
    },
  );
  const outfitRow = createChoiceRow<Outfit>(
    [
      { value: "patient", label: "환자" },
      { value: "visitor", label: "문병객" },
    ],
    (outfit) => change({ ...profile, outfit }),
  );
  const catRow = createChoiceRow<boolean>(
    [
      { value: true, label: "켜기" },
      { value: false, label: "끄기" },
    ],
    (withCat) => change({ ...profile, withCat }),
  );
  sheet.append(
    createText("p", "모습 바꾸기"),
    speciesRow.element,
    outfitRow.element,
    createText("p", "고양이와 함께 다니기"),
    catRow.element,
    createButton("닫기", () => setOpen(false)),
  );
  root.append(toggle, sheet);

  function render(): void {
    sheet.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    speciesRow.select(profile.species);
    outfitRow.select(profile.outfit);
    catRow.select(profile.withCat);
  }

  function setOpen(next: boolean): void {
    open = next;
    render();
    options.onOpenChange(open);
  }

  function change(next: Profile): void {
    profile = next;
    render();
    options.onChange(profile);
  }

  render();
  root.hidden = false;
}
