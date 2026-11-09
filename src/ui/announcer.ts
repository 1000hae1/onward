/**
 * 화면 낭독기가 읽는 안내예요. 화면에는 보이지 않는 aria-live="polite" 영역 하나에 넣어요.
 * 글자는 textContent로만 넣어요.
 */

/** 같은 문장이 이 시간 안에 다시 오면 한 번만 읽어요. */
export const ANNOUNCE_GAP_MS = 1500;

export interface LastAnnounce {
  text: string;
  at: number;
}

export function shouldAnnounce(last: LastAnnounce | null, text: string, nowMs: number): boolean {
  if (text.trim() === "") return false;
  return last === null || last.text !== text || nowMs - last.at >= ANNOUNCE_GAP_MS;
}

/** 받침이 있으면 "을", 없으면 "를"이에요. 한글이 아니면 "을(를)"로 둬요. */
export function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "을(를)";
  return code % 28 === 0 ? "를" : "을";
}

export function blessedMeText(nickname: string): string {
  return `${nickname}님이 평안을 빌어 주었어요.`;
}

export function giftForMeText(nickname: string, gift: string): string {
  return `${nickname}님이 머리맡에 ${gift}${objectParticle(gift)} 놓아 주었어요.`;
}

export function bowText(nickname: string, phrase: string): string {
  return `${nickname}님이 목례하며 "${phrase}" 하고 건넸어요.`;
}

export interface Announcer {
  say(text: string): void;
}

export function createAnnouncer(root: HTMLElement): Announcer {
  let last: LastAnnounce | null = null;
  return {
    say(text) {
      const now = Date.now();
      if (!shouldAnnounce(last, text, now)) return;
      last = { text, at: now };
      // 같은 글이 다시 와도 읽도록 비웠다가 다음 프레임에 넣어요.
      root.textContent = "";
      window.requestAnimationFrame(() => {
        root.textContent = text;
      });
    },
  };
}
