/**
 * 오늘 같은 병실에서 만난 사람들이에요. 이 브라우저에만 저장해요.
 * 공개 id가 아니라 서버가 준 평안 주소와 닉네임, 동물만 담고, 한국 날짜가 바뀌면 비워요.
 */
import { ADDRESS_PATTERN } from "../../shared/left-blessings.ts";

export interface MetPerson {
  address: string;
  nickname: string;
  animal: string;
}

export interface MetList {
  day: string;
  people: MetPerson[];
}

/** 너무 길어지지 않게 최근에 만난 사람만 둬요. */
const MAX_PEOPLE = 60;
const STORAGE_KEY = "onward.met";

/** 저장된 목록을 읽어요. 날짜가 지났거나 형식이 맞지 않으면 빈 목록이에요. */
export function parseMetList(raw: string | null, today: string): MetList {
  const empty: MetList = { day: today, people: [] };
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw) as Partial<MetList>;
    if (value.day !== today || !Array.isArray(value.people)) return empty;
    const people = value.people.filter(
      (person): person is MetPerson =>
        typeof person?.address === "string" &&
        ADDRESS_PATTERN.test(person.address) &&
        typeof person.nickname === "string" &&
        typeof person.animal === "string",
    );
    return { day: today, people: people.slice(0, MAX_PEOPLE) };
  } catch {
    return empty;
  }
}

/** 만난 사람을 앞에 더해요. 같은 주소나 같은 닉네임이 있으면 새 것으로 바꿔요. */
export function rememberPerson(list: MetList, person: MetPerson, today: string): MetList {
  const base = list.day === today ? list.people : [];
  const others = base.filter((known) => known.address !== person.address && known.nickname !== person.nickname);
  return { day: today, people: [person, ...others].slice(0, MAX_PEOPLE) };
}

export function loadMetList(today: string): MetList {
  try {
    return parseMetList(window.localStorage.getItem(STORAGE_KEY), today);
  } catch {
    return { day: today, people: [] };
  }
}

export function saveMetList(list: MetList): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 저장하지 못해도 이번 방문 동안은 목록이 남아요.
  }
}
