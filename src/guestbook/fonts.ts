/** 방명록에서만 쓰는 글꼴이에요(Gowun Batang 700, Gowun Dodum). 방명록을 열 때 한 번만 불러요. */
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&family=Gowun+Dodum&display=swap";

export function loadGuestbookFonts(): void {
  if (document.querySelector("link[data-guestbook-fonts]")) return;
  const preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = "https://fonts.gstatic.com";
  preconnect.crossOrigin = "anonymous";
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = FONT_URL;
  sheet.referrerPolicy = "no-referrer";
  sheet.dataset.guestbookFonts = "";
  document.head.append(preconnect, sheet);
}
