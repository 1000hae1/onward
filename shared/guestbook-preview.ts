/**
 * 방명록 링크(/guestbook/{토큰})를 카카오톡 같은 곳에 보낼 때의 미리보기 문구예요.
 * 닉네임 말고는 아무것도 넣지 않아요(병동 번호·침대·사과 개수 없음).
 * 값은 날 글자 그대로예요. HTML 이스케이프는 Worker가 HTMLRewriter의 setAttribute로 해요.
 */
import { checkNickname } from "./nickname.ts";
import { readGuestbookPath } from "./guestbook-path.ts";

export const GUESTBOOK_PREVIEW_ORIGIN = "https://onward.wunee.workers.dev";
export const GUESTBOOK_PREVIEW_IMAGE = `${GUESTBOOK_PREVIEW_ORIGIN}/og-guestbook.png`;
export const GUESTBOOK_PREVIEW_FALLBACK_TITLE = "사과나무 방명록";
export const GUESTBOOK_PREVIEW_DESCRIPTION = "사과 한 알에 마음을 담아 주세요";

/** 바꿀 meta예요. 키는 meta의 property(og:*) 또는 name(description, twitter:*)이에요. */
export type GuestbookPreviewMeta = Readonly<Record<string, string>>;

/** 주인 닉네임으로 쓸 수 있는 값인지 한 번 더 살펴요. 이상하면 null이라 기본 제목이 나가요. */
function usableNickname(nickname: string | null): string | null {
  if (nickname === null) return null;
  const check = checkNickname(nickname);
  return check.ok && check.value === nickname ? nickname : null;
}

export function guestbookPreviewTitle(nickname: string | null): string {
  const name = usableNickname(nickname);
  return name ? `${name}님의 사과나무` : GUESTBOOK_PREVIEW_FALLBACK_TITLE;
}

/**
 * 미리보기 meta 값이에요. pageUrl은 지금 요청 주소이고, 쿼리와 # 뒤는 버려요.
 * nickname이 null이면(토큰 없음, 꺼진 링크, 가려진 주인) 닉네임 없이 기본 제목이에요.
 */
export function guestbookPreviewMeta(nickname: string | null, pageUrl: string): GuestbookPreviewMeta {
  const url = new URL(pageUrl);
  const title = guestbookPreviewTitle(nickname);
  return {
    description: GUESTBOOK_PREVIEW_DESCRIPTION,
    "og:type": "website",
    "og:url": `${url.origin}${url.pathname}`,
    "og:title": title,
    "og:description": GUESTBOOK_PREVIEW_DESCRIPTION,
    "og:image": GUESTBOOK_PREVIEW_IMAGE,
    "og:image:width": "1200",
    "og:image:height": "630",
    "twitter:card": "summary_large_image",
  };
}

/** Worker가 미리보기를 만들어야 하는 주소인지예요. /guestbook/{토큰}이면 토큰을, /guestbook이면 빈 글자를, 아니면 null이에요. */
export function guestbookPreviewToken(pathname: string): string | null {
  const token = readGuestbookPath(pathname);
  if (token) return token;
  return pathname.replace(/\/$/, "") === "/guestbook" || pathname.startsWith("/guestbook/") ? "" : null;
}
