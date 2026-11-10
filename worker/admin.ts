import { adminBlockSchema, adminGuestActionSchema, adminHideAppleSchema, PROTOCOL_VERSION } from "../shared/protocol.ts";
import { checkAdminKey } from "./security.ts";
import { readMetricsDays } from "../shared/metrics-rules.ts";

/**
 * 운영자 API예요. 화면은 없고 Authorization 헤더의 ADMIN_KEY로만 들어와요.
 * 요청 본문, 키, IP는 로그에 남기지 않아요. 실패한 이유도 자세히 알려 주지 않아요.
 */

const MAX_BODY_BYTES = 2048;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ v: PROTOCOL_VERSION, ...body }), { status, headers: HEADERS });
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function handleAdmin(request: Request, env: Env, url: URL, ipHash: string): Promise<Response> {
  const directory = env.DIRECTORY.getByName("directory");
  const now = Date.now();
  // 키를 계속 틀리는 곳은 한 시간 동안 받지 않아요. 맞는 키를 보내도 마찬가지예요.
  if (await directory.adminLocked(ipHash, now)) return reply({ error: "too_many" }, 429);
  if (!(await checkAdminKey(request.headers.get("Authorization"), env.ADMIN_KEY))) {
    await directory.adminFailed(ipHash, now);
    return reply({ error: "unauthorized" }, 401);
  }

  if (url.pathname === "/admin/reports" && request.method === "GET") {
    const raw = url.searchParams.get("limit");
    const limit = raw && /^\d{1,3}$/.test(raw) ? Math.min(MAX_LIMIT, Math.max(1, Number(raw))) : DEFAULT_LIMIT;
    return reply({ reports: await directory.listReports(limit) });
  }

  // 날짜별 숫자 지표예요. 사람을 알 수 있는 값은 없어요. ?days=1~400(기본 30)
  if (url.pathname === "/admin/metrics" && request.method === "GET") {
    const days = readMetricsDays(url.searchParams.get("days"));
    return reply({ days, metrics: await directory.metrics(days) });
  }

  if (request.method !== "POST") return reply({ error: "not_found" }, 404);
  const body = await readBody(request);

  if (url.pathname === "/admin/block") {
    const parsed = adminBlockSchema.safeParse(body);
    if (!parsed.success) return reply({ error: "bad_request" }, 400);
    const { guestHash, ipHash: target, reason } = parsed.data;
    return reply({ ...(await directory.adminBlock({ guestHash, ipHash: target }, reason, now)) });
  }

  // 사과 하나를 지워요. audit_log에 사유와 사과 번호만 남겨요.
  if (url.pathname === "/admin/hide-apple") {
    const parsed = adminHideAppleSchema.safeParse(body);
    if (!parsed.success) return reply({ error: "bad_request" }, 400);
    const result = await directory.adminHideApple(parsed.data.appleId, parsed.data.reason, now);
    return reply({ ...result }, result.ok ? 200 : 404);
  }

  const guestActions: Record<string, "reset" | "revoke" | "clear"> = {
    "/admin/reset-nickname": "reset",
    "/admin/revoke-guestbook-link": "revoke",
    "/admin/clear-flag": "clear",
  };
  const action = guestActions[url.pathname];
  if (!action) return reply({ error: "not_found" }, 404);
  const parsed = adminGuestActionSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "bad_request" }, 400);
  const { guestHash, reason } = parsed.data;
  const result =
    action === "reset"
      ? await directory.adminResetNickname(guestHash, reason, now)
      : action === "revoke"
        ? await directory.adminRevokeGuestbookLink(guestHash, reason, now)
        : await directory.adminClearFlag(guestHash, reason, now);
  return reply({ ...result }, result.ok ? 200 : 404);
}
