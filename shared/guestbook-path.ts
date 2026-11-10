/** 방명록 링크 주소(/guestbook/{토큰})를 읽어요. 화면이 가장 먼저 부르므로 다른 모듈을 불러오지 않아요. */
export function readGuestbookPath(pathname: string): string | null {
  const match = /^\/guestbook\/([A-Za-z0-9_-]{22})\/?$/.exec(pathname);
  return match ? match[1] : null;
}

/** 토큰을 탭에 옮긴 뒤 주소창에 남기는 주소예요. 토큰은 들어 있지 않아요. */
export const GUESTBOOK_BARE_PATH = "/guestbook";
