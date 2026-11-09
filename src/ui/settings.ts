import { swapNicknameAnimal } from "../../shared/nickname";
import { SPECIES, speciesById } from "../avatar/species";
import type { Outfit, SpeciesId } from "../avatar/species";
import { avatarPortrait } from "../avatar/portraits";
import type { Profile } from "./profile";
import { createButton, createChoiceRow, createPictureChoiceRow, createText } from "./widgets";

export interface SettingsOptions {
  initial: Profile;
  onChange(profile: Profile): void;
  onOpenChange(open: boolean): void;
  /** 문병 링크로 왔으면 옷은 바꿀 수 없어요. */
  lockOutfit?: boolean;
}

export interface Settings {
  /** 서버가 닉네임을 바꿨을 때처럼 밖에서 바뀐 값을 맞춰요. */
  setProfile(profile: Profile): void;
}

function link(text: string, href: string, newTab: boolean): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.className = "settings-link";
  anchor.href = href;
  anchor.textContent = text;
  if (newTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  return anchor;
}

/** 입장한 뒤에 모습과 고양이를 바꾸는 패널이에요. 오른쪽 위 버튼으로 열어요. */
export function createSettings(root: HTMLElement, options: SettingsOptions): Settings {
  let profile = options.initial;
  let open = false;

  const toggle = createButton("설정", () => setOpen(!open));
  toggle.className = "settings-toggle";

  const sheet = document.createElement("div");
  sheet.className = "ward-panel settings-sheet";

  const speciesRow = createPictureChoiceRow<SpeciesId>(
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
  outfitRow.element.hidden = options.lockOutfit === true;
  const catRow = createChoiceRow<boolean>(
    [
      { value: true, label: "켜기" },
      { value: false, label: "끄기" },
    ],
    (withCat) => change({ ...profile, withCat }),
  );
  const hugRow = createChoiceRow<boolean>(
    [
      { value: false, label: "받기" },
      { value: true, label: "받지 않기" },
    ],
    (hugsOff) => change({ ...profile, hugsOff }),
  );
  sheet.append(
    createText("p", "모습 바꾸기"),
    speciesRow.element,
    outfitRow.element,
    createText("p", "고양이와 함께 다니기"),
    catRow.element,
    createText("p", "안아 주기 요청"),
    hugRow.element,
    (() => {
      const help = document.createElement("div");
      help.className = "settings-help";
      help.append(
        createText("p", "마음이 많이 힘들 때는 109(자살예방상담전화, 24시간)에 전화해 주세요."),
        link("109에 전화하기", "tel:109", false),
        link("개인정보 처리방침", "/privacy", true),
      );
      return help;
    })(),
    createButton("닫기", () => setOpen(false)),
  );
  root.append(toggle, sheet);

  function render(): void {
    sheet.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    speciesRow.select(profile.species);
    speciesRow.setPictures((species) => avatarPortrait(species, profile.outfit));
    outfitRow.select(profile.outfit);
    catRow.select(profile.withCat);
    hugRow.select(profile.hugsOff);
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
  return {
    setProfile(next) {
      profile = next;
      render();
    },
  };
}
