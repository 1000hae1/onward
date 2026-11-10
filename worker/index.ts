import {
  applePostResultSchema,
  applePostSchema,
  guestbookViewSchema,
  healthResponseSchema,
  PROTOCOL_VERSION,
  statsResponseSchema,
} from "../shared/protocol.ts";
import type { ApplePostResult, GuestbookView, StatsResponse } from "../shared/protocol.ts";
import { WRITER_KEY_PATTERN } from "../shared/guestbook-rules.ts";

import { statsTimestamp } from "../shared/presence-rules.ts";
import { handleAdmin } from "./admin.ts";
import { guestbookPage } from "./guestbook-page.ts";
import { logError } from "./log.ts";
import type { LogRoute } from "./log.ts";
import { hashIp, requireSecret } from "./security.ts";
import { IP_HASH_HEADER } from "./ward-room.ts";

export { Directory } from "./directory";
export { WardRoom } from "./ward-room";

const MAX_WARD = 99;
const MAX_INSTANCE = 20;
/** 방명록 링크의 답은 저장하거나 검색에 걸리지 않게 해요. */
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

/** 사과 달기 본문은 이보다 길면 읽지 않아요. */
const MAX_APPLE_BODY = 2048;
/** 이 브라우저가 단 사과를 알아보는 열쇠를 담는 헤더예요. */
const WRITER_HEADER = "X-Apple-Writer";
const CLOSED_VIEW: GuestbookView = { v: PROTOCOL_VERSION, open: false };

/** 같은 사이트의 화면에서 온 요청인지예요. 다른 사이트가 사과를 대신 달지 못하게 해요. */
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return origin === null || origin === url.origin;
}

async function readAppleBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_APPLE_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_APPLE_BODY) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 방명록 링크로 온 사람의 API예요. 토큰이 있어야 하고, 꺼진 링크는 닫힌 것으로 답해요.
 * GET /api/guestbook/{토큰}: 주인 닉네임, 사과 개수, 이 브라우저가 단 사과만
 * POST /api/guestbook/{토큰}/apples: 사과 달기
 * 병실 안에서는 이 길로 다른 사람의 나무를 열 수 없어요. 토큰을 아는 사람(주인이 링크를 보낸 사람)만 써요.
 */
async function guestbookResponse(request: Request, url: URL, env: Env): Promise<Response> {
  const match = /^\/api\/guestbook\/([A-Za-z0-9_-]{22})(\/apples)?$/.exec(url.pathname);
  if (!match) return Response.json(CLOSED_VIEW, { status: 404, headers: PRIVATE_HEADERS });
  const [, token, apples] = match;
  const directory = env.DIRECTORY.getByName("directory");

  if (!apples && request.method === "GET") {
    const header = request.headers.get(WRITER_HEADER);
    const writer = header && WRITER_KEY_PATTERN.test(header) ? header : null;
    const result = await directory.viewGuestbook(token, writer);
    const parsed = guestbookViewSchema.safeParse({ v: PROTOCOL_VERSION, ...result });
    return Response.json(parsed.success ? parsed.data : CLOSED_VIEW, { headers: PRIVATE_HEADERS });
  }

  if (apples && request.method === "POST") {
    if (!sameOrigin(request, url)) return Response.json({ error: "forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
    const body = applePostSchema.safeParse(await readAppleBody(request));
    if (!body.success) return Response.json({ error: "bad_request" }, { status: 400, headers: PRIVATE_HEADERS });
    const { writer, name, phrase, note } = body.data;
    const result = await directory.addApple(token, writer, { name, phrase, note: note ?? null }, Date.now());
    const parsed = applePostResultSchema.safeParse({ v: PROTOCOL_VERSION, ...result });
    const reply: ApplePostResult = parsed.success ? parsed.data : { v: PROTOCOL_VERSION, result: "closed" };
    const status = reply.result === "saved" ? 201 : reply.result === "limit" ? 429 : reply.result === "invalid" ? 422 : 403;
    return Response.json(reply, { status, headers: PRIVATE_HEADERS });
  }

  return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: apples ? "POST" : "GET" } });
}

/** 1부터 max까지의 정수만 받아요. */
function readNumber(value: string | null, max: number): number | null {
  if (value === null || !/^\d{1,3}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= max ? number : null;
}

/** 로그에 남길 길 이름이에요. URL 자체는 남기지 않아요. */
function routeOf(pathname: string): LogRoute {
  if (pathname === "/api/stats") return "api/stats";
  if (pathname === "/api/health") return "api/health";
  if (pathname.startsWith("/api/guestbook/")) return "api/guestbook";
  if (pathname === "/guestbook" || pathname.startsWith("/guestbook/")) return "guestbook";
  if (pathname === "/ws") return "ws";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return "not-found";
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

  if (url.pathname.startsWith("/api/guestbook/")) return guestbookResponse(request, url, env);

  // 방명록 링크 화면이에요. 미리보기 meta만 바꾼 index.html이고, 못 만들면 정적 index.html을 그대로 줘요.
  if (url.pathname === "/guestbook" || url.pathname.startsWith("/guestbook/")) {
    return (await guestbookPage(request, url, env, ctx)) ?? env.ASSETS.fetch(request);
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
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      // 무엇이 잘못됐는지는 길 이름과 오류 종류만 남겨요. 화면에는 자세히 알리지 않아요.
      logError(routeOf(new URL(request.url).pathname), error, 500);
      return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  },
} satisfies ExportedHandler<Env>;
