/**
 * 구글 애널리틱스(GA4)로 익명 이용 통계를 보내요. 모든 이벤트는 track() 하나로만 보내요.
 *
 * - 닉네임, guestId, publicId, 방명록 글, IP는 절대 넣지 않아요. 파라미터는 아래에 정해 둔 단어와 숫자만 받아요.
 * - 같은 이벤트(이름과 파라미터가 같으면)는 1초에 1번까지만 보내요.
 * - localhost에서는 보내지 않아요. gtag.js가 막혀도(광고 차단, 인앱 브라우저) 앱은 그대로 움직여요.
 * - gtag.js는 production 빌드에서만 index.html에 들어가요(vite.config.ts).
 */

export type ActionKind = "bless" | "bow" | "gift" | "lamp" | "sleep" | "cat_play" | "bench_sit";
/** 입장 뒤 첫 행동으로 세는 것들이에요. */
export type FirstActionKind = "bless" | "bow" | "gift" | "lamp";

/** 이벤트 이름과 그 이벤트가 받을 수 있는 파라미터예요. 여기에 없는 이름과 값은 보낼 수 없어요. */
export interface AnalyticsEvents {
  loading_start: Record<string, never>;
  loading_done: { load_ms: number };
  intro_view: { from: "first" | "settings" };
  intro_enter: { from: "first" | "settings" };
  entry_view: Record<string, never>;
  animal_select: { animal: "rabbit" | "bear" | "penguin" | "otter" | "deer" };
  nickname_edit: { edited: boolean };
  enter_ward: { returning: boolean };
  bed_confirm_open: { mode: "claim" | "move" };
  bed_claim: Record<string, never>;
  bed_confirm_cancel: { mode: "claim" | "move" };
  first_action: { kind: FirstActionKind };
  action: { kind: ActionKind };
  guestbook_open: { role: "owner" | "visitor" };
  guestbook_loading_slow: Record<string, never>;
  guestbook_fail: Record<string, never>;
  visit_link_create: Record<string, never>;
  guestbook_link_share: { method: "share" | "copy" };
  discharge: Record<string, never>;
  ws_disconnect: Record<string, never>;
  ws_reconnect: Record<string, never>;
  connect_fail: Record<string, never>;
}

export type AnalyticsName = keyof AnalyticsEvents;

/** 문자열 파라미터가 가질 수 있는 값이에요. 실행할 때도 한 번 더 걸러요. */
const ALLOWED_WORDS: Readonly<Record<string, readonly string[]>> = {
  animal: ["rabbit", "bear", "penguin", "otter", "deer"],
  mode: ["claim", "move"],
  kind: ["bless", "bow", "gift", "lamp", "sleep", "cat_play", "bench_sit"],
  role: ["owner", "visitor"],
  method: ["share", "copy"],
  from: ["first", "settings"],
};
const NUMBER_KEYS = new Set(["load_ms"]);
const BOOLEAN_KEYS = new Set(["edited", "returning"]);
const FIRST_ACTION_KINDS: ReadonlySet<string> = new Set<FirstActionKind>(["bless", "bow", "gift", "lamp"]);

export const THROTTLE_MS = 1000;

export type CleanParams = Record<string, string | number | boolean>;

/** 정해 둔 키와 값만 남겨요. 모르는 키, 목록에 없는 단어, 숫자가 아닌 값은 버려요. */
export function cleanParams(params: Record<string, unknown>): CleanParams {
  const out: CleanParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value === "boolean") out[key] = value;
    } else if (NUMBER_KEYS.has(key)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
    } else if (key in ALLOWED_WORDS) {
      if (typeof value === "string" && ALLOWED_WORDS[key].includes(value)) out[key] = value;
    }
  }
  return out;
}

/** 이 이벤트를 지금 보내도 되는지 정해요. 같은 키는 1초에 1번까지만이에요. 보내면 last에 시각을 적어요. */
export function shouldSend(last: Map<string, number>, key: string, nowMs: number): boolean {
  const before = last.get(key);
  if (before !== undefined && nowMs - before < THROTTLE_MS) return false;
  last.set(key, nowMs);
  return true;
}

export function throttleKey(name: string, params: CleanParams): string {
  return `${name}|${JSON.stringify(params)}`;
}

/** 통계를 보내지 않는 주소예요. 로컬 개발과 미리보기예요. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local");
}

const lastSent = new Map<string, number>();
let firstActionSent = false;

type Gtag = (command: "event", name: string, params: CleanParams) => void;

export function track<N extends AnalyticsName>(name: N, ...rest: AnalyticsEvents[N] extends Record<string, never> ? [] : [AnalyticsEvents[N]]): void {
  try {
    if (typeof window === "undefined" || isLocalHost(window.location.hostname)) return;
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag !== "function") return;
    const params = cleanParams((rest[0] ?? {}) as Record<string, unknown>);
    if (!shouldSend(lastSent, throttleKey(name, params), Date.now())) return;
    gtag("event", name, params);
  } catch {
    // 통계를 보내지 못해도 병동은 그대로예요.
  }
}

/** 행동을 보내요. 입장 뒤 처음 하는 평안 빌기·목례·선물·불빛이면 first_action도 한 번만 보내요. */
export function trackAction(kind: ActionKind): void {
  if (!firstActionSent && FIRST_ACTION_KINDS.has(kind)) {
    firstActionSent = true;
    track("first_action", { kind: kind as FirstActionKind });
  }
  track("action", { kind });
}
