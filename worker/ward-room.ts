import { DurableObject } from "cloudflare:workers";
import {
  clientMessageSchema,
  parseMessage,
  PING,
  PONG,
  PROTOCOL_VERSION,
  WARD_CAPACITY,
} from "../shared/protocol.ts";
import type { ClientMessage, HealthResponse, ServerMessage, WardEvent, WardStats } from "../shared/protocol.ts";
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
import {
  addLatest,
  FIVE_LEAF_ITEM,
  KEEP_MS,
  LEFT_PER_BED,
  takeForTaker,
} from "../shared/left-blessings.ts";
import type { BlessingCard, LeftKind, StoredBlessing } from "../shared/left-blessings.ts";
import { checkNickname } from "../shared/nickname.ts";
import { visitorDelivery, visitorMay, visitorSpot } from "../shared/visit-rules.ts";
import type { VisitRole } from "../shared/ward-rules.ts";

/** 연결마다 붙여 두는 정보예요. 하이버네이션 뒤에는 이것만 남아요. */
type Attachment =
  | { joined: false; ward: number; instance: number }
  | { joined: true; ward: number; instance: number; record: GuestRecord };

const REPLACED_CODE = 4000;
const FULL_CODE = 4001;
const MAX_INSTANCE = 20;
type DeniedAction = "bless" | "bow" | "gift" | "lamp" | "visit-link";
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
    // 빈 침대에 남겨진 평안이에요. 침대마다 최근 5개, 7일까지이고, 누가 누우면 전하고 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS left_blessing (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bed INTEGER NOT NULL, nickname TEXT NOT NULL,
      animal TEXT NOT NULL, kind TEXT NOT NULL, item INTEGER, at INTEGER NOT NULL, sender TEXT NOT NULL)`);
    // 오늘 다녀간 사람(guestId 해시)과 오늘 모인 평안 수예요. 한국 날짜별로 두고 지난 날은 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS daily_visitors (
      day TEXT NOT NULL, guest TEXT NOT NULL, PRIMARY KEY (day, guest))`);
    sql.exec(`CREATE TABLE IF NOT EXISTS daily_stats (
      day TEXT PRIMARY KEY, blessings INTEGER NOT NULL DEFAULT 0, lamps INTEGER NOT NULL DEFAULT 0)`);
    // 마지막으로 알린 고양이 방문이에요. 바뀐 것만 알리려고 둬요.
    sql.exec(`CREATE TABLE IF NOT EXISTS cat_visits (
      room INTEGER PRIMARY KEY, bed INTEGER NOT NULL, at INTEGER NOT NULL)`);
    // 이 객체가 맡은 병동 번호예요. 문병 링크 주인의 위치를 알릴 때 써요.
    sql.exec(`CREATE TABLE IF NOT EXISTS place (ward INTEGER NOT NULL, instance INTEGER NOT NULL)`);
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
    const search = new URL(request.url).searchParams;
    const instance = Number(search.get("instance")) || 1;
    const ward = Number(search.get("ward")) || 1;
    // 연결이 없을 때 깨어나는 alarm에서도 이 병동이 어디인지 알 수 있게 적어 둬요. 값이 같으면 쓰지 않아요.
    const sql = this.ctx.storage.sql;
    const saved = sql.exec<{ ward: number; instance: number }>("SELECT ward, instance FROM place").toArray()[0];
    if (saved?.ward !== ward || saved?.instance !== instance) {
      sql.exec("DELETE FROM place");
      sql.exec("INSERT INTO place (ward, instance) VALUES (?, ?)", ward, instance);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ joined: false, ward, instance } satisfies Attachment);
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
      await this.leftWard(guest.key, guest.record);
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
    ws.serializeAttachment({ joined: true, ward: attachment.ward, instance: attachment.instance, record } satisfies Attachment);
  }

  /** 이 병동의 번호예요. 연결이 처음 들어올 때 적어 둔 값이에요. */
  private place(): { ward: number; instance: number } {
    return this.ctx.storage.sql.exec<{ ward: number; instance: number }>("SELECT ward, instance FROM place").toArray()[0] ?? {
      ward: 1,
      instance: 1,
    };
  }

  /** 문병 링크의 주인이 이 병동에 있으면 그 기록이에요. 잠시 끊긴 주인도 자리를 지키고 있어요. */
  private ownerHere(owner: string): { record: GuestRecord; ws: WebSocket | null } | null {
    const joined = this.joined().find((entry) => entry.record.key === owner);
    if (joined) return { record: joined.record, ws: joined.ws };
    const away = this.awayGuests().find((guest) => guest.key === owner);
    return away ? { record: away.record, ws: null } : null;
  }

  /** 유예가 끝나 정말 나간 사람이에요. 문병객이면 자리를 돌려주고, 링크 주인이면 마지막 위치를 알려요. */
  private async leftWard(key: string, record: GuestRecord): Promise<void> {
    if (record.visit) await this.directory().releaseVisit(record.visit.session);
    if (record.linked) await this.directory().reportLocation(key, { ...this.place(), bed: record.bed });
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
      ws.serializeAttachment({
        joined: false,
        ward: attachment?.ward ?? 1,
        instance: attachment?.instance ?? 1,
      } satisfies Attachment);
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
    const previous = returning?.record ?? stillOpen;

    // 문병 링크로 왔으면 directory에서 확인해요. 30초 안에 돌아온 문병객은 이미 받은 역할을 그대로 써요.
    let visit: { role: VisitRole; spot: { x: number; z: number } } | null = null;
    if (hello.visitToken && !previous?.visit) {
      // 닉네임이 맞지 않으면 링크를 세지 않고 먼저 돌려보내요.
      const nickname = checkNickname(hello.nickname);
      if (!nickname.ok) {
        this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-rejected", problem: nickname.problem });
        return;
      }
      const resolved = await this.directory().resolveVisit(hello.visitToken, key, now);
      if (resolved.kind === "busy") {
        // 들어가지 않고 기다려요. 연결은 열어 두어 다시 hello를 보낼 수 있어요.
        this.send(ws, { v: PROTOCOL_VERSION, type: "visit-denied", reason: "busy" });
        return;
      }
      if (resolved.kind === "closed") {
        // 꺼졌거나 없는 링크예요. 알리고 일반 입장으로 이어 가요.
        this.send(ws, { v: PROTOCOL_VERSION, type: "visit-denied", reason: "closed" });
      }
      if (resolved.kind === "ok") {
        // 주인이 이 병동에 누워 있으면 그 침대로, 아니면 마지막에 있던 침대로 가요.
        const owner = this.ownerHere(resolved.owner);
        const bed = owner?.record.bed ?? resolved.bed;
        const already = this.everyone(ws).filter((guest) => guest.visit?.owner === resolved.owner).length;
        visit = {
          role: { owner: resolved.owner, bed, session: resolved.session, ownerNickname: resolved.ownerNickname },
          spot: visitorSpot(bed, already),
        };
      }
    }

    const nonVisitorsAway = away.filter((guest) => !guest.record.visit).length;
    const admission = admit(
      others.map((other) => other.record),
      nonVisitorsAway - (returning && !returning.record.visit ? 1 : 0),
      hello,
      WARD_CAPACITY,
      crypto.randomUUID().replace(/-/g, "").slice(0, 8),
      previous,
      visit,
    );
    if (admission.kind === "rejected") {
      if (visit) await this.directory().releaseVisit(visit.role.session);
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
        old.ws.serializeAttachment({ joined: false, ward: attachment.ward, instance: attachment.instance } satisfies Attachment);
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

    // 새로 들어오면 directory에서 새 평안 주소를 받고, 없는 동안 도착한 평안을 꺼내요.
    // 30초 안에 돌아온 사람은 쓰던 주소를 그대로 써서 directory에 묻지 않아요.
    // 링크 주인이면 이번 주소와 병동 위치를 directory에 함께 적어요. 문병객은 자기 링크의 위치를 바꾸지 않아요.
    let record: GuestRecord = { ...admission.record, key };
    let inbox: SendableCard[] = [];
    if (!admission.restored || !record.address) {
      const place = record.visit
        ? null
        : { ward: attachment.ward, instance: attachment.instance, bed: record.bed, nickname: record.nickname, animal: record.animal };
      const entered = await this.directory().enter(key, now, place);
      record = { ...record, address: entered.address, linked: entered.linked };
      inbox = entered.inbox.filter(isCard);
    }
    const role = record.visit ?? null;
    const owner = role ? this.ownerHere(role.owner) : null;
    this.save(ws, attachment, record);
    this.tidy(new Date(now));
    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      you: record.id,
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
      inbox,
      stats: this.stats(now),
      visit: role ? { ownerNickname: role.ownerNickname, ownerPresent: owner !== null, bed: role.bed } : null,
    });
    if (admission.restored) {
      // 다른 사람에게는 자리를 비운 적이 없던 것처럼 보여요. 모습이 바뀌었을 때만 알려요.
      this.broadcast({ kind: "update", guest: toPublic(record) }, ws);
    } else {
      this.broadcast({ kind: "join", guest: toPublic(record) }, ws);
    }
    this.refreshCatVisits(before);
    this.countVisitor(key, now);
    // 새로 온 문병객이면 주인 화면에만 알려요.
    if (role && !admission.restored && owner?.ws) {
      this.send(owner.ws, { v: PROTOCOL_VERSION, type: "visitor-arrived", id: record.id, nickname: record.nickname });
    }
  }

  private async act(ws: WebSocket, attachment: Extract<Attachment, { joined: true }>, message: ClientMessage): Promise<void> {
    const record = attachment.record;
    const nowMs = Date.now();
    const deny = (action: DeniedAction, reason: DeniedReason, item?: number): void => {
      this.send(ws, { v: PROTOCOL_VERSION, type: "action-denied", action, reason, ...(item === undefined ? {} : { item }) });
    };
    const save = (next: GuestRecord): void => this.save(ws, attachment, next);
    // 문병객은 걷기, 평안, 목례와 한마디, 선물만 할 수 있어요. 나머지는 말없이 무시해요.
    if (record.visit && !visitorMay(message.type)) return;

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
        // 링크 주인이면 문병객이 찾아올 침대를 알려요.
        if (record.linked && record.key) {
          await this.directory().reportLocation(record.key, { ...this.place(), bed: message.bedId });
        }
        // 그 침대에 남겨져 있던 평안을 전하고 바로 지워요.
        await this.deliverLeft(ws, message.bedId, record, nowMs);
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
        this.countBlessing(nowMs);
        return;
      }
      case "bless": {
        if (!actionReady(record, "bless", nowMs)) return deny("bless", "too-fast");
        const target = resolveTarget(this.everyone(), message);
        if (!target) return deny("bless", "no-target");
        if (record.visit && this.toOwnerInbox(record.visit, target.bedId)) {
          // 주인이 자리에 없으면 주인 침대로 보낸 평안은 주인에게 전해요. 빈 침대에는 남기지 않아요.
          const result = await this.leaveForVisitedOwner(record, "bless", null, nowMs);
          if (result !== "saved") return deny("bless", result === "once-a-day" ? "once-a-day" : "no-target");
          save({ ...record, lastAction: { ...record.lastAction, bless: nowMs } });
          this.broadcast({ kind: "bless", id: record.id, ...target }, ws);
          this.send(ws, { v: PROTOCOL_VERSION, type: "left-saved" });
          this.countBlessing(nowMs);
          return;
        }
        save({ ...record, lastAction: { ...record.lastAction, bless: nowMs } });
        this.broadcast({ kind: "bless", id: record.id, ...target }, ws);
        // 빈 침대면 다음에 누울 사람을 위해 남겨 둬요.
        if (target.bedId !== null && target.targetId === null && this.bedIsEmpty(target.bedId)) {
          await this.leaveOnBed(target.bedId, record, "bless", null, nowMs);
        }
        this.countBlessing(nowMs);
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
        // 주인이 자리에 없으면 주인 침대의 선물은 주인에게도 전해요. 하루 한 번이 넘으면 놓지 않아요.
        const toOwner = record.visit !== undefined && this.toOwnerInbox(record.visit, target.bedId);
        if (toOwner) {
          const result = await this.leaveForVisitedOwner(record, "gift", message.item, nowMs);
          if (result !== "saved") return deny("gift", result === "once-a-day" ? "once-a-day" : "no-target");
        }
        // 오잎클로버는 어느 병동에서든 하루 한 번이에요. 그래서 공용 directory에서 세요.
        if (message.item === FIVE_LEAF_ITEM && !(await this.directory().useDailyGift(guest, FIVE_LEAF_ITEM, day))) {
          return deny("gift", "gift-limit", FIVE_LEAF_ITEM);
        }
        // 주인에게 전한 선물은 그 침대에 다음 사람 몫으로 남기지 않아요.
        const emptyBed = !toOwner && this.bedIsEmpty(target.bedId);

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
        if (emptyBed) await this.leaveOnBed(stand, record, "gift", message.item, nowMs);
        if (toOwner) this.send(ws, { v: PROTOCOL_VERSION, type: "left-saved" });
        this.countBlessing(nowMs);
        return;
      }
      case "leave-for": {
        const action = message.kind;
        if (!actionReady(record, action, nowMs)) return deny(action, "too-fast");
        const now = new Date(nowMs);
        const item = message.item ?? null;
        if (item !== null && !giftAllowedNow(item, now)) return deny("gift", "out-of-season", item);
        const day = koreanDay(now);
        const sender = await hashGuest(record.guestId);
        const directory = this.directory();
        if (item === FIVE_LEAF_ITEM && !(await directory.useDailyGift(sender, FIVE_LEAF_ITEM, day))) {
          return deny("gift", "gift-limit", FIVE_LEAF_ITEM);
        }
        const result = await directory.leaveFor(
          sender,
          message.address,
          { nickname: record.nickname, animal: record.animal, kind: message.kind, item, at: nowMs },
          nowMs,
          day,
        );
        save({ ...record, lastAction: { ...record.lastAction, [action]: nowMs } });
        if (result === "saved") {
          this.send(ws, { v: PROTOCOL_VERSION, type: "left-saved" });
          this.countBlessing(nowMs);
        }
        else deny(action, result === "once-a-day" ? "once-a-day" : "no-target");
        return;
      }
      case "visit-link": {
        if (!actionReady(record, "link", nowMs)) return deny("visit-link", "too-fast");
        const key = record.key ?? (await hashGuest(record.guestId));
        const directory = this.directory();
        let token: string | null = null;
        let linked = record.linked ?? false;
        if (message.action === "create") {
          // 내 침대로 오는 링크라서 침대에 누워 있을 때만 만들 수 있어요.
          if (record.bed === null) return deny("visit-link", "no-bed");
          token = await directory.createVisitLink(
            key,
            { nickname: record.nickname, animal: record.animal, address: record.address },
            { ward: attachment.ward, instance: attachment.instance, bed: record.bed },
            nowMs,
          );
          linked = true;
        } else if (message.action === "off") {
          await directory.disableVisitLink(key);
          linked = false;
        }
        const status = await directory.visitLinkStatus(key);
        linked = linked && status.active;
        save({ ...record, key, linked, lastAction: { ...record.lastAction, link: nowMs } });
        this.send(ws, { v: PROTOCOL_VERSION, type: "visit-link", token, active: status.active, visits: status.visits });
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
        this.countBlessing(nowMs, true);
        return;
      }
    }
  }

  /** 문병객이 주인 침대로 보냈는데 주인이 이 병동에 없으면 주인에게 전해요. */
  private toOwnerInbox(visit: VisitRole, targetBed: number | null): boolean {
    return visitorDelivery(visit.bed, this.ownerHere(visit.owner) !== null, targetBed) === "owner-inbox";
  }

  private async leaveForVisitedOwner(record: GuestRecord, kind: LeftKind, item: number | null, nowMs: number) {
    const visit = record.visit;
    if (!visit) return "unknown" as const;
    const sender = record.key ?? (await hashGuest(record.guestId));
    return this.directory().leaveForOwner(
      sender,
      visit.owner,
      { nickname: record.nickname, animal: record.animal, kind, item, at: nowMs },
      nowMs,
      koreanDay(new Date(nowMs)),
    );
  }

  /** 오늘의 집계예요. */
  private stats(nowMs: number): WardStats {
    const day = koreanDay(new Date(nowMs));
    const sql = this.ctx.storage.sql;
    const visitors = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM daily_visitors WHERE day = ?", day).one().n;
    const row = sql.exec<{ blessings: number; lamps: number }>("SELECT blessings, lamps FROM daily_stats WHERE day = ?", day).toArray()[0];
    return { visitors, blessings: row?.blessings ?? 0, lamps: row?.lamps ?? 0 };
  }

  /** 평안이 모이면 하나 더하고 모두에게 알려요. 불빛은 불빛 수에도 더해요. */
  private countBlessing(nowMs: number, lamp = false): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO daily_stats (day, blessings, lamps) VALUES (?, 1, ?)
       ON CONFLICT (day) DO UPDATE SET blessings = blessings + 1, lamps = lamps + excluded.lamps`,
      koreanDay(new Date(nowMs)),
      lamp ? 1 : 0,
    );
    this.broadcast({ kind: "stats", stats: this.stats(nowMs) });
  }

  /** 오늘 처음 온 사람이면 다녀간 동물을 하나 더하고, 그때만 알려요. */
  private countVisitor(guestHash: string, nowMs: number): void {
    const cursor = this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO daily_visitors (day, guest) VALUES (?, ?)",
      koreanDay(new Date(nowMs)),
      guestHash,
    );
    if (cursor.rowsWritten > 0) this.broadcast({ kind: "stats", stats: this.stats(nowMs) });
  }

  private directory() {
    return this.env.DIRECTORY.getByName("directory");
  }

  /** 아무도 누워 있지 않은 침대예요. 잠시 끊긴 사람의 침대도 누워 있는 것으로 봐요. */
  private bedIsEmpty(bed: number): boolean {
    return !this.everyone().some((guest) => guest.bed === bed);
  }

  /** 빈 침대에 평안을 남겨요. 침대마다 최근 5개만 두고 나머지는 지워요. */
  private async leaveOnBed(bed: number, record: GuestRecord, kind: LeftKind, item: number | null, nowMs: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    const sender = await hashGuest(record.guestId);
    const existing = sql.exec<{ id: number; at: number }>("SELECT id, at FROM left_blessing WHERE bed = ?", bed).toArray();
    const kept = addLatest(existing, { id: -1, at: nowMs }, LEFT_PER_BED, nowMs);
    for (const row of existing) {
      if (!kept.some((entry) => entry.id === row.id)) sql.exec("DELETE FROM left_blessing WHERE id = ?", row.id);
    }
    sql.exec(
      "INSERT INTO left_blessing (bed, nickname, animal, kind, item, at, sender) VALUES (?, ?, ?, ?, ?, ?, ?)",
      bed,
      record.nickname,
      record.animal,
      kind,
      item,
      nowMs,
      sender,
    );
  }

  /** 침대를 받은 사람에게 그 침대에 남겨진 평안을 전하고 지워요. */
  private async deliverLeft(ws: WebSocket, bed: number, record: GuestRecord, nowMs: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    const rows = sql
      .exec<{ nickname: string; animal: string; kind: string; item: number | null; at: number; sender: string }>(
        "SELECT nickname, animal, kind, item, at, sender FROM left_blessing WHERE bed = ?",
        bed,
      )
      .toArray();
    if (rows.length === 0) return;
    sql.exec("DELETE FROM left_blessing WHERE bed = ?", bed);
    const stored: StoredBlessing[] = rows.map((row) => ({ ...row, kind: row.kind === "gift" ? "gift" : "bless" }));
    const cards = takeForTaker(stored, await hashGuest(record.guestId), nowMs).filter(isCard);
    if (cards.length > 0) {
      this.send(ws, { v: PROTOCOL_VERSION, type: "left-blessings", bedId: bed, cards });
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
    sql.exec("DELETE FROM left_blessing WHERE at < ?", now.getTime() - KEEP_MS);
    sql.exec("DELETE FROM daily_visitors WHERE day != ?", day);
    sql.exec("DELETE FROM daily_stats WHERE day != ?", day);
  }
}

async function hashGuest(guestId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`onward:${guestId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const ANIMALS = new Set(["rabbit", "bear", "penguin", "otter", "deer"]);
type SendableCard = BlessingCard & { animal: "rabbit" | "bear" | "penguin" | "otter" | "deer" };

/** 저장소에서 읽은 카드가 화면에 보내도 되는 모양인지 확인해요. */
function isCard(card: BlessingCard): card is SendableCard {
  return ANIMALS.has(card.animal);
}
