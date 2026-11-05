import { healthResponseSchema } from "../shared/protocol";

export { WardRoom } from "./ward-room";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health" && request.method === "GET") {
      const room = env.WARD_ROOM.getByName("health");
      const body = healthResponseSchema.parse(await room.health());
      return Response.json(body);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
