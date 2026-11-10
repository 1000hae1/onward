/**
 * 서버 로그는 이 파일로만 남겨요. worker/ 안에서 console을 직접 부르지 않아요(tests/logging.test.ts가 확인해요).
 *
 * 남기는 것: 어느 길(route), 상태 코드, 걸린 시간, 오류 종류와 짧은 문구
 * 남기지 않는 것: URL과 쿼리, 요청 헤더와 본문, IP, guestId·토큰·해시, 닉네임
 * wrangler.jsonc에서 자동 요청 로그(invocation_logs)를 꺼서 Cloudflare도 URL을 남기지 않아요.
 */

export type LogRoute =
  | "api/stats"
  | "api/health"
  | "api/visit"
  | "ws"
  | "admin"
  | "not-found"
  | "ward:message"
  | "ward:hello"
  | "ward:alarm"
  | "directory:alarm";

export interface LogFields {
  route: LogRoute;
  status?: number;
  ms?: number;
  /** Error의 이름이에요(TypeError 등). */
  error?: string;
  /** 오류 문구예요. maskSecrets를 거쳐서 남겨요. */
  detail?: string;
}

/** 토큰, 해시, 숫자가 길게 이어진 부분과 IP처럼 보이는 부분을 가려요. 문구는 160자까지만 남겨요. */
export function maskSecrets(text: string): string {
  return text
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[ip]")
    .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, (match) => (match.length >= 6 ? "[ip]" : match))
    .replace(/[A-Za-z0-9_+/=-]{16,}/g, "[masked]")
    .slice(0, 160);
}

export function logEvent(level: "info" | "error", fields: LogFields): void {
  const line = JSON.stringify({ level, ...fields, ...(fields.detail ? { detail: maskSecrets(fields.detail) } : {}) });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** 잡은 오류를 남겨요. 오류 이름과 가린 문구만 남겨요. */
export function logError(route: LogRoute, error: unknown, status?: number): void {
  const name = error instanceof Error ? error.name : typeof error;
  const detail = error instanceof Error ? error.message : "";
  logEvent("error", { route, error: name, detail, ...(status ? { status } : {}) });
}
