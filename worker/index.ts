import { healthResponseSchema } from "../shared/protocol.ts";

export { WardRoom } from "./ward-room";

const MAX_WARD = 99;
const MAX_INSTANCE = 20;

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
