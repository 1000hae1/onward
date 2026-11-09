/** 문병 링크 주소(/visit/{토큰})를 읽어요. 화면이 가장 먼저 부르므로 다른 모듈을 불러오지 않아요. */
export function readVisitPath(pathname: string): string | null {
  const match = /^\/visit\/([A-Za-z0-9_-]{22})\/?$/.exec(pathname);
  return match ? match[1] : null;
}
