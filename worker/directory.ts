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

export type LeaveResult = "saved" | "unknown" | "once-a-day";

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
  }

  /** 들어온 사람에게 새 평안 주소를 주고, 없는 동안 도착한 평안을 꺼내 줘요. 꺼낸 것은 지워요. */
  async enter(owner: string, nowMs: number): Promise<{ address: string; inbox: BlessingCard[] }> {
    this.tidy(nowMs);
    const address = encodeAddress(crypto.getRandomValues(new Uint8Array(16)));
    const sql = this.ctx.storage.sql;
    sql.exec(
      "INSERT INTO address_book (address_hash, owner, created) VALUES (?, ?, ?)",
      await hashAddress(address),
      owner,
      nowMs,
    );
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
    return { address, inbox };
  }

  /** 평안 주소의 주인에게 남겨요. 같은 사람에게는 하루 한 번이에요. */
  async leaveFor(sender: string, address: string, card: BlessingCard, nowMs: number, day: string): Promise<LeaveResult> {
    this.tidy(nowMs, day);
    const sql = this.ctx.storage.sql;
    const owner = sql
      .exec<{ owner: string }>("SELECT owner FROM address_book WHERE address_hash = ?", await hashAddress(address))
      .toArray()[0]?.owner;
    if (!owner || owner === sender) return "unknown";
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
