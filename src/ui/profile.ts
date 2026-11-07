import { checkNickname, autoNickname } from "../../shared/nickname.ts";
import { SPECIES, speciesById } from "../avatar/species.ts";
import type { Outfit, SpeciesId } from "../avatar/species.ts";

const STORAGE_KEY = "onward.profile";

/** 입장할 때 고른 것들이에요. 이 기기에만 저장해요. */
export interface Profile {
  species: SpeciesId;
  outfit: Outfit;
  nickname: string;
  /** 자동으로 지은 이름이면 동물을 바꿀 때 함께 바뀌어요. 직접 고치면 false예요. */
  nicknameAuto: boolean;
  withCat: boolean;
}

export function defaultProfile(pick: number): Profile {
  const species = SPECIES[0];
  return {
    species: species.id,
    outfit: "patient",
    nickname: autoNickname(speciesById(species.id).label, pick),
    nicknameAuto: true,
    withCat: false,
  };
}

/** 저장해 둔 값을 읽어요. 하나라도 형식이 맞지 않으면 없는 것으로 봐요. */
export function parseProfile(raw: string | null): Profile | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { species, outfit, nickname, nicknameAuto, withCat } = value as Record<string, unknown>;
  const spec = SPECIES.find((candidate) => candidate.id === species);
  if (!spec || (outfit !== "patient" && outfit !== "visitor")) return null;
  if (typeof nickname !== "string" || typeof nicknameAuto !== "boolean" || typeof withCat !== "boolean") {
    return null;
  }
  const checked = checkNickname(nickname);
  if (!checked.ok) return null;
  return { species: spec.id, outfit, nickname: checked.value, nicknameAuto, withCat };
}

/** 사생활 보호 모드처럼 저장소를 못 쓰면 없는 것으로 봐요. */
export function loadProfile(): Profile | null {
  try {
    return parseProfile(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // 저장하지 못해도 지금 화면에서는 고른 그대로 머물러요.
  }
}
