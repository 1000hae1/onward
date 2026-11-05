/** 닉네임 규칙이에요. 서버를 붙이면 Worker에서도 같은 규칙으로 검사해요. */

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;

export type NicknameProblem = "short" | "long" | "digits" | "url" | "banned";

export type NicknameCheck =
  | { ok: true; value: string }
  | { ok: false; problem: NicknameProblem };

const ADJECTIVES = [
  "졸린",
  "따뜻한",
  "포근한",
  "느긋한",
  "잔잔한",
  "다정한",
  "고요한",
  "말랑한",
  "폭신한",
  "나른한",
] as const;

/** 시작 목록이에요. 실제로 열기 전에 검토해서 늘려야 해요. */
const BANNED_WORDS = [
  "시발",
  "씨발",
  "ㅅㅂ",
  "병신",
  "ㅂㅅ",
  "개새끼",
  "새끼",
  "좆",
  "존나",
  "지랄",
  "섹스",
  "fuck",
  "shit",
  "sex",
  "관리자",
  "운영자",
  "의사",
  "간호사",
] as const;

const REPEATED_DIGITS = /\p{Nd}{2,}/u;
const LOOKS_LIKE_URL = /https?:|www\.|[\p{L}\p{N}]\.[a-z]{2,}|닷컴/iu;
const SEPARATORS = /[\s\p{P}\p{S}\p{C}]/gu;

const MESSAGES: Record<NicknameProblem, string> = {
  short: `닉네임은 ${NICKNAME_MIN}자 이상으로 지어 주세요.`,
  long: `닉네임은 ${NICKNAME_MAX}자까지 쓸 수 있어요.`,
  digits: "숫자를 이어서 쓸 수는 없어요.",
  url: "주소처럼 보이는 글자는 쓸 수 없어요.",
  banned: "다른 닉네임으로 지어 주세요.",
};

export function nicknameMessage(problem: NicknameProblem): string {
  return MESSAGES[problem];
}

/** 앞뒤 공백을 지우고 사이 공백은 하나로 줄여요. 보이지 않는 글자도 지워요. */
function tidy(raw: string): string {
  return raw
    .replace(/\p{C}/gu, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function checkNickname(raw: string): NicknameCheck {
  const value = tidy(raw);
  const length = Array.from(value).length;
  if (length < NICKNAME_MIN) return { ok: false, problem: "short" };
  if (length > NICKNAME_MAX) return { ok: false, problem: "long" };
  if (LOOKS_LIKE_URL.test(value)) return { ok: false, problem: "url" };
  if (REPEATED_DIGITS.test(value)) return { ok: false, problem: "digits" };
  // 띄어 쓰거나 기호를 끼워도 걸러지도록 붙여서 살펴봐요.
  const squeezed = value.replace(SEPARATORS, "").toLowerCase();
  if (BANNED_WORDS.some((word) => squeezed.includes(word))) return { ok: false, problem: "banned" };
  return { ok: true, value };
}

/** '형용사 + 동물' 닉네임을 지어요. pick은 0 이상 1 미만의 수예요. */
export function autoNickname(animal: string, pick: number): string {
  return `${ADJECTIVES[Math.floor(pick * ADJECTIVES.length) % ADJECTIVES.length]} ${animal}`;
}

/** 닉네임 앞의 형용사는 두고 동물만 바꿔요. 자동으로 지은 이름에만 써요. */
export function swapNicknameAnimal(nickname: string, animal: string): string {
  const adjective = ADJECTIVES.find((word) => nickname.startsWith(`${word} `)) ?? ADJECTIVES[0];
  return `${adjective} ${animal}`;
}
