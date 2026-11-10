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
import {
  animalLabel,
  deleteExpired,
  earlierAlarm,
  earliestExpiry,
  enforceBannedNickname,
  newRateState,
  nextRetentionAlarm,
  publicNickname,
  rateStep,
} from "../shared/safety-rules.ts";
import type { Moderation, RateState, RetentionRule } from "../shared/safety-rules.ts";
import { autoNickname } from "../shared/nickname.ts";
import { hashGuest, IP_HASH_PATTERN, issueGuest, requireSecret, verifyGuest } from "./security.ts";
import { logError } from "./log.ts";
import { visitorDelivery, visitorMay, visitorSpot } from "../shared/visit-rules.ts";
import type { VerifiedHello, VisitRole } from "../shared/ward-rules.ts";
import { checkHugAnswer, checkHugRequest, HUG_ANSWER_MS, HUG_REPEAT_MS, hugSpot, hugStillPossible } from "../shared/hug-rules.ts";
import type { PendingHug } from "../shared/hug-rules.ts";
import type { GuestbookStatus } from "./directory.ts";
import { isMorningWindow, phraseAllowed, shouldOpenWindow } from "../shared/morning.ts";
import { addPeace } from "../shared/planter.ts";
import { canDischarge, countFarewell, FAREWELL_MS, farewellCount, startDischarge } from "../shared/discharge-rules.ts";
import { shouldGreet } from "../shared/return-rules.ts";
import { hugAvailable } from "../shared/ward-rules.ts";
import { claimBed, isLying, lieDown, releaseBed, seatOnEntry, standUp } from "../shared/bed-rules.ts";
import { headcount, shouldReport } from "../shared/presence-rules.ts";
import { departureOf, MAX_DEPARTURES_PER_REPORT } from "../shared/metrics-rules.ts";

/** 연결마다 붙여 두는 정보예요. 하이버네이션 뒤에는 이것만 남아요. */
type Attachment =
  | { joined: false; ward: number; instance: number; ip?: string | null }
  | { joined: true; ward: number; instance: number; ip?: string | null; record: GuestRecord };

const REPLACED_CODE = 4000;
const FULL_CODE = 4001;
/** 들어올 수 없어요(차단, 새 게스트를 너무 많이 만듦). 화면은 다시 잇지 않아요. */
const DENIED_CODE = 4003;
/** 들어오는 일을 처리하지 못했어요. 화면은 다시 이어요. */
const ENTRY_FAILED_CODE = 1011;
/** 메시지를 너무 빨리 계속 보냈어요. */
const TOO_MANY_CODE = 4008;
/** Worker가 IP 해시를 담아 보내는 내부 헤더예요. Worker가 항상 덮어써서 화면이 바꿀 수 없어요. */
export const IP_HASH_HEADER = "X-Onward-Ip-Hash";
/** IP 해시가 없을 때 요청 제한을 셀 자리예요. Worker를 거치면 생기지 않아요. */
const NO_IP = "0".repeat(64);

/** 병실에서 보관 기간이 있는 표예요. */
const RETENTION: readonly RetentionRule[] = [
  { table: "left_blessing", kind: "at", column: "at", keepMs: KEEP_MS },
  { table: "gifts", kind: "day", column: "day" },
  { table: "lamps", kind: "day", column: "day" },
  { table: "gift_counts", kind: "day", column: "day" },
  { table: "daily_visitors", kind: "day", column: "day" },
  { table: "daily_stats", kind: "day", column: "day" },
  { table: "morning_open", kind: "day", column: "day" },
  { table: "hug_sent", kind: "at", column: "at", keepMs: HUG_REPEAT_MS },
  { table: "hug_pending", kind: "at", column: "at", keepMs: HUG_ANSWER_MS },
];
const MAX_INSTANCE = 20;
type DeniedAction = Extract<ServerMessage, { type: "action-denied" }>["action"];
type DeniedReason = Extract<ServerMessage, { type: "action-denied" }>["reason"];

/**
 * 병동 인스턴스 하나를 맡는 Durable Object예요. 건물 하나, 병실 여섯, 침대 서른여섯이에요.
 * 주기적으로 도는 일은 없어요. 메시지가 오거나, 끊긴 사람의 유예가 끝나거나,
 * 보관 기간이 지난 데이터가 있을 때(하루에 많아야 한 번)만 깨어나요.
 */
export class WardRoom extends DurableObject<Env> {
  /** 연결마다 1초에 받은 메시지 수예요. 하이버네이션 뒤에는 0부터 다시 세요. 그동안 조용했다는 뜻이라 괜찮아요. */
  private readonly rates = new WeakMap<WebSocket, RateState>();

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
    // 이 객체가 맡은 병동 번호예요. 방명록 링크 주인의 위치를 알릴 때 써요.
    sql.exec(`CREATE TABLE IF NOT EXISTS place (ward INTEGER NOT NULL, instance INTEGER NOT NULL)`);
    // 다음에 보관 기간을 정리할 시각이에요. alarm 하나를 재접속 유예와 함께 쓰려고 적어 둬요.
    sql.exec(`CREATE TABLE IF NOT EXISTS retention (due INTEGER NOT NULL)`);
    // 병실마다 모인 평안의 누적 수예요. 더하기만 하고 지우지 않아요.
    sql.exec(`CREATE TABLE IF NOT EXISTS planter (room INTEGER PRIMARY KEY, total INTEGER NOT NULL)`);
    // 오늘 아침 창문이 열린 병실이에요. 병실마다 하루 한 번이에요.
    sql.exec(`CREATE TABLE IF NOT EXISTS morning_open (
      room INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (room, day))`);
    // 안아 주기를 보낸 짝(guestId 해시)과 시각이에요. 같은 상대에게 10분에 한 번만 보내려고 둬요.
    sql.exec(`CREATE TABLE IF NOT EXISTS hug_sent (
      sender TEXT NOT NULL, target TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (sender, target))`);
    // 답을 기다리는 안아 주기예요. 타이머 없이, 답이 오면 시각을 견주고 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS hug_pending (
      id TEXT PRIMARY KEY, from_id TEXT NOT NULL, from_key TEXT NOT NULL, to_id TEXT NOT NULL, at INTEGER NOT NULL)`);
    // directory에 마지막으로 알린 인원이에요. 숫자만 둬요. 바뀌었을 때만 다시 알리려고 둬요.
    sql.exec(`CREATE TABLE IF NOT EXISTS presence_sent (
      patients INTEGER NOT NULL, visitors INTEGER NOT NULL, at INTEGER NOT NULL)`);
    // 정말 나간 사람의 머문 시간과 평안 빌기 수예요. 누구인지는 적지 않아요. 다음 인원 보고에 실어 보내고 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS departures (
      id INTEGER PRIMARY KEY AUTOINCREMENT, stay_ms INTEGER NOT NULL, blessings INTEGER NOT NULL)`);
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
    const header = request.headers.get(IP_HASH_HEADER);
    const ip = header && IP_HASH_PATTERN.test(header) ? header : null;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ joined: false, ward, instance, ip } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      await this.receive(ws, raw);
    } catch (error) {
      // 메시지 하나를 처리하다 잘못돼도 연결은 그대로 둬요. 오류 종류만 남겨요.
      logError("ward:message", error);
    }
  }

  private async receive(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    // 1초에 10개를 넘으면 읽지 않아요. 넘친 초가 3번 이어지면 연결을 닫아요.
    const rate = rateStep(this.rates.get(ws) ?? newRateState(), Date.now());
    this.rates.set(ws, rate.state);
    if (rate.verdict === "drop") return;
    if (rate.verdict === "close") {
      await this.disconnect(ws, TOO_MANY_CODE, "too-many");
      return;
    }
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
      try {
        await this.hello(ws, attachment, message);
      } catch (error) {
        // 들어오는 중에 잘못되면 화면이 "연결 중"에 멈추지 않게 알리고 닫아요. 화면은 잠시 뒤 다시 이어요.
        logError("ward:hello", error);
        if (!attachment.joined) {
          this.send(ws, { v: PROTOCOL_VERSION, type: "entry-failed" });
          try {
            ws.close(ENTRY_FAILED_CODE, "entry-failed");
          } catch {
            // 이미 닫혔으면 그대로예요.
          }
        }
      }
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

  /**
   * 끊긴 사람의 유예가 끝나면 침대를 반납하고 나갔다고 알려요.
   * 보관 기간을 정리할 때가 됐으면 지난 데이터를 지워요. 남은 일이 있을 때만 다시 맞춰요.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const { expired, nextAlarm } = expireAway(this.awayGuests(), now);
    const before = this.lastVisits();
    for (const guest of expired) {
      this.ctx.storage.sql.exec("DELETE FROM away WHERE key = ?", guest.key);
      this.broadcast({ kind: "leave", id: guest.record.id });
      await this.leftWard(guest.key, guest.record);
    }
    let due = this.retentionDue();
    if (due !== null && due <= now) {
      deleteExpired(this.ctx.storage.sql, RETENTION, now, koreanDay(new Date(now)));
      due = nextRetentionAlarm(earliestExpiry(this.ctx.storage.sql, RETENTION, now), now);
      this.setRetentionDue(due);
    }
    const next = earlierAlarm(nextAlarm, due);
    if (next !== null) await this.ctx.storage.setAlarm(next);
    if (expired.length > 0) {
      this.refreshCatVisits(before);
      await this.syncPresence(now);
    }
  }

  private retentionDue(): number | null {
    return this.ctx.storage.sql.exec<{ due: number }>("SELECT due FROM retention").toArray()[0]?.due ?? null;
  }

  private setRetentionDue(due: number | null): void {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM retention");
    if (due !== null) sql.exec("INSERT INTO retention (due) VALUES (?)", due);
  }

  /** 보관 기간이 있는 데이터를 쓴 뒤 불러요. 정리 예정이 없을 때만 새로 맞춰요. */
  private async keepTidy(): Promise<void> {
    if (this.retentionDue() !== null) return;
    const now = Date.now();
    const due = nextRetentionAlarm(earliestExpiry(this.ctx.storage.sql, RETENTION, now), now);
    if (due === null) return;
    this.setRetentionDue(due);
    const wanted = alarmToSet(await this.ctx.storage.getAlarm(), due);
    if (wanted !== null) await this.ctx.storage.setAlarm(wanted);
  }

  /**
   * 운영자 작업을 지금 이 병실에 있는 사람에게 바로 반영해요. directory만 불러요.
   * 반영한 사람 수를 돌려줘요. 없으면 0이고, 다음 입장 때 directory의 기록으로 반영돼요.
   */
  async moderate(change: Moderation): Promise<number> {
    const matches = (key: string | undefined, ip: string | undefined): boolean =>
      change.kind === "block" && change.ip !== undefined ? ip === change.ip : key !== undefined && key === change.key;
    const before = this.lastVisits();
    let affected = 0;
    let left = false;
    for (const { ws, record } of this.joined()) {
      if (!matches(record.key, record.ip)) continue;
      affected++;
      const attachment = ws.deserializeAttachment() as Attachment;
      if (change.kind === "block") {
        this.send(ws, { v: PROTOCOL_VERSION, type: "entry-denied", reason: "blocked" });
        ws.serializeAttachment({ joined: false, ward: attachment.ward, instance: attachment.instance } satisfies Attachment);
        try {
          ws.close(DENIED_CODE, "blocked");
        } catch {
          // 이미 닫혔으면 그대로예요.
        }
        this.broadcast({ kind: "leave", id: record.id });
        if (record.key) await this.leftWard(record.key, record);
        left = true;
        continue;
      }
      const next = this.moderated(record, change);
      this.save(ws, attachment, next);
      if (change.kind === "reset") this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-reset", nickname: next.nickname });
      this.broadcast({ kind: "update", guest: toPublic(next) }, ws);
    }
    for (const guest of this.awayGuests()) {
      if (!matches(guest.key, guest.record.ip)) continue;
      affected++;
      if (change.kind === "block") {
        this.ctx.storage.sql.exec("DELETE FROM away WHERE key = ?", guest.key);
        this.broadcast({ kind: "leave", id: guest.record.id });
        await this.leftWard(guest.key, guest.record);
        left = true;
        continue;
      }
      const next = this.moderated(guest.record, change);
      this.ctx.storage.sql.exec("UPDATE away SET record = ? WHERE key = ?", JSON.stringify(next), guest.key);
      this.broadcast({ kind: "update", guest: toPublic(next) });
    }
    if (left) {
      this.refreshCatVisits(before);
      await this.syncPresence(Date.now());
    }
    return affected;
  }

  private moderated(record: GuestRecord, change: Exclude<Moderation, { kind: "block" }>): GuestRecord {
    if (change.kind === "unhide") return { ...record, hidden: false };
    return {
      ...record,
      hidden: false,
      bannedNickname: change.banned,
      nickname: autoNickname(animalLabel(record.animal), Math.random()),
    };
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
    ws.serializeAttachment({
      joined: true,
      ward: attachment.ward,
      instance: attachment.instance,
      ip: attachment.ip ?? null,
      record,
    } satisfies Attachment);
  }

  /** 이 병동의 번호예요. 연결이 처음 들어올 때 적어 둔 값이에요. */
  private place(): { ward: number; instance: number } {
    return this.ctx.storage.sql.exec<{ ward: number; instance: number }>("SELECT ward, instance FROM place").toArray()[0] ?? {
      ward: 1,
      instance: 1,
    };
  }

  /** 방명록 링크의 주인이 이 병동에 있으면 그 기록이에요. 잠시 끊긴 주인도 자리를 지키고 있어요. */
  private ownerHere(owner: string): { record: GuestRecord; ws: WebSocket | null } | null {
    const joined = this.joined().find((entry) => entry.record.key === owner);
    if (joined) return { record: joined.record, ws: joined.ws };
    const away = this.awayGuests().find((guest) => guest.key === owner);
    return away ? { record: away.record, ws: null } : null;
  }

  /** 유예가 끝나 정말 나간 사람이에요. 문병객이면 자리를 돌려주고, 링크 주인이면 마지막 위치를 알려요. */
  private async leftWard(key: string, record: GuestRecord): Promise<void> {
    const departure = departureOf(record, Date.now());
    if (departure) {
      this.ctx.storage.sql.exec(
        "INSERT INTO departures (stay_ms, blessings) VALUES (?, ?)",
        departure.stayMs,
        departure.blessings,
      );
    }
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

  private async disconnect(ws: WebSocket, code = 1000, reason = "bye"): Promise<void> {
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
      ws.close(code, reason);
    } catch {
      // 이미 닫혔으면 그대로예요.
    }
    if (!attachment?.joined) return;
    if (attachment.record.discharge) {
      // 퇴원한 사람은 자리를 맡아 두지 않고 바로 나가요.
      const before = this.lastVisits();
      this.broadcast({ kind: "leave", id: attachment.record.id });
      if (attachment.record.key) await this.leftWard(attachment.record.key, attachment.record);
      this.refreshCatVisits(before);
      await this.syncPresence(Date.now());
      return;
    }
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
    // 맡아 둔 자리도 인원에 넣어서 보통은 숫자가 그대로예요. 오래된 보고를 새로 고칠 때만 알려요.
    await this.syncPresence(now);
  }

  /**
   * 들고 날 때 불러요. 이 병실의 지금 인원(잠시 끊긴 사람 포함)을 directory에 알려요.
   * 지난번에 알린 값과 같으면 directory를 깨우지 않아요. 주기적으로 부르지 않아요.
   */
  private async syncPresence(nowMs: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    const last = sql.exec<{ patients: number; visitors: number; at: number }>("SELECT patients, visitors, at FROM presence_sent").toArray()[0] ?? null;
    const current = headcount(this.everyone());
    const departures = sql
      .exec<{ id: number; stay_ms: number; blessings: number }>(
        "SELECT id, stay_ms, blessings FROM departures ORDER BY id LIMIT ?",
        MAX_DEPARTURES_PER_REPORT,
      )
      .toArray();
    if (!shouldReport(last, current, nowMs) && departures.length === 0) return;
    const { ward, instance } = this.place();
    try {
      await this.directory().reportPresence(
        `ward-${ward}-${instance}`,
        current,
        nowMs,
        departures.map((row) => ({ stayMs: row.stay_ms, blessings: row.blessings })),
      );
    } catch {
      // 알리지 못해도 병실은 그대로 돌아가요. 다음 이벤트 때 현재값으로 다시 맞춰요. 퇴장 숫자도 남겨 둬요.
      return;
    }
    const sent = departures.at(-1);
    if (sent) sql.exec("DELETE FROM departures WHERE id <= ?", sent.id);
    sql.exec("DELETE FROM presence_sent");
    sql.exec("INSERT INTO presence_sent (patients, visitors, at) VALUES (?, ?, ?)", current.patients, current.visitors, nowMs);
  }

  private async hello(
    ws: WebSocket,
    attachment: Attachment,
    hello: Extract<ClientMessage, { type: "hello" }>,
  ): Promise<void> {
    if (attachment.joined) {
      // 퇴원하는 중에는 옷과 모습을 바꾸지 않아요.
      if (attachment.record.discharge) return;
      // 이미 들어와 있으면 모습만 바꿔요. 운영자가 되돌린 닉네임으로는 다시 바꾸지 못해요.
      const before = this.lastVisits();
      const fixed = enforceBannedNickname(hello.nickname, attachment.record.bannedNickname, hello.animal, Math.random());
      const result = updateProfile(attachment.record, { ...hello, nickname: fixed.nickname });
      if (result.kind === "rejected") {
        this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-rejected", problem: result.problem });
        return;
      }
      this.save(ws, attachment, result.record);
      if (fixed.reset) this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-reset", nickname: fixed.nickname });
      this.broadcast({ kind: "update", guest: toPublic(result.record) }, ws);
      if (result.record.bed !== attachment.record.bed) this.refreshCatVisits(before);
      return;
    }

    const now = Date.now();
    // 서명이 맞는 토큰만 믿어요. 없거나 틀리면 새 게스트로 보고 새 토큰을 줘요.
    const secret = requireSecret(this.env.TOKEN_SECRET, "TOKEN_SECRET");
    const ip = attachment.ip ?? null;
    let guestId = await verifyGuest(secret, hello.token);
    const directory = this.directory();
    if (guestId === null) {
      if (!(await directory.allowNewGuest(ip ?? NO_IP, now))) {
        this.deny(ws, "limited");
        return;
      }
      const issued = await issueGuest(secret);
      guestId = issued.guestId;
      this.send(ws, { v: PROTOCOL_VERSION, type: "guest-token", token: issued.token });
    }
    const key = await hashGuest(guestId);
    const standing = await directory.standing(key, ip);
    if (standing.blocked) {
      this.deny(ws, "blocked");
      return;
    }
    const fixed = enforceBannedNickname(hello.nickname, standing.bannedNickname, hello.animal, Math.random());
    const verified: VerifiedHello = { ...hello, guestId, nickname: fixed.nickname };
    const away = this.awayGuests().filter((guest) => guest.until > now);
    const returning = away.find((guest) => guest.key === key) ?? null;
    const others = this.joined(ws);
    // 끊긴 줄 아직 모르는 예전 연결이 남아 있어도 같은 사람이면 그 자리를 이어받아요.
    const stillOpen = others.find((other) => other.record.guestId === guestId)?.record ?? null;
    // 퇴원하던 연결이 남아 있으면 이어받지 않고 새로 들어와요.
    const previous = (returning?.record ?? stillOpen)?.discharge ? null : (returning?.record ?? stillOpen);

    // 방명록 링크로 왔으면 directory에서 확인해요. 30초 안에 돌아온 문병객은 이미 받은 역할을 그대로 써요.
    let visit: { role: VisitRole; spot: { x: number; z: number } } | null = null;
    if (hello.visitToken && !previous?.visit) {
      // 닉네임이 맞지 않으면 링크를 세지 않고 먼저 돌려보내요.
      const nickname = checkNickname(verified.nickname);
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
      verified,
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
      // 보관 기간 정리가 남아 있으면 그때로 맞춰 둬요.
      if (nextAlarmAt(away.filter((guest) => guest !== returning)) === null) {
        const due = this.retentionDue();
        if (due === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(due);
      }
    }

    // 새로 들어오면 directory에서 새 평안 주소를 받고, 없는 동안 도착한 평안을 꺼내요.
    // 30초 안에 돌아온 사람은 쓰던 주소를 그대로 써서 directory에 묻지 않아요.
    // 링크 주인이면 이번 주소와 병동 위치를 directory에 함께 적어요. 문병객은 자기 링크의 위치를 바꾸지 않아요.
    // 새로 들어온 환자에게는 이 브라우저가 기억하는 지난번 침대를 먼저 돌려줘요. 비어 있을 때만이에요.
    const seated =
      admission.restored || admission.record.visit
        ? admission.record
        : seatOnEntry(
            this.everyone(ws).filter((guest) => guest.id !== admission.replaces),
            admission.record,
            hello.seat,
          );
    let record: GuestRecord = {
      ...seated,
      // 30초 안에 돌아온 사람은 처음 들어온 시각을 그대로 써요.
      joinedAt: admission.record.joinedAt ?? now,
      key,
      hidden: standing.hidden,
      ...(standing.bannedNickname ? { bannedNickname: standing.bannedNickname } : {}),
      ...(ip ? { ip } : {}),
    };
    let inbox: SendableCard[] = [];
    let welcomeBack = false;
    /** 30초 안에 다시 이어 directory를 부르지 않았으면 모르니 null이에요. 화면은 알던 값을 그대로 써요. */
    let fiveLeafUsed: boolean | null = null;
    let tree: { active: boolean; count: number } | null = null;
    if (!admission.restored || !record.address) {
      const place = record.visit
        ? null
        : { ward: attachment.ward, instance: attachment.instance, bed: record.bed, nickname: publicNickname(record), animal: record.animal };
      const entered = await directory.enter(key, now, place);
      record = { ...record, address: entered.address, linked: entered.linked, visitDays: entered.visitDays };
      inbox = entered.inbox.filter(isCard);
      welcomeBack = entered.welcomeBack;
      fiveLeafUsed = entered.fiveLeafUsed;
      // 문병객에게는 사과나무를 그리지 않아요(자기 나무도 병실에서는 문병 중이라 감춰요).
      tree = record.visit ? null : entered.tree;
    } else if (!record.visit) {
      // 30초 안에 다시 이은 주인이에요. 화면을 새로 열었을 수 있어서 나무만 다시 알려 줘요.
      tree = await directory.treeOf(key);
    }
    const role = record.visit ?? null;
    const owner = role ? this.ownerHere(role.owner) : null;
    this.save(ws, attachment, record);
    this.tidy(new Date(now));
    if (fixed.reset) this.send(ws, { v: PROTOCOL_VERSION, type: "nickname-reset", nickname: record.nickname });
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
      greet: !admission.restored && shouldGreet(record.visitDays ?? 0),
      welcomeBack,
      fiveLeafUsed,
      morningRooms: this.morningRooms(now),
      planters: this.planterTotals(),
    });
    // 내 침대 옆 작은 사과나무예요. 이 연결에만 보내요. 다른 사람에게 가는 snapshot·event에는 사과가 없어요.
    if (tree) this.send(ws, { v: PROTOCOL_VERSION, type: "my-tree", active: tree.active, count: tree.count });
    if (admission.restored) {
      // 다른 사람에게는 자리를 비운 적이 없던 것처럼 보여요. 모습이 바뀌었을 때만 알려요.
      this.broadcast({ kind: "update", guest: toPublic(record) }, ws);
    } else {
      this.broadcast({ kind: "join", guest: toPublic(record) }, ws);
    }
    this.refreshCatVisits(before);
    await this.syncPresence(now);
    this.countVisitor(key, now);
    // 지난번 침대를 다시 받았으면 그 침대에 남겨져 있던 평안을 전해요.
    if (!admission.restored && record.bed !== null) await this.deliverLeft(ws, record.bed, record, now);
    await this.openWindowIfMorning(roomAt(record.x, record.z)?.index ?? null, now);
    await this.keepTidy();
    // 새로 온 문병객이면 주인 화면에만 알려요.
    if (role && !admission.restored && owner?.ws) {
      this.send(owner.ws, { v: PROTOCOL_VERSION, type: "visitor-arrived", id: record.id, nickname: publicNickname(record) });
    }
  }

  /** 들어올 수 없다고 알리고 연결을 닫아요. 화면은 다시 잇지 않아요. 이유는 더 자세히 알리지 않아요. */
  private deny(ws: WebSocket, reason: "blocked" | "limited"): void {
    this.send(ws, { v: PROTOCOL_VERSION, type: "entry-denied", reason });
    try {
      ws.close(DENIED_CODE, reason);
    } catch {
      // 이미 닫혔으면 그대로예요.
    }
  }

  private async act(ws: WebSocket, attachment: Extract<Attachment, { joined: true }>, message: ClientMessage): Promise<void> {
    const record = attachment.record;
    const nowMs = Date.now();
    const deny = (action: DeniedAction, reason: DeniedReason, item?: number): void => {
      this.send(ws, { v: PROTOCOL_VERSION, type: "action-denied", action, reason, ...(item === undefined ? {} : { item }) });
    };
    const save = (next: GuestRecord): void => this.save(ws, attachment, next);
    // 문병객은 걷기, 평안, 목례와 한마디, 선물, 안아 주기만 할 수 있어요. 나머지는 말없이 무시해요.
    if (record.visit && !visitorMay(message.type)) return;
    // 퇴원하는 사람은 문 쪽으로 걸어 나가기만 해요.
    if (record.discharge && message.type !== "walk-to") return;

    switch (message.type) {
      case "walk-to": {
        const spot = clampToWalkable(message.x, message.z);
        if (spot.x !== message.x || spot.z !== message.z) {
          this.send(ws, { v: PROTOCOL_VERSION, type: "position-corrected", x: spot.x, z: spot.z });
        }
        // 걸어가면 누워 있던 침대에서 내려와요. 침대 배정은 그대로예요.
        const hadBed = record.lyingSince !== null;
        const roomChanged = roomAt(record.x, record.z)?.index !== roomAt(spot.x, spot.z)?.index;
        // 고양이 방문은 병실을 옮기거나 일어날 때만 따지니, 그때만 저장소를 읽어요.
        const before = hadBed || roomChanged ? this.lastVisits() : [];
        save({ ...record, x: spot.x, z: spot.z, lyingSince: null });
        if (hadBed) this.broadcast({ kind: "get-up", id: record.id }, ws);
        this.broadcast({ kind: "walk", id: record.id, x: spot.x, z: spot.z }, ws);
        // 병실을 옮기거나 침대에서 일어났을 때만 고양이 방문을 다시 따져요.
        if (hadBed || roomChanged) this.refreshCatVisits(before);
        if (roomChanged) await this.openWindowIfMorning(roomAt(spot.x, spot.z)?.index ?? null, nowMs);
        return;
      }
      case "claim-bed": {
        // 먼저 처리된 사람이 가져가요. 잠시 끊긴 사람의 침대도 그 사람 것이에요.
        const result = claimBed(this.everyone(ws), record, message.bedId);
        if (!result.granted) {
          this.send(ws, { v: PROTOCOL_VERSION, type: "bed-unavailable", bedId: message.bedId });
          return;
        }
        const changed = result.record.bed !== record.bed;
        const wasLying = record.lyingSince !== null;
        const before = changed && wasLying ? this.lastVisits() : null;
        save(result.record);
        this.send(ws, { v: PROTOCOL_VERSION, type: "bed-granted", bedId: message.bedId });
        if (!changed) return;
        // 옮기면 원래 침대에서 먼저 내려와요. 다른 사람 화면의 이름표는 bed-claimed를 따라요.
        if (wasLying) this.broadcast({ kind: "get-up", id: record.id }, ws);
        this.broadcast({ kind: "bed-claimed", id: record.id, bedId: message.bedId }, ws);
        if (before) this.refreshCatVisits(before);
        // 링크 주인이면 문병객이 찾아올 침대를 알려요.
        if (record.linked && record.key) {
          await this.directory().reportLocation(record.key, { ...this.place(), bed: message.bedId });
        }
        // 그 침대에 남겨져 있던 평안을 새 주인에게 전하고 바로 지워요.
        await this.deliverLeft(ws, message.bedId, record, nowMs);
        return;
      }
      case "release-bed": {
        if (record.bed === null) return;
        const wasLying = record.lyingSince !== null;
        const before = wasLying ? this.lastVisits() : null;
        save(releaseBed(record).record);
        if (wasLying) this.broadcast({ kind: "get-up", id: record.id }, ws);
        this.broadcast({ kind: "bed-released", id: record.id }, ws);
        if (before) this.refreshCatVisits(before);
        return;
      }
      case "lie-down": {
        // 내 침대에만 누워요. 배정은 claim-bed로 먼저 받아요.
        const result = lieDown(record, message.bedId, nowMs);
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
        await this.openWindowIfMorning(BEDS[message.bedId].roomIndex, nowMs);
        return;
      }
      case "get-up": {
        // 침대에서 내려오기만 해요. 침대는 계속 내 것이에요.
        const next = standUp(record);
        if (!next) return;
        const before = this.lastVisits();
        save(next);
        this.broadcast({ kind: "get-up", id: record.id }, ws);
        this.refreshCatVisits(before);
        return;
      }
      case "bow": {
        if (!actionReady(record, "bow", nowMs)) return deny("bow", "too-fast");
        // "좋은 아침이에요"는 한국 시간 아침에만 받아요.
        if (!phraseAllowed(message.phrase, nowMs)) return deny("bow", "not-morning");
        save({ ...record, lastAction: { ...record.lastAction, bow: nowMs } });
        this.broadcast({ kind: "bow", id: record.id, phrase: message.phrase }, ws);
        this.countBlessing(nowMs);
        return;
      }
      case "bless": {
        if (!actionReady(record, "bless", nowMs)) return deny("bless", "too-fast");
        const target = resolveTarget(this.everyone(), message);
        if (!target) return deny("bless", "no-target");
        const peaceRoom = this.roomOfTarget(target, record);
        if (record.visit && this.toOwnerInbox(record.visit, target.bedId)) {
          // 주인이 자리에 없으면 주인 침대로 보낸 평안은 주인에게 전해요. 빈 침대에는 남기지 않아요.
          const result = await this.leaveForVisitedOwner(record, "bless", null, nowMs);
          if (result !== "saved") return deny("bless", result === "once-a-day" ? "once-a-day" : "no-target");
          save({ ...record, lastAction: { ...record.lastAction, bless: nowMs }, blessings: (record.blessings ?? 0) + 1 });
          this.broadcast({ kind: "bless", id: record.id, ...target }, ws);
          this.send(ws, { v: PROTOCOL_VERSION, type: "left-saved" });
          this.countBlessing(nowMs);
          this.addPeaceTo(peaceRoom);
          return;
        }
        save({ ...record, lastAction: { ...record.lastAction, bless: nowMs }, blessings: (record.blessings ?? 0) + 1 });
        this.broadcast({ kind: "bless", id: record.id, ...target }, ws);
        // 빈 침대면 다음에 누울 사람을 위해 남겨 둬요.
        if (target.bedId !== null && target.targetId === null && this.bedIsEmpty(target.bedId)) {
          await this.leaveOnBed(target.bedId, record, "bless", null, nowMs);
        }
        // 퇴원하는 사람에게 보낸 평안은 배웅이에요.
        if (target.targetId !== null) await this.farewell(target.targetId, record, nowMs);
        this.countBlessing(nowMs);
        this.addPeaceTo(peaceRoom);
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
        await this.keepTidy();
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
          { nickname: publicNickname(record), animal: record.animal, kind: message.kind, item, at: nowMs },
          nowMs,
          day,
        );
        save({ ...record, lastAction: { ...record.lastAction, [action]: nowMs } });
        if (result === "saved") {
          this.send(ws, { v: PROTOCOL_VERSION, type: "left-saved" });
          this.countBlessing(nowMs);
          // 자리에 없는 분께 남긴 평안은 보낸 사람이 있는 병실의 화분에 모여요.
          if (message.kind === "bless") this.addPeaceTo(roomAt(record.x, record.z)?.index ?? null);
        }
        else deny(action, result === "once-a-day" ? "once-a-day" : "no-target");
        return;
      }
      case "guestbook": {
        // 내 방명록이에요. 답은 이 연결(주인)에게만 보내요. 문병객은 visitorMay에서 이미 걸러졌어요.
        if (!actionReady(record, "link", nowMs)) return deny("guestbook", "too-fast");
        const key = record.key ?? (await hashGuest(record.guestId));
        const directory = this.directory();
        let token: string | null = null;
        let linked = record.linked ?? false;
        if (message.action === "create") {
          // 문병객이 주인 침대 곁으로 오므로 침대에 누워 있을 때만 만들 수 있어요.
          if (record.bed === null) return deny("guestbook", "no-bed");
          token = await directory.createGuestbookLink(
            key,
            { nickname: publicNickname(record), animal: record.animal, address: record.address },
            { ward: attachment.ward, instance: attachment.instance, bed: record.bed },
            nowMs,
          );
          linked = true;
        } else if (message.action === "off") {
          await directory.disableGuestbookLink(key);
          linked = false;
        }
        const status = await directory.guestbookStatus(key);
        linked = linked && status.active;
        save({ ...record, key, linked, lastAction: { ...record.lastAction, link: nowMs } });
        this.sendGuestbook(ws, token, status);
        return;
      }
      case "hide-apple": {
        // 자기 나무의 사과만 지울 수 있어요. 다른 사람의 사과 번호를 보내도 directory가 owner로 걸러요.
        if (!actionReady(record, "link", nowMs)) return deny("guestbook", "too-fast");
        const key = record.key ?? (await hashGuest(record.guestId));
        save({ ...record, key, lastAction: { ...record.lastAction, link: nowMs } });
        this.sendGuestbook(ws, null, await this.directory().hideApple(key, message.appleId));
        return;
      }
      case "sleep": {
        if (Boolean(record.sleeping) === message.sleeping) return;
        const next = { ...record, sleeping: message.sleeping };
        save(next);
        // 안아 주기를 받을 수 있는지가 바뀔 때만 다른 사람에게 알려요.
        if (hugAvailable(next) !== hugAvailable(record)) this.broadcast({ kind: "update", guest: toPublic(next) }, ws);
        return;
      }
      case "hug-request": {
        if (!actionReady(record, "hug", nowMs)) return deny("hug", "too-fast");
        save({ ...record, lastAction: { ...record.lastAction, hug: nowMs } });
        const sql = this.ctx.storage.sql;
        sql.exec("DELETE FROM hug_sent WHERE at <= ?", nowMs - HUG_REPEAT_MS);
        sql.exec("DELETE FROM hug_pending WHERE at <= ?", nowMs - HUG_ANSWER_MS * 2);
        const sender = record.key ?? (await hashGuest(record.guestId));
        const target = this.joined(ws).find((entry) => entry.record.id === message.targetId) ?? null;
        const last = target?.record.key
          ? (sql
              .exec<{ at: number }>("SELECT at FROM hug_sent WHERE sender = ? AND target = ?", sender, target.record.key)
              .toArray()[0]?.at ?? null)
          : null;
        const check = checkHugRequest({ ...record, key: sender }, target?.record ?? null, last, nowMs);
        if (!check.ok) return deny("hug", check.reason);
        const id = randomId(12);
        sql.exec(
          "INSERT INTO hug_pending (id, from_id, from_key, to_id, at) VALUES (?, ?, ?, ?, ?)",
          id,
          record.id,
          sender,
          target!.record.id,
          nowMs,
        );
        sql.exec(
          "INSERT OR REPLACE INTO hug_sent (sender, target, at) VALUES (?, ?, ?)",
          sender,
          target!.record.key as string,
          nowMs,
        );
        this.send(target!.ws, { v: PROTOCOL_VERSION, type: "hug-offer", requestId: id, fromId: record.id });
        await this.keepTidy();
        return;
      }
      case "hug-answer": {
        const sql = this.ctx.storage.sql;
        const row = sql
          .exec<{ id: string; from_id: string; from_key: string; to_id: string; at: number }>(
            "SELECT id, from_id, from_key, to_id, at FROM hug_pending WHERE id = ?",
            message.requestId,
          )
          .toArray()[0];
        const pending: PendingHug | null = row
          ? { id: row.id, fromId: row.from_id, fromKey: row.from_key, toId: row.to_id, at: row.at }
          : null;
        const answer = checkHugAnswer(pending, record.id, nowMs);
        // 남의 요청에 답하려 하면 지우지 않고 무시해요.
        if (answer === "unknown") return;
        sql.exec("DELETE FROM hug_pending WHERE id = ?", message.requestId);
        // 10초가 지났으면 보낸 사람에게 아무것도 알리지 않아요.
        if (answer === "expired" || !pending) return;
        const from = this.joined().find((entry) => entry.record.id === pending.fromId && entry.record.key === pending.fromKey);
        if (!from) return;
        if (!message.accept) {
          this.send(from.ws, { v: PROTOCOL_VERSION, type: "hug-declined" });
          return;
        }
        if (!hugStillPossible(from.record, record)) return;
        // 안아 주는 사람은 상대 곁으로 다가가요. 누워 있으면 침대 옆자리예요.
        // 안아 주는 사람이 누워 있었으면 일어나서 가요.
        // 침대 배정은 그대로 두고 자세만 바꿔요.
        const lyingBed = isLying(record) ? record.bed : null;
        const spot = hugSpot(from.record, { x: record.x, z: record.z, bed: lyingBed });
        const before = from.record.lyingSince !== null ? this.lastVisits() : null;
        this.save(from.ws, from.ws.deserializeAttachment() as Attachment, {
          ...from.record,
          x: spot.x,
          z: spot.z,
          lyingSince: null,
        });
        this.broadcast({ kind: "hug", a: from.record.id, b: record.id, bed: lyingBed });
        if (before) this.refreshCatVisits(before);
        return;
      }
      case "discharge": {
        if (canDischarge(record) !== "ok") return deny("discharge", "no-bed");
        const before = this.lastVisits();
        // 지금 서 있는 병실이 먼저이고, 병실 밖이면 내 침대가 있는 병실이에요.
        const room = roomAt(record.x, record.z)?.index ?? (record.bed !== null ? BEDS[record.bed].roomIndex : null);
        const next = startDischarge({ ...record, lastAction: { ...record.lastAction, discharge: nowMs } }, nowMs, message.closeLink);
        save(next);
        const key = record.key ?? (await hashGuest(record.guestId));
        const directory = this.directory();
        if (message.closeLink) await directory.disableGuestbookLink(key);
        await directory.markDischarged(key, nowMs);
        this.send(ws, { v: PROTOCOL_VERSION, type: "discharge-started", until: nowMs + FAREWELL_MS });
        // 퇴원하면 침대를 바로 반납해요. 침대가 비고 옷이 바뀐 것은 모두에게, 퇴원 안내는 같은 병실 사람에게만 보내요.
        this.broadcast({ kind: "update", guest: toPublic(next) }, ws);
        if (room !== null) {
          const text = JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "event",
            event: { kind: "discharge", id: record.id },
          } satisfies ServerMessage);
          for (const entry of this.joined(ws)) {
            if (roomAt(entry.record.x, entry.record.z)?.index !== room) continue;
            try {
              entry.ws.send(text);
            } catch {
              // 닫히는 중인 연결은 건너뛰어요.
            }
          }
        }
        this.refreshCatVisits(before);
        return;
      }
      case "inbox-ack": {
        // 화면이 받은 데까지만 지워요. 받지 못했으면 다음 입장 때 다시 전해요.
        const key = record.key ?? (await hashGuest(record.guestId));
        await this.directory().ackInbox(key, message.upTo);
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
        await this.keepTidy();
        return;
      }
    }
  }

  /** 내 방명록을 주인 한 사람의 연결에만 보내요. broadcast로는 보내지 않아요. */
  private sendGuestbook(ws: WebSocket, token: string | null, status: GuestbookStatus): void {
    this.send(ws, { v: PROTOCOL_VERSION, type: "guestbook", token, active: status.active, count: status.count, apples: status.apples });
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
      { nickname: publicNickname(record), animal: record.animal, kind, item, at: nowMs },
      nowMs,
      koreanDay(new Date(nowMs)),
    );
  }

  /** 평안이 모인 병실이에요. 침대면 그 침대의 병실, 사람이면 그 사람이 있는 병실, 아니면 보낸 사람의 병실이에요. */
  private roomOfTarget(target: { bedId: number | null; targetId: string | null }, sender: GuestRecord): number | null {
    if (target.bedId !== null) return BEDS[target.bedId]?.roomIndex ?? null;
    const person = target.targetId ? this.everyone().find((guest) => guest.id === target.targetId) : null;
    const at = person ?? sender;
    return roomAt(at.x, at.z)?.index ?? null;
  }

  /** 병실 화분에 평안 하나를 더하고 모두에게 알려요. 줄지 않아요. */
  private addPeaceTo(room: number | null): void {
    if (room === null || room < 0 || room >= ROOMS.length) return;
    const sql = this.ctx.storage.sql;
    const before = sql.exec<{ total: number }>("SELECT total FROM planter WHERE room = ?", room).toArray()[0]?.total ?? 0;
    const { total } = addPeace(before);
    sql.exec("INSERT OR REPLACE INTO planter (room, total) VALUES (?, ?)", room, total);
    this.broadcast({ kind: "planter", room, total });
  }

  private planterTotals(): number[] {
    const totals = ROOMS.map(() => 0);
    for (const row of this.ctx.storage.sql.exec<{ room: number; total: number }>("SELECT room, total FROM planter")) {
      if (row.room >= 0 && row.room < totals.length) totals[row.room] = row.total;
    }
    return totals;
  }

  /** 아침에 그날 처음 누가 들어온 병실이면 창문을 열어요. 병실마다 하루 한 번이에요. */
  private async openWindowIfMorning(room: number | null, nowMs: number): Promise<void> {
    if (room === null || !isMorningWindow(nowMs)) return;
    const sql = this.ctx.storage.sql;
    const day = koreanDay(new Date(nowMs));
    const opened = sql.exec("SELECT 1 AS one FROM morning_open WHERE room = ? AND day = ?", room, day).toArray().length > 0;
    if (!shouldOpenWindow(nowMs, opened)) return;
    sql.exec("DELETE FROM morning_open WHERE day != ?", day);
    sql.exec("INSERT INTO morning_open (room, day) VALUES (?, ?)", room, day);
    this.broadcast({ kind: "window-open", room });
    await this.keepTidy();
  }

  /** 오늘 아침 창문이 열린 병실이에요. 아침이 지나면 비어요. */
  private morningRooms(nowMs: number): number[] {
    if (!isMorningWindow(nowMs)) return [];
    return this.ctx.storage.sql
      .exec<{ room: number }>("SELECT room FROM morning_open WHERE day = ?", koreanDay(new Date(nowMs)))
      .toArray()
      .map((row) => row.room)
      .filter((room) => room >= 0 && room < ROOMS.length);
  }

  /** 퇴원하는 사람에게 온 평안이면 배웅으로 세고, 그 사람에게만 지금까지의 수를 알려요. */
  private async farewell(targetId: string, sender: GuestRecord, nowMs: number): Promise<void> {
    const target = this.joined().find((entry) => entry.record.id === targetId);
    if (!target?.record.discharge) return;
    const fromKey = sender.key ?? (await hashGuest(sender.guestId));
    const result = countFarewell(target.record, fromKey, nowMs);
    if (!result.counted) return;
    this.save(target.ws, target.ws.deserializeAttachment() as Attachment, result.record);
    this.send(target.ws, { v: PROTOCOL_VERSION, type: "farewell-count", count: farewellCount(result.record) });
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

  /** 아무에게도 배정되지 않은 침대예요. 잠시 끊긴 사람의 침대도 그 사람 것이에요. */
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
      publicNickname(record),
      record.animal,
      kind,
      item,
      nowMs,
      sender,
    );
    await this.keepTidy();
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
    sql.exec("DELETE FROM morning_open WHERE day != ?", day);
  }
}

/** 안아 주기 요청 번호예요. 소문자와 숫자만 써요. */
function randomId(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}


const ANIMALS = new Set(["rabbit", "bear", "penguin", "otter", "deer"]);
type SendableCard = BlessingCard & { animal: "rabbit" | "bear" | "penguin" | "otter" | "deer" };

/** 저장소에서 읽은 카드가 화면에 보내도 되는 모양인지 확인해요. */
function isCard(card: BlessingCard): card is SendableCard {
  return ANIMALS.has(card.animal);
}
