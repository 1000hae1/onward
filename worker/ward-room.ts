import { DurableObject } from "cloudflare:workers";
import {
  clientMessageSchema,
  parseMessage,
  PING,
  PONG,
  PROTOCOL_VERSION,
  WARD_CAPACITY,
} from "../shared/protocol.ts";
import type { ClientMessage, HealthResponse, ServerMessage, WardEvent } from "../shared/protocol.ts";
import { ROOMS } from "../shared/ward-layout.ts";
import {
  actionReady,
  admit,
  claimBed,
  clampToWalkable,
  giftAllowedNow,
  GIFTS_PER_DAY,
  giftSlot,
  koreanDay,
  lampRoom,
  resolveTarget,
  seasonalGiftsAllowed,
  toPublic,
  updateProfile,
} from "../shared/ward-rules.ts";
import type { GuestRecord } from "../shared/ward-rules.ts";
import { bedApproach, BEDS } from "../shared/ward-layout.ts";

/** 연결마다 붙여 두는 정보예요. 하이버네이션 뒤에는 이것만 남아요. */
type Attachment = { joined: false } | { joined: true; record: GuestRecord };

const REPLACED_CODE = 4000;
const FULL_CODE = 4001;

/**
 * 병동 인스턴스 하나를 맡는 Durable Object예요. 건물 하나, 병실 여섯, 침대 서른여섯이에요.
 * 주기적으로 도는 일은 없고, 메시지가 올 때만 깨어나 변화를 알려요.
 */
export class WardRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 연결 유지용 글자에는 객체를 깨우지 않고 바로 답해요.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS gifts (
      stand INTEGER NOT NULL, slot INTEGER NOT NULL, item INTEGER NOT NULL,
      ord INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (stand, slot))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS lamps (
      room INTEGER PRIMARY KEY, count INTEGER NOT NULL, day TEXT NOT NULL)`);
    // guestId는 그대로 두지 않고 해시로만 저장해요.
    sql.exec(`CREATE TABLE IF NOT EXISTS gift_counts (
      guest TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (guest, day))`);
  }

  health(): HealthResponse {
    const row = this.ctx.storage.sql.exec<{ one: number }>("SELECT 1 AS one").one();
    const sqlite = row.one === 1;
    return { v: PROTOCOL_VERSION, ok: sqlite, sqlite };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("websocket only", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ joined: false } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const message = parseMessage(clientMessageSchema, raw);
    // 형식이 맞지 않으면 아무 말 없이 무시해요.
    if (!message) return;
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    if (message.type === "hello") {
      await this.hello(ws, attachment, message);
      return;
    }
    if (!attachment.joined) return;
    await this.act(ws, attachment.record, message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  /** 지금 들어와 있는 사람들이에요. 연결에 붙은 정보로 매번 다시 만들어요. */
  private joined(except?: WebSocket): { ws: WebSocket; record: GuestRecord }[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      if (ws === except) return [];
      const attachment = ws.deserializeAttachment() as Attachment | null;
      return attachment?.joined ? [{ ws, record: attachment.record }] : [];
    });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // 이미 닫힌 연결이면 보내지 않아요.
    }
  }

  private broadcast(event: WardEvent, except?: WebSocket): void {
    const text = JSON.stringify({ v: PROTOCOL_VERSION, type: "event", event } satisfies ServerMessage);
    for (const { ws } of this.joined(except)) {
      try {
        ws.send(text);
      } catch {
        // 닫히는 중인 연결은 건너뛰어요.
      }
    }
  }

  private save(ws: WebSocket, record: GuestRecord): void {
    ws.serializeAttachment({ joined: true, record } satisfies Attachment);
  }

  private leave(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.serializeAttachment({ joined: false } satisfies Attachment);
    } catch {
      // 닫힌 연결에는 쓸 수 없어도 괜찮아요. 아래에서 다른 사람에게 알리면 돼요.
    }
    if (attachment?.joined) this.broadcast({ kind: "leave", id: attachment.record.id }, ws);
    try {
      ws.close(1000, "bye");
    } catch {
      // 이미 닫혔으면 그대로예요.
    }
  }

  private async hello(
    ws: WebSocket,
    attachment: Attachment,
    hello: Extract<ClientMessage, { type: "hello" }>,
  ): Promise<void> {
    const others = this.joined(ws);
    if (attachment.joined) {
      // 이미 들어와 있으면 모습만 바꿔요.
      const result = updateProfile(attachment.record, hello);
      if (result.kind === "rejected") {
        this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-rejected", problem: result.problem });
        return;
      }
      this.save(ws, result.record);
      this.broadcast({ kind: "update", guest: toPublic(result.record) }, ws);
      return;
    }

    const admission = admit(
      others.map((other) => other.record),
      hello,
      WARD_CAPACITY,
      crypto.randomUUID().replace(/-/g, "").slice(0, 8),
    );
    if (admission.kind === "rejected") {
      this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-rejected", problem: admission.problem });
      return;
    }
    if (admission.kind === "full") {
      this.send(ws, { v: PROTOCOL_VERSION, type: "room-full", capacity: WARD_CAPACITY });
      ws.close(FULL_CODE, "full");
      return;
    }
    if (admission.replaces) {
      // 같은 사람이 새로 들어오면 예전 연결을 닫아요.
      const old = others.find((other) => other.record.id === admission.replaces);
      if (old) {
        old.ws.serializeAttachment({ joined: false } satisfies Attachment);
        this.broadcast({ kind: "leave", id: old.record.id }, old.ws);
        try {
          old.ws.close(REPLACED_CODE, "replaced");
        } catch {
          // 이미 닫혔으면 그대로예요.
        }
      }
    }

    this.save(ws, admission.record);
    const now = new Date();
    this.tidy(now);
    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      you: admission.record.id,
      capacity: WARD_CAPACITY,
      guests: this.joined().map(({ record }) => toPublic(record)),
      gifts: this.ctx.storage.sql
        .exec<{ stand: number; slot: number; item: number }>("SELECT stand, slot, item FROM gifts")
        .toArray(),
      lamps: this.lampCounts(),
      seasonalGifts: seasonalGiftsAllowed(now),
    });
    this.broadcast({ kind: "join", guest: toPublic(admission.record) }, ws);
  }

  private async act(ws: WebSocket, record: GuestRecord, message: ClientMessage): Promise<void> {
    const nowMs = Date.now();
    const deny = (action: "bless" | "bow" | "gift" | "lamp", reason: Parameters<typeof this.denied>[2]) =>
      this.denied(ws, action, reason);

    switch (message.type) {
      case "walk-to": {
        const spot = clampToWalkable(message.x, message.z);
        if (spot.x !== message.x || spot.z !== message.z) {
          this.send(ws, { v: PROTOCOL_VERSION, type: "position-corrected", x: spot.x, z: spot.z });
        }
        // 걸어가면 누워 있던 침대는 비워요.
        const hadBed = record.bed !== null;
        this.save(ws, { ...record, x: spot.x, z: spot.z, bed: null });
        if (hadBed) this.broadcast({ kind: "get-up", id: record.id }, ws);
        this.broadcast({ kind: "walk", id: record.id, x: spot.x, z: spot.z }, ws);
        return;
      }
      case "lie-down": {
        const others = this.joined().map((entry) => entry.record);
        const result = claimBed(others, record, message.bedId);
        if (!result.granted) {
          this.send(ws, { v: PROTOCOL_VERSION, type: "bed-unavailable", bedId: message.bedId });
          return;
        }
        // 눕는 사람은 침대 곁 자리에 있는 것으로 봐요.
        const spot = bedApproach(BEDS[message.bedId]);
        this.save(ws, { ...result.record, x: spot.x, z: spot.z });
        this.send(ws, { v: PROTOCOL_VERSION, type: "bed-granted", bedId: message.bedId });
        this.broadcast({ kind: "lie", id: record.id, bedId: message.bedId }, ws);
        return;
      }
      case "get-up": {
        if (record.bed === null) return;
        this.save(ws, { ...record, bed: null });
        this.broadcast({ kind: "get-up", id: record.id }, ws);
        return;
      }
      case "bow": {
        if (!actionReady(record, "bow", nowMs)) return deny("bow", "too-fast");
        this.save(ws, { ...record, lastAction: { ...record.lastAction, bow: nowMs } });
        this.broadcast({ kind: "bow", id: record.id, phrase: message.phrase }, ws);
        return;
      }
      case "bless": {
        if (!actionReady(record, "bless", nowMs)) return deny("bless", "too-fast");
        const target = resolveTarget(this.joined().map((entry) => entry.record), message);
        if (!target) return deny("bless", "no-target");
        this.save(ws, { ...record, lastAction: { ...record.lastAction, bless: nowMs } });
        this.broadcast({ kind: "bless", id: record.id, ...target }, ws);
        return;
      }
      case "gift": {
        const now = new Date(nowMs);
        if (!actionReady(record, "gift", nowMs)) return deny("gift", "too-fast");
        if (!giftAllowedNow(message.item, now)) return deny("gift", "out-of-season");
        const target = resolveTarget(this.joined().map((entry) => entry.record), message);
        if (!target || target.bedId === null) return deny("gift", "no-target");
        this.tidy(now);
        const day = koreanDay(now);
        const guest = await hashGuest(record.guestId);
        const sql = this.ctx.storage.sql;
        const used = sql
          .exec<{ count: number }>("SELECT count FROM gift_counts WHERE guest = ? AND day = ?", guest, day)
          .toArray()[0]?.count ?? 0;
        if (used >= GIFTS_PER_DAY) return deny("gift", "gift-limit");

        const stand = target.bedId;
        const placed = sql
          .exec<{ slot: number; ord: number; item: number }>("SELECT slot, ord, item FROM gifts WHERE stand = ?", stand)
          .toArray();
        const slot = giftSlot(placed.map((gift) => ({ slot: gift.slot, order: gift.ord, item: gift.item })));
        const order = (sql.exec<{ next: number }>("SELECT COALESCE(MAX(ord), 0) + 1 AS next FROM gifts").one()).next;
        sql.exec(
          "INSERT OR REPLACE INTO gifts (stand, slot, item, ord, day) VALUES (?, ?, ?, ?, ?)",
          stand,
          slot,
          message.item,
          order,
          day,
        );
        sql.exec(
          `INSERT INTO gift_counts (guest, day, count) VALUES (?, ?, 1)
           ON CONFLICT (guest, day) DO UPDATE SET count = count + 1`,
          guest,
          day,
        );
        this.save(ws, { ...record, lastAction: { ...record.lastAction, gift: nowMs } });
        // 놓은 사람도 서버가 정한 칸을 받아야 하니 모두에게 보내요.
        this.broadcast({ kind: "gift", id: record.id, gift: { stand, slot, item: message.item } });
        return;
      }
      case "lamp": {
        if (!actionReady(record, "lamp", nowMs)) return deny("lamp", "too-fast");
        this.tidy(new Date(nowMs));
        const counts = this.lampCounts();
        const result = lampRoom(record, counts);
        if ("denied" in result) return deny("lamp", result.denied);
        const count = counts[result.room] + 1;
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO lamps (room, count, day) VALUES (?, ?, ?)",
          result.room,
          count,
          koreanDay(new Date(nowMs)),
        );
        this.save(ws, { ...record, lastAction: { ...record.lastAction, lamp: nowMs } });
        this.broadcast({ kind: "lamp", id: record.id, room: result.room, count });
        return;
      }
    }
  }

  private denied(
    ws: WebSocket,
    action: "bless" | "bow" | "gift" | "lamp",
    reason: Extract<ServerMessage, { type: "action-denied" }>["reason"],
  ): void {
    this.send(ws, { v: PROTOCOL_VERSION, type: "action-denied", action, reason });
  }

  private lampCounts(): number[] {
    const counts = ROOMS.map(() => 0);
    for (const row of this.ctx.storage.sql.exec<{ room: number; count: number }>("SELECT room, count FROM lamps")) {
      if (row.room >= 0 && row.room < counts.length) counts[row.room] = row.count;
    }
    return counts;
  }

  /** 한국 시간으로 날짜가 바뀌었으면 어제의 선물과 불빛을 정리해요. 알람 없이 필요할 때만 해요. */
  private tidy(now: Date): void {
    const day = koreanDay(now);
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM gifts WHERE day != ?", day);
    sql.exec("DELETE FROM lamps WHERE day != ?", day);
    sql.exec("DELETE FROM gift_counts WHERE day != ?", day);
  }
}

async function hashGuest(guestId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`onward:${guestId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
