/**
 * 메타모아에 지금 접속자 수를 알리는 요청을 만들어요. 화면이나 네트워크와 상관없는 순수 함수예요.
 * 본문에는 숫자 하나(count)만 담아요. 닉네임·ID·병실 번호·IP 같은 이용자 정보는 절대 넣지 않아요.
 */
import { z } from "zod";

export const LIVE_REPORT_URL = "https://metamoa.com/api/live/onward-wunee-workers-dev-mwar5s0y";
/** 메타모아가 이만큼 답이 없으면 그만둬요. 다음 10분에 다시 보내요. */
export const LIVE_REPORT_TIMEOUT_MS = 10_000;

/** 보내는 본문의 모양이에요. count 말고 다른 값은 들어갈 수 없어요. */
export const liveReportBodySchema = z.strictObject({ count: z.number().int().min(0) });

export type LiveReport =
  | { kind: "skip"; reason: "no-key" }
  | { kind: "send"; url: string; init: { method: "POST"; headers: Record<string, string>; body: string } };

/** 접속자 수를 0 이상의 정수로 다듬어요. 숫자가 아니면 0이에요. */
export function liveCount(online: unknown): number {
  return typeof online === "number" && Number.isFinite(online) ? Math.max(0, Math.floor(online)) : 0;
}

/** 키가 없으면 건너뛰고, 있으면 보낼 요청을 돌려줘요. */
export function liveReport(online: unknown, key: string | undefined): LiveReport {
  const trimmed = key?.trim() ?? "";
  if (!trimmed) return { kind: "skip", reason: "no-key" };
  const body = liveReportBodySchema.parse({ count: liveCount(online) });
  return {
    kind: "send",
    url: LIVE_REPORT_URL,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${trimmed}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}
