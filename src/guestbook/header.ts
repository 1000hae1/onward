/** 방명록 위쪽 머리글이에요. "온기병동 방명록" / "따뜻한 곰님의 사과나무" / "지금까지 사과 12개가 열렸어요" */
import { appleCountText, GUESTBOOK_HEADER, guestbookTitle } from "../../shared/guestbook-rules";

export interface GuestbookHeader {
  readonly element: HTMLElement;
  set(ownerNickname: string, count: number): void;
}

export function createGuestbookHeader(level: "h1" | "h2"): GuestbookHeader {
  const element = document.createElement("header");
  element.className = "gb-header";
  const eyebrow = document.createElement("p");
  eyebrow.className = "gb-eyebrow";
  eyebrow.textContent = GUESTBOOK_HEADER;
  const title = document.createElement(level);
  title.className = "gb-title";
  const count = document.createElement("p");
  count.className = "gb-count";
  count.setAttribute("aria-live", "polite");
  element.append(eyebrow, title, count);
  return {
    element,
    set(ownerNickname, total) {
      title.textContent = guestbookTitle(ownerNickname);
      count.textContent = appleCountText(total);
    },
  };
}
