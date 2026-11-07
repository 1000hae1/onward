import { healthResponseSchema, PROTOCOL_VERSION, visitPreviewSchema } from "../shared/protocol.ts";
import type { VisitPreview } from "../shared/protocol.ts";

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

/** 1부터 max까지의 정수만 받아요. */
function readNumber(value: string | null, max: number): number | null {
  if (value === null || !/^\d{1,3}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= max ? number : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      const room = env.WARD_ROOM.getByName("health");
      const body = healthResponseSchema.parse(await room.health());
      return Response.json(body);
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
      return env.WARD_ROOM.getByName(`ward-${ward}-${instance}`).fetch(request);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
