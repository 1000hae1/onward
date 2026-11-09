import { healthResponseSchema, PROTOCOL_VERSION, statsResponseSchema, visitPreviewSchema } from "../shared/protocol.ts";
import type { StatsResponse, VisitPreview } from "../shared/protocol.ts";

import { statsTimestamp } from "../shared/presence-rules.ts";
import { handleAdmin } from "./admin.ts";
import { hashIp, requireSecret } from "./security.ts";
import { IP_HASH_HEADER } from "./ward-room.ts";

export { Directory } from "./directory";
export { WardRoom } from "./ward-room";

const MAX_WARD = 99;
const MAX_INSTANCE = 20;
/** 문병 링크의 답은 저장하거나 검색에 걸리지 않게 해요. */
const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

/** 공개 접속자 수를 이만큼 들고 있어요. 그동안은 directory를 깨우지 않아요. */
const STATS_CACHE_SECONDS = 60;
/** 다른 사이트에서 읽을 수 있게 GET에만 열어 둬요. */
const STATS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": `public, max-age=${STATS_CACHE_SECONDS}`,
  "X-Content-Type-Options": "nosniff",
};
/**
 * Cache API가 동작하지 않는 곳(*.workers.dev)을 위한 보조예요. 이 Worker 인스턴스 안에서만 60초 들고 있어요.
 * 숫자만 있어서 여러 사람이 함께 봐도 괜찮아요.
 */
let statsMemo: { body: StatsResponse; until: number } | null = null;

async function statsResponse(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const now = Date.now();
  if (statsMemo && statsMemo.until > now) return Response.json(statsMemo.body, { headers: STATS_HEADERS });
  const cache = caches.default;
  const key = new Request(`${url.origin}/api/stats`, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) return cached;
  const counted = await env.DIRECTORY.getByName("directory").presenceStats(now);
  // 정해 둔 모양(숫자와 시각)만 내보내요. 다른 값이 섞여 있으면 0으로 답해요.
  const parsed = statsResponseSchema.safeParse({ v: PROTOCOL_VERSION, ...counted });
  const body: StatsResponse = parsed.success
    ? parsed.data
    : { v: PROTOCOL_VERSION, online: 0, wards: 0, updatedAt: statsTimestamp(now) };
  statsMemo = { body, until: now + STATS_CACHE_SECONDS * 1000 };
  const response = Response.json(body, { headers: STATS_HEADERS });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

/** 1부터 max까지의 정수만 받아요. */
function readNumber(value: string | null, max: number): number | null {
  if (value === null || !/^\d{1,3}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= max ? number : null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 원본 IP는 여기서만 읽고 바로 소금을 섞은 해시로 바꿔요. 원본은 어디에도 넘기거나 저장하지 않아요.
    const ipHash = async (): Promise<string> =>
      hashIp(requireSecret(env.IP_SALT, "IP_SALT"), request.headers.get("CF-Connecting-IP") ?? "unknown");

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, url, await ipHash());
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      const room = env.WARD_ROOM.getByName("health");
      const body = healthResponseSchema.parse(await room.health());
      return Response.json(body);
    }

    // 공개 접속자 수예요. 숫자만 있고, 60초 동안 캐시해서 자주 물어도 Durable Object를 매번 깨우지 않아요.
    if (url.pathname === "/api/stats") {
      if (request.method === "GET" || request.method === "HEAD") return statsResponse(url, env, ctx);
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
      return new Response(null, { status: 405, headers: { Allow: "GET, OPTIONS" } });
    }

    // 문병 링크를 확인해요. 토큰을 가진 사람에게만 주인 닉네임과 들어갈 병동을 알려 줘요.
    const visit = /^\/api\/visit\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (visit && request.method === "GET") {
      const result = await env.DIRECTORY.getByName("directory").previewVisit(visit[1]);
      const parsed = visitPreviewSchema.safeParse({ v: PROTOCOL_VERSION, ...result });
      const body: VisitPreview = parsed.success ? parsed.data : { v: PROTOCOL_VERSION, open: false };
      return Response.json(body, { headers: PRIVATE_HEADERS });
    }
    if (url.pathname.startsWith("/api/visit/")) {
      return Response.json({ v: PROTOCOL_VERSION, open: false } satisfies VisitPreview, { headers: PRIVATE_HEADERS });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("websocket only", { status: 426 });
      }
      const ward = readNumber(url.searchParams.get("ward"), MAX_WARD);
      const instance = readNumber(url.searchParams.get("instance"), MAX_INSTANCE);
      if (ward === null || instance === null) {
        return Response.json({ error: "bad_ward" }, { status: 400 });
      }
      // 병동 번호와 인스턴스마다 Durable Object가 하나씩이에요.
      // IP 해시는 내부 헤더로 넘겨요. 화면이 같은 이름으로 보내도 여기서 덮어써요.
      const forwarded = new Request(request);
      forwarded.headers.set(IP_HASH_HEADER, await ipHash());
      return env.WARD_ROOM.getByName(`ward-${ward}-${instance}`).fetch(forwarded);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
