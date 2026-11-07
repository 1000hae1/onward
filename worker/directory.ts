import { DurableObject } from "cloudflare:workers";
import {
  addLatest,
  dailyKey,
  encodeAddress,
  fiveLeafAllowed,
  INBOX_PER_GUEST,
  KEEP_MS,
  toCard,
} from "../shared/left-blessings.ts";
import type { BlessingCard, StoredBlessing } from "../shared/left-blessings.ts";
import {
  checkVisit,
  findLink,
  HOUR_MS,
  replaceLink,
  turnOffLink,
  VISIT_SESSION_MS,
} from "../shared/visit-rules.ts";
import type { VisitLinkRow } from "../shared/visit-rules.ts";

export type LeaveResult = "saved" | "unknown" | "once-a-day";

/** 병실 서버가 알려 주는 주인의 위치예요. */
export interface OwnerPlace {
  ward: number;
  instance: number;
  bed: number | null;
}

export interface OwnerProfile {
  nickname: string;
  animal: string;
  address: string;
}

export interface VisitLinkStatus {
  active: boolean;
  visits: number;
}

export type VisitResolution =
  | { kind: "ok"; owner: string; ownerNickname: string; bed: number; session: string }
  | { kind: "closed" | "busy" | "self" };

export type VisitPreviewResult =
  | { open: true; ownerNickname: string; ownerAnimal: string; ward: number; instance: number }
  | { open: false };

interface LinkSqlRow {
  token_hash: string;
  owner: string;
  address_hash: string;
  nickname: string;
  animal: string;
  created: number;
  off: number;
  visits: number;
  ward: number;
  instance: number;
  bed: number;
  [key: string]: SqlStorageValue;
}

/**
 * 병동 전체가 함께 쓰는 Durable Object예요. 이름은 directory 하나뿐이에요.
 * 표는 기능별로 나눠 두어서, 나중에 문병 링크 표가 따로 붙어도 서로 섞이지 않아요.
 *
 * 받는 것은 모두 해시예요. guestId와 평안 주소 원문은 저장하지 않아요.
 * 주기적으로 도는 일은 없고, 오래된 기록은 요청이 올 때 함께 정리해요.
 */
export class Directory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // 평안 주소의 해시와 주인(guestId 해시)이에요. 입장할 때마다 새 주소를 하나씩 만들어요.
    sql.exec(`CREATE TABLE IF NOT EXISTS address_book (
      address_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL)`);
    // 자리에 없는 사람에게 남긴 평안이에요. 받는 사람마다 최근 10개, 7일까지예요.
    sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, nickname TEXT NOT NULL,
      animal TEXT NOT NULL, kind TEXT NOT NULL, item INTEGER, at INTEGER NOT NULL, sender TEXT NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS inbox_owner ON inbox (owner)");
    // 같은 사람에게 하루 한 번만 남기려고 오늘 남긴 짝을 적어 둬요.
    sql.exec(`CREATE TABLE IF NOT EXISTS inbox_daily (key TEXT PRIMARY KEY, day TEXT NOT NULL)`);
    // 하루 한 번만 놓을 수 있는 선물이에요. 지금은 오잎클로버예요.
    sql.exec(`CREATE TABLE IF NOT EXISTS gift_daily (
      guest TEXT NOT NULL, item INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (guest, item))`);
    // 문병 링크예요. 토큰 원본은 두지 않고 해시만 둬요. 한 사람당 하나라 owner가 겹치지 않아요.
    sql.exec(`CREATE TABLE IF NOT EXISTS visit_link (
      token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, address_hash TEXT NOT NULL,
      nickname TEXT NOT NULL, animal TEXT NOT NULL, created INTEGER NOT NULL,
      off INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0,
      ward INTEGER NOT NULL, instance INTEGER NOT NULL, bed INTEGER NOT NULL)`);
    // 링크마다 들어온 시각이에요. 1시간에 30번을 세려고 두고, 1시간이 지나면 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS visit_attempt (owner TEXT NOT NULL, at INTEGER NOT NULL)`);
    sql.exec("CREATE INDEX IF NOT EXISTS visit_attempt_owner ON visit_attempt (owner)");
    // 지금 들어와 있는 문병객이에요. 링크마다 3명까지예요. 병실 서버가 나갈 때 지워요.
    sql.exec(`CREATE TABLE IF NOT EXISTS visit_session (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, started INTEGER NOT NULL)`);
  }

  /**
   * 들어온 사람에게 새 평안 주소를 주고, 없는 동안 도착한 평안을 꺼내 줘요. 꺼낸 것은 지워요.
   * place가 있으면 켜진 문병 링크의 주소와 위치도 새로 적어요. linked는 켜진 링크가 있는지예요.
   */
  async enter(
    owner: string,
    nowMs: number,
    place: (OwnerPlace & { nickname: string; animal: string }) | null = null,
  ): Promise<{ address: string; inbox: BlessingCard[]; linked: boolean }> {
    this.tidy(nowMs);
    const address = encodeAddress(crypto.getRandomValues(new Uint8Array(16)));
    const sql = this.ctx.storage.sql;
    const addressHash = await hashAddress(address);
    sql.exec(
      "INSERT INTO address_book (address_hash, owner, created) VALUES (?, ?, ?)",
      addressHash,
      owner,
      nowMs,
    );
    let linked = false;
    if (place) {
      const cursor = sql.exec(
        `UPDATE visit_link SET address_hash = ?, nickname = ?, animal = ?, ward = ?, instance = ?, bed = COALESCE(?, bed)
         WHERE owner = ? AND off = 0`,
        addressHash,
        place.nickname,
        place.animal,
        place.ward,
        place.instance,
        place.bed,
        owner,
      );
      linked = cursor.rowsWritten > 0;
    }
    const rows = sql
      .exec<{ nickname: string; animal: string; kind: string; item: number | null; at: number; sender: string }>(
        "SELECT nickname, animal, kind, item, at, sender FROM inbox WHERE owner = ? ORDER BY at ASC",
        owner,
      )
      .toArray();
    if (rows.length > 0) sql.exec("DELETE FROM inbox WHERE owner = ?", owner);
    const inbox = rows.map((row) =>
      toCard({ ...row, kind: row.kind === "gift" ? "gift" : "bless" } satisfies StoredBlessing),
    );
    return { address, inbox, linked };
  }

  /** 평안 주소의 주인에게 남겨요. 같은 사람에게는 하루 한 번이에요. */
  async leaveFor(sender: string, address: string, card: BlessingCard, nowMs: number, day: string): Promise<LeaveResult> {
    this.tidy(nowMs, day);
    const sql = this.ctx.storage.sql;
    const owner = sql
      .exec<{ owner: string }>("SELECT owner FROM address_book WHERE address_hash = ?", await hashAddress(address))
      .toArray()[0]?.owner;
    if (!owner) return "unknown";
    return this.deposit(sender, owner, card, nowMs, day);
  }

  /** 문병객이 자리에 없는 주인에게 남겨요. 주소 대신 주인의 해시로 바로 남기고, 규칙은 같아요. */
  async leaveForOwner(sender: string, owner: string, card: BlessingCard, nowMs: number, day: string): Promise<LeaveResult> {
    this.tidy(nowMs, day);
    return this.deposit(sender, owner, card, nowMs, day);
  }

  private deposit(sender: string, owner: string, card: BlessingCard, nowMs: number, day: string): LeaveResult {
    const sql = this.ctx.storage.sql;
    if (owner === sender) return "unknown";
    const key = dailyKey(sender, owner, day);
    if (sql.exec("SELECT 1 FROM inbox_daily WHERE key = ?", key).toArray().length > 0) return "once-a-day";

    const existing = sql
      .exec<{ id: number; at: number }>("SELECT id, at FROM inbox WHERE owner = ?", owner)
      .toArray();
    const kept = addLatest(existing, { id: -1, at: card.at }, INBOX_PER_GUEST, nowMs);
    // 10개를 넘거나 7일이 지난 것은 지워요.
    for (const row of existing) {
      if (!kept.some((entry) => entry.id === row.id)) sql.exec("DELETE FROM inbox WHERE id = ?", row.id);
    }
    sql.exec(
      "INSERT INTO inbox (owner, nickname, animal, kind, item, at, sender) VALUES (?, ?, ?, ?, ?, ?, ?)",
      owner,
      card.nickname,
      card.animal,
      card.kind,
      card.item,
      card.at,
      sender,
    );
    sql.exec("INSERT INTO inbox_daily (key, day) VALUES (?, ?)", key, day);
    return "saved";
  }

  /** 하루 한 번만 놓을 수 있는 선물을 오늘 처음 놓는지 보고, 처음이면 적어 둬요. */
  async useDailyGift(guest: string, item: number, day: string): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const last = sql
      .exec<{ day: string }>("SELECT day FROM gift_daily WHERE guest = ? AND item = ?", guest, item)
      .toArray()[0]?.day ?? null;
    if (!fiveLeafAllowed(last, day)) return false;
    sql.exec("INSERT OR REPLACE INTO gift_daily (guest, item, day) VALUES (?, ?, ?)", guest, item, day);
    return true;
  }

  /** 내 침대로 오는 문병 링크를 새로 만들어요. 예전 링크는 바로 열리지 않아요. 토큰 원본은 돌려주기만 해요. */
  async createVisitLink(owner: string, profile: OwnerProfile, place: OwnerPlace & { bed: number }, nowMs: number): Promise<string> {
    const token = encodeAddress(crypto.getRandomValues(new Uint8Array(16)));
    const sql = this.ctx.storage.sql;
    const rows = this.linksOf(owner);
    const next = replaceLink(rows, {
      tokenHash: await hashToken(token),
      owner,
      addressHash: await hashAddress(profile.address),
      nickname: profile.nickname,
      animal: profile.animal,
      created: nowMs,
      ward: place.ward,
      instance: place.instance,
      bed: place.bed,
    });
    sql.exec("DELETE FROM visit_link WHERE owner = ?", owner);
    sql.exec("DELETE FROM visit_attempt WHERE owner = ?", owner);
    sql.exec("DELETE FROM visit_session WHERE owner = ?", owner);
    for (const row of next.filter((entry) => entry.owner === owner)) this.writeLink(row);
    return token;
  }

  /** 링크를 꺼요. 꺼진 링크로는 아무도 들어오지 못해요. */
  async disableVisitLink(owner: string): Promise<VisitLinkStatus> {
    const next = turnOffLink(this.linksOf(owner), owner);
    for (const row of next) {
      this.ctx.storage.sql.exec("UPDATE visit_link SET off = ? WHERE token_hash = ?", row.off ? 1 : 0, row.tokenHash);
    }
    return this.visitLinkStatus(owner);
  }

  async visitLinkStatus(owner: string): Promise<VisitLinkStatus> {
    const link = this.linksOf(owner)[0];
    return link ? { active: !link.off, visits: link.visits } : { active: false, visits: 0 };
  }

  /** 링크가 있는 주인이 침대를 받거나 병동을 나갈 때 병실 서버가 알려 줘요. 주기적으로 묻지 않아요. */
  async reportLocation(owner: string, place: OwnerPlace): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE visit_link SET ward = ?, instance = ?, bed = COALESCE(?, bed) WHERE owner = ? AND off = 0",
      place.ward,
      place.instance,
      place.bed,
      owner,
    );
  }

  /** 입장 화면에 보여 줄 주인과 들어갈 병동이에요. 세지 않고 보기만 해요. */
  async previewVisit(token: string): Promise<VisitPreviewResult> {
    const link = await this.linkForToken(token);
    if (!link || link.off) return { open: false };
    return { open: true, ownerNickname: link.nickname, ownerAnimal: link.animal, ward: link.ward, instance: link.instance };
  }

  /** 링크로 들어오는 사람을 받을지 정해요. 받으면 문병 온 횟수를 하나 더하고 자리 번호를 줘요. */
  async resolveVisit(token: string, visitor: string, nowMs: number): Promise<VisitResolution> {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM visit_attempt WHERE at < ?", nowMs - HOUR_MS);
    sql.exec("DELETE FROM visit_session WHERE started < ?", nowMs - VISIT_SESSION_MS);
    const link = await this.linkForToken(token);
    const owner = link?.owner ?? "";
    const active = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM visit_session WHERE owner = ?", owner).one().n;
    const attempts = sql
      .exec<{ at: number }>("SELECT at FROM visit_attempt WHERE owner = ?", owner)
      .toArray()
      .map((row) => row.at);
    const check = checkVisit(link, visitor, active, attempts, nowMs);
    if (check.kind !== "ok") return { kind: check.kind };
    const session = crypto.randomUUID();
    sql.exec("INSERT INTO visit_attempt (owner, at) VALUES (?, ?)", owner, nowMs);
    sql.exec("INSERT INTO visit_session (id, owner, started) VALUES (?, ?, ?)", session, owner, nowMs);
    sql.exec("UPDATE visit_link SET visits = visits + 1 WHERE owner = ?", owner);
    return { kind: "ok", owner, ownerNickname: check.link.nickname, bed: check.link.bed, session };
  }

  /** 문병객이 나가면 자리를 돌려줘요. */
  async releaseVisit(session: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM visit_session WHERE id = ?", session);
  }

  private linksOf(owner: string): VisitLinkRow[] {
    return this.ctx.storage.sql
      .exec<LinkSqlRow>("SELECT * FROM visit_link WHERE owner = ?", owner)
      .toArray()
      .map(toLinkRow);
  }

  private async linkForToken(token: string): Promise<VisitLinkRow | null> {
    const tokenHash = await hashToken(token);
    const rows = this.ctx.storage.sql
      .exec<LinkSqlRow>("SELECT * FROM visit_link WHERE token_hash = ?", tokenHash)
      .toArray()
      .map(toLinkRow);
    return findLink(rows, tokenHash);
  }

  private writeLink(row: VisitLinkRow): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO visit_link (token_hash, owner, address_hash, nickname, animal, created, off, visits, ward, instance, bed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.tokenHash,
      row.owner,
      row.addressHash,
      row.nickname,
      row.animal,
      row.created,
      row.off ? 1 : 0,
      row.visits,
      row.ward,
      row.instance,
      row.bed,
    );
  }

  private tidy(nowMs: number, day?: string): void {
    const sql = this.ctx.storage.sql;
    const cutoff = nowMs - KEEP_MS;
    sql.exec("DELETE FROM address_book WHERE created < ?", cutoff);
    sql.exec("DELETE FROM inbox WHERE at < ?", cutoff);
    if (day) {
      sql.exec("DELETE FROM inbox_daily WHERE day != ?", day);
      sql.exec("DELETE FROM gift_daily WHERE day != ?", day);
    }
  }
}

async function hashAddress(address: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`onward-address:${address}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`onward-visit:${token}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toLinkRow(row: LinkSqlRow): VisitLinkRow {
  return {
    tokenHash: row.token_hash,
    owner: row.owner,
    addressHash: row.address_hash,
    nickname: row.nickname,
    animal: row.animal,
    created: row.created,
    off: row.off !== 0,
    visits: row.visits,
    ward: row.ward,
    instance: row.instance,
    bed: row.bed,
  };
}
