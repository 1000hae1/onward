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
import { bedApproach, BEDS, roomAt, ROOMS } from "../shared/ward-layout.ts";
import {
  actionReady,
  admit,
  alarmToSet,
  catVisits,
  changedVisits,
  claimBed,
  clampToWalkable,
  expireAway,
  giftAllowedNow,
  GIFTS_PER_DAY,
  giftSlot,
  koreanDay,
  lampRoom,
  nextAlarmAt,
  nextInstance,
  readVersion,
  resolveTarget,
  seasonalGiftsAllowed,
  toAway,
  toPublic,
  updateProfile,
} from "../shared/ward-rules.ts";
import type { AwayGuest, CatVisit, GuestRecord } from "../shared/ward-rules.ts";

/** 연결마다 붙여 두는 정보예요. 하이버네이션 뒤에는 이것만 남아요. */
type Attachment =
  | { joined: false; instance: number }
  | { joined: true; instance: number; record: GuestRecord };

const REPLACED_CODE = 4000;
const FULL_CODE = 4001;
const MAX_INSTANCE = 20;
type DeniedAction = "bless" | "bow" | "gift" | "lamp";
type DeniedReason = Extract<ServerMessage, { type: "action-denied" }>["reason"];

/**
 * 병동 인스턴스 하나를 맡는 Durable Object예요. 건물 하나, 병실 여섯, 침대 서른여섯이에요.
 * 주기적으로 도는 일은 없어요. 메시지가 오거나, 끊긴 사람의 유예가 끝날 때만 깨어나요.
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
    // 잠시 끊긴 사람이에요. 30초 안에 돌아오면 침대와 자리를 돌려줘요.
    sql.exec(`CREATE TABLE IF NOT EXISTS away (
      key TEXT PRIMARY KEY, record TEXT NOT NULL, until INTEGER NOT NULL)`);
    // 마지막으로 알린 고양이 방문이에요. 바뀐 것만 알리려고 둬요.
    sql.exec(`CREATE TABLE IF NOT EXISTS cat_visits (
      room INTEGER PRIMARY KEY, bed INTEGER NOT NULL, at INTEGER NOT NULL)`);
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
    const instance = Number(new URL(request.url).searchParams.get("instance")) || 1;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ joined: false, instance } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const version = readVersion(raw);
    if (version !== null && version !== PROTOCOL_VERSION) {
      // 화면이 다른 버전이면 새로고침하라고 알려요. 나머지는 읽지 않아요.
      this.send(ws, { v: PROTOCOL_VERSION, type: "version-mismatch" });
      return;
    }
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
    await this.act(ws, attachment, message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.disconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.disconnect(ws);
  }

  /** 끊긴 사람의 유예가 끝나면 침대를 반납하고 나갔다고 알려요. 남은 사람이 있을 때만 다시 맞춰요. */
  async alarm(): Promise<void> {
    const { expired, nextAlarm } = expireAway(this.awayGuests(), Date.now());
    const before = this.lastVisits();
    for (const guest of expired) {
      this.ctx.storage.sql.exec("DELETE FROM away WHERE key = ?", guest.key);
      this.broadcast({ kind: "leave", id: guest.record.id });
    }
    if (nextAlarm !== null) await this.ctx.storage.setAlarm(nextAlarm);
    if (expired.length > 0) this.refreshCatVisits(before);
  }

  /** 지금 연결된 사람들이에요. 연결에 붙은 정보로 매번 다시 만들어요. */
  private joined(except?: WebSocket): { ws: WebSocket; record: GuestRecord }[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      if (ws === except) return [];
      const attachment = ws.deserializeAttachment() as Attachment | null;
      return attachment?.joined ? [{ ws, record: attachment.record }] : [];
    });
  }

  private awayGuests(): AwayGuest[] {
    return this.ctx.storage.sql
      .exec<{ key: string; record: string; until: number }>("SELECT key, record, until FROM away")
      .toArray()
      .map((row) => ({ key: row.key, record: JSON.parse(row.record) as GuestRecord, until: row.until }));
  }

  /** 병실에 있는 모든 사람이에요. 잠시 끊긴 사람도 자리를 지키고 있어요. */
  private everyone(except?: WebSocket): GuestRecord[] {
    return [...this.joined(except).map((entry) => entry.record), ...this.awayGuests().map((guest) => guest.record)];
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

  private save(ws: WebSocket, attachment: Attachment, record: GuestRecord): void {
    ws.serializeAttachment({ joined: true, instance: attachment.instance, record } satisfies Attachment);
  }

  private lastVisits(): CatVisit[] {
    return this.ctx.storage.sql
      .exec<{ room: number; bed: number; at: number }>("SELECT room, bed, at FROM cat_visits")
      .toArray();
  }

  /** 누가 들고 나거나 눕고 일어날 때만 고양이 방문을 다시 계산하고, 바뀐 병실만 알려요. */
  private refreshCatVisits(before: CatVisit[]): void {
    const after = catVisits(this.everyone());
    const changes = changedVisits(before, after);
    if (changes.length === 0) return;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    for (const change of changes) {
      if (change.visit) {
        sql.exec(
          "INSERT OR REPLACE INTO cat_visits (room, bed, at) VALUES (?, ?, ?)",
          change.room,
          change.visit.bed,
          change.visit.at,
        );
      } else {
        sql.exec("DELETE FROM cat_visits WHERE room = ?", change.room);
      }
      this.broadcast({ kind: "cat-visit", room: change.room, visit: change.visit, changedAt: now });
    }
  }

  private async disconnect(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.serializeAttachment({ joined: false, instance: attachment?.instance ?? 1 } satisfies Attachment);
    } catch {
      // 닫힌 연결에는 쓸 수 없어도 괜찮아요.
    }
    try {
      ws.close(1000, "bye");
    } catch {
      // 이미 닫혔으면 그대로예요.
    }
    if (!attachment?.joined) return;
    // 바로 내보내지 않고 30초 동안 자리를 맡아 둬요. 다른 사람에게는 그대로 보여요.
    const now = Date.now();
    const away = toAway(attachment.record, await hashGuest(attachment.record.guestId), now);
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO away (key, record, until) VALUES (?, ?, ?)",
      away.key,
      JSON.stringify(away.record),
      away.until,
    );
    // alarm은 이보다 이른 것이 없을 때만 맞춰요.
    const wanted = alarmToSet(await this.ctx.storage.getAlarm(), away.until);
    if (wanted !== null) await this.ctx.storage.setAlarm(wanted);
  }

  private async hello(
    ws: WebSocket,
    attachment: Attachment,
    hello: Extract<ClientMessage, { type: "hello" }>,
  ): Promise<void> {
    if (attachment.joined) {
      // 이미 들어와 있으면 모습만 바꿔요.
      const before = this.lastVisits();
      const result = updateProfile(attachment.record, hello);
      if (result.kind === "rejected") {
        this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-rejected", problem: result.problem });
        return;
      }
      this.save(ws, attachment, result.record);
      this.broadcast({ kind: "update", guest: toPublic(result.record) }, ws);
      if (result.record.bed !== attachment.record.bed) this.refreshCatVisits(before);
      return;
    }

    const now = Date.now();
    const key = await hashGuest(hello.guestId);
    const away = this.awayGuests().filter((guest) => guest.until > now);
    const returning = away.find((guest) => guest.key === key) ?? null;
    const others = this.joined(ws);
    // 끊긴 줄 아직 모르는 예전 연결이 남아 있어도 같은 사람이면 그 자리를 이어받아요.
    const stillOpen = others.find((other) => other.record.guestId === hello.guestId)?.record ?? null;
    const admission = admit(
      others.map((other) => other.record),
      away.length - (returning ? 1 : 0),
      hello,
      WARD_CAPACITY,
      crypto.randomUUID().replace(/-/g, "").slice(0, 8),
      returning?.record ?? stillOpen,
    );
    if (admission.kind === "rejected") {
      this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-rejected", problem: admission.problem });
      return;
    }
    if (admission.kind === "full") {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "room-full",
        capacity: WARD_CAPACITY,
        next: nextInstance(attachment.instance, MAX_INSTANCE),
      });
      ws.close(FULL_CODE, "full");
      return;
    }
    if (admission.replaces) {
      // 같은 사람이 새로 들어오면 예전 연결을 닫아요. 끊김이 아니라서 자리를 맡아 두지 않아요.
      const old = others.find((other) => other.record.id === admission.replaces);
      if (old) {
        old.ws.serializeAttachment({ joined: false, instance: attachment.instance } satisfies Attachment);
        // 자리를 이어받았으니 다른 사람에게 나갔다고 알리지 않아요.
        try {
          old.ws.close(REPLACED_CODE, "replaced");
        } catch {
          // 이미 닫혔으면 그대로예요.
        }
      }
    }
    const before = this.lastVisits();
    if (returning) {
      this.ctx.storage.sql.exec("DELETE FROM away WHERE key = ?", returning.key);
      // 맡아 둔 사람이 더 없으면 alarm도 지워요. 쓸데없이 깨지 않게요.
      if (nextAlarmAt(away.filter((guest) => guest !== returning)) === null) {
        await this.ctx.storage.deleteAlarm();
      }
    }

    this.save(ws, attachment, admission.record);
    this.tidy(new Date(now));
    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      you: admission.record.id,
      capacity: WARD_CAPACITY,
      guests: this.everyone().map(toPublic),
      gifts: this.ctx.storage.sql
        .exec<{ stand: number; slot: number; item: number }>("SELECT stand, slot, item FROM gifts")
        .toArray(),
      lamps: this.lampCounts(),
      seasonalGifts: seasonalGiftsAllowed(new Date(now)),
      serverNow: now,
      catVisits: catVisits(this.everyone()),
      restored: admission.restored,
    });
    if (admission.restored) {
      // 다른 사람에게는 자리를 비운 적이 없던 것처럼 보여요. 모습이 바뀌었을 때만 알려요.
      this.broadcast({ kind: "update", guest: toPublic(admission.record) }, ws);
    } else {
      this.broadcast({ kind: "join", guest: toPublic(admission.record) }, ws);
    }
    this.refreshCatVisits(before);
  }

  private async act(ws: WebSocket, attachment: Extract<Attachment, { joined: true }>, message: ClientMessage): Promise<void> {
    const record = attachment.record;
    const nowMs = Date.now();
    const deny = (action: DeniedAction, reason: DeniedReason): void => {
      this.send(ws, { v: PROTOCOL_VERSION, type: "action-denied", action, reason });
    };
    const save = (next: GuestRecord): void => this.save(ws, attachment, next);

    switch (message.type) {
      case "walk-to": {
        const spot = clampToWalkable(message.x, message.z);
        if (spot.x !== message.x || spot.z !== message.z) {
          this.send(ws, { v: PROTOCOL_VERSION, type: "position-corrected", x: spot.x, z: spot.z });
        }
        // 걸어가면 누워 있던 침대는 비워요.
        const hadBed = record.bed !== null;
        const roomChanged = roomAt(record.x, record.z)?.index !== roomAt(spot.x, spot.z)?.index;
        // 고양이 방문은 병실을 옮기거나 일어날 때만 따지니, 그때만 저장소를 읽어요.
        const before = hadBed || roomChanged ? this.lastVisits() : [];
        save({ ...record, x: spot.x, z: spot.z, bed: null, lyingSince: null });
        if (hadBed) this.broadcast({ kind: "get-up", id: record.id }, ws);
        this.broadcast({ kind: "walk", id: record.id, x: spot.x, z: spot.z }, ws);
        // 병실을 옮기거나 침대에서 일어났을 때만 고양이 방문을 다시 따져요.
        if (hadBed || roomChanged) this.refreshCatVisits(before);
        return;
      }
      case "lie-down": {
        const result = claimBed(this.everyone(), record, message.bedId, nowMs);
        if (!result.granted) {
          this.send(ws, { v: PROTOCOL_VERSION, type: "bed-unavailable", bedId: message.bedId });
          return;
        }
        const before = this.lastVisits();
        // 눕는 사람은 침대 곁 자리에 있는 것으로 봐요.
        const spot = bedApproach(BEDS[message.bedId]);
        save({ ...result.record, x: spot.x, z: spot.z });
        this.send(ws, { v: PROTOCOL_VERSION, type: "bed-granted", bedId: message.bedId });
        this.broadcast({ kind: "lie", id: record.id, bedId: message.bedId }, ws);
        this.refreshCatVisits(before);
        return;
      }
      case "get-up": {
        if (record.bed === null) return;
        const before = this.lastVisits();
        save({ ...record, bed: null, lyingSince: null });
        this.broadcast({ kind: "get-up", id: record.id }, ws);
        this.refreshCatVisits(before);
        return;
      }
      case "bow": {
        if (!actionReady(record, "bow", nowMs)) return deny("bow", "too-fast");
        save({ ...record, lastAction: { ...record.lastAction, bow: nowMs } });
        this.broadcast({ kind: "bow", id: record.id, phrase: message.phrase }, ws);
        return;
      }
      case "bless": {
        if (!actionReady(record, "bless", nowMs)) return deny("bless", "too-fast");
        const target = resolveTarget(this.everyone(), message);
        if (!target) return deny("bless", "no-target");
        save({ ...record, lastAction: { ...record.lastAction, bless: nowMs } });
        this.broadcast({ kind: "bless", id: record.id, ...target }, ws);
        return;
      }
      case "gift": {
        const now = new Date(nowMs);
        if (!actionReady(record, "gift", nowMs)) return deny("gift", "too-fast");
        if (!giftAllowedNow(message.item, now)) return deny("gift", "out-of-season");
        const target = resolveTarget(this.everyone(), message);
        if (!target || target.bedId === null) return deny("gift", "no-target");
        this.tidy(now);
        const day = koreanDay(now);
        const guest = await hashGuest(record.guestId);
        const sql = this.ctx.storage.sql;
        const used =
          sql
            .exec<{ count: number }>("SELECT count FROM gift_counts WHERE guest = ? AND day = ?", guest, day)
            .toArray()[0]?.count ?? 0;
        if (used >= GIFTS_PER_DAY) return deny("gift", "gift-limit");

        const stand = target.bedId;
        const placed = sql
          .exec<{ slot: number; ord: number; item: number }>("SELECT slot, ord, item FROM gifts WHERE stand = ?", stand)
          .toArray();
        const slot = giftSlot(placed.map((gift) => ({ slot: gift.slot, order: gift.ord, item: gift.item })));
        const order = sql.exec<{ next: number }>("SELECT COALESCE(MAX(ord), 0) + 1 AS next FROM gifts").one().next;
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
        save({ ...record, lastAction: { ...record.lastAction, gift: nowMs } });
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
        save({ ...record, lastAction: { ...record.lastAction, lamp: nowMs } });
        this.broadcast({ kind: "lamp", id: record.id, room: result.room, count });
        return;
      }
    }
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
