import { DurableObject } from "cloudflare:workers";
import { PROTOCOL_VERSION, type HealthResponse } from "../shared/protocol";

/** 병실 하나를 맡는 Durable Object. 저장소는 SQLite를 써요. */
export class WardRoom extends DurableObject<Env> {
  health(): HealthResponse {
    const row = this.ctx.storage.sql.exec<{ one: number }>("SELECT 1 AS one").one();
    const sqlite = row.one === 1;
    return { v: PROTOCOL_VERSION, ok: sqlite, sqlite };
  }
}
