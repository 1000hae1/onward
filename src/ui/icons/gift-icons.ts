import { GIFTS } from "../../../shared/gestures";
import { hoppangIcon } from "./hoppang";
import { persimmonIcon } from "./persimmon";

/** 선물 번호(shared/gestures.ts의 GIFTS 순서)마다의 아이콘이에요. 모두 aria-hidden이라 낭독기는 이름만 읽어요. */
export function giftIcon(item: number): Element | null {
  const name = GIFTS[item] as (typeof GIFTS)[number] | undefined;
  switch (name) {
    case "네잎클로버":
      return emojiIcon("🍀");
    case "오잎클로버": {
      // 오잎클로버는 귀한 선물이라 오른쪽 위에 작은 반짝임을 겹쳐요.
      const icon = emojiIcon("🍀");
      icon.classList.add("gift-icon-rare");
      const sparkle = document.createElement("span");
      sparkle.className = "gift-icon-sparkle";
      sparkle.textContent = "✨";
      icon.append(sparkle);
      return icon;
    }
    case "귤":
      return emojiIcon("🍊");
    case "홍시":
      return persimmonIcon();
    case "호빵":
      return hoppangIcon();
    default:
      return null;
  }
}

function emojiIcon(emoji: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "gift-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = emoji;
  return icon;
}
