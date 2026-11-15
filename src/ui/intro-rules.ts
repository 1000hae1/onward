/** 처음 온 분에게 보여 주는 소개 카드의 규칙과 문구예요. 화면과 상관없는 순수 함수예요. */

/** 소개 카드를 어디서 열었는지예요. 통계에도 이 단어만 보내요. */
export type IntroSource = "first" | "settings";

/**
 * 동물 고르기 앞에 소개 카드를 보여 줄지 정해요.
 * - 이 기기에 기억된 자리(저장된 모습 + 게스트 토큰)가 있으면 "돌아왔네요"로 바로 가요.
 * - 방명록·문병 링크로 온 분은 링크 주인에게 가는 길이라 보여 주지 않아요(링크가 닫혔어도 마찬가지예요).
 */
export function shouldShowIntro(input: { returning: boolean; viaLink: boolean }): boolean {
  return !input.returning && !input.viaLink;
}

export interface IntroItem {
  icon: "tree" | "hands" | "moon";
  /** 굵게 보여 줄 낱말이에요. text 안에 그대로 들어 있어야 해요. */
  strong?: string;
  text: string;
  highlight: boolean;
}

export const INTRO_TEXT = {
  title: "오늘 밤, 옆 침대에 누군가 있어요",
  subtitle: "잠 못 드는 밤, 환자복 입은 동물들이 함께 머물고 있는 병실이에요.",
  items: [
    { icon: "tree", strong: "사과나무", text: "보고 싶은 얼굴들에게 사과나무를 보내 보세요. 오지 못해도 마음은 닿아요.", highlight: true },
    { icon: "hands", text: "말 없이 두 손 모으면, 옆 침대 머리맡에 평안이 내려앉아요.", highlight: false },
    { icon: "moon", text: "어디가 아픈지 묻지 않아요. 누워서 쉬다 가셔도 돼요.", highlight: false },
  ] as const satisfies readonly IntroItem[],
  enter: "병실로 들어가기",
  /** 설정 메뉴의 버튼 이름이에요. */
  settingsLabel: "온기병동 소개",
} as const;

/** 굵은 낱말을 기준으로 글을 앞·굵게·뒤로 나눠요. 낱말이 없으면 통째로 앞에 둬요. */
export function splitStrong(text: string, strong?: string): { before: string; strong: string; after: string } {
  const at = strong ? text.indexOf(strong) : -1;
  if (!strong || at < 0) return { before: text, strong: "", after: "" };
  return { before: text.slice(0, at), strong, after: text.slice(at + strong.length) };
}
