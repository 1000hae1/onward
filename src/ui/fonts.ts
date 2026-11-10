/**
 * 방명록과 병원 간판에서 쓰는 글꼴이에요(Gowun Batang 700, Gowun Dodum). 처음 필요할 때 한 번만 불러요.
 */
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&family=Gowun+Dodum&display=swap";
/** 이 시간 안에 글꼴이 오지 않으면 기다리지 않아요. */
const FONT_TIMEOUT_MS = 10_000;

let sheet: Promise<void> | null = null;

/** 글꼴 목록(CSS)을 한 번만 붙이고, 다 받아질 때까지 기다려요. */
function loadSheet(): Promise<void> {
  if (sheet) return sheet;
  sheet = new Promise<void>((resolve, reject) => {
    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = "https://fonts.gstatic.com";
    preconnect.crossOrigin = "anonymous";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_URL;
    link.referrerPolicy = "no-referrer";
    link.dataset.gowunFonts = "";
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error("font sheet")), { once: true });
    document.head.append(preconnect, link);
  });
  return sheet;
}

/** 방명록을 열 때 불러요. 기다리지 않아요. CSS가 글꼴이 오는 대로 바꿔 그려요. */
export function loadGuestbookFonts(): void {
  loadSheet().catch(() => {});
}

/**
 * 캔버스에 그릴 글자들이 Gowun 글꼴로 다 준비될 때까지 기다려요. 한글 글꼴은 글자 묶음별로 나뉘어 있어서
 * 실제로 그릴 글자를 함께 넘겨요. 준비되면 true, 실패하거나 너무 오래 걸리면 false예요.
 */
export async function loadGowunFonts(requests: readonly { font: string; text: string }[]): Promise<boolean> {
  if (typeof document === "undefined" || !("fonts" in document)) return false;
  const ready = (async () => {
    await loadSheet();
    await Promise.all(requests.map(({ font, text }) => document.fonts.load(font, text)));
    return requests.every(({ font, text }) => document.fonts.check(font, text));
  })();
  const timeout = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), FONT_TIMEOUT_MS));
  try {
    return await Promise.race([ready, timeout]);
  } catch {
    return false;
  }
}
