/**
 * 방명록(사과나무)의 판단이에요. 화면과 Worker가 함께 쓰는 순수 함수이고,
 * directory와 병실 서버는 저장과 전송만 하고 무엇을 허락하고 누구에게 무엇을 보일지는 여기서 정해요.
 *
 * 원칙: 서로 모르는 사람끼리는 글을 주고받지 않아요.
 * - 사과는 주인이 직접 링크를 보낸 사람만 달 수 있어요(토큰이 있어야 해요).
 * - 사과의 내용과 개수는 주인만 봐요. 링크로 온 사람은 자기가 남긴 사과의 내용과 나무의 사과 개수만 봐요.
 * - 병실 안의 다른 사람에게 가는 메시지에는 사과에 관한 것이 하나도 들어가지 않아요.
 */
import { ADDRESS_PATTERN, DAY_MS } from "./left-blessings.ts";
import { checkNickname, NICKNAME_MAX, NICKNAME_MIN, textProblem, tidyText } from "./nickname.ts";
import type { NicknameProblem } from "./nickname.ts";
import { linkOpen } from "./visit-rules.ts";
import type { VisitLinkRow } from "./visit-rules.ts";

export { readGuestbookPath, GUESTBOOK_BARE_PATH } from "./guestbook-path.ts";
import { APPLE_NOTE_MAX, APPLE_PHRASES, APPLE_SLOTS } from "./apple-limits.ts";
export { APPLE_NOTE_MAX, APPLE_PHRASES, APPLE_SLOTS };

/** 방명록 링크 토큰이에요. 128비트 무작위 값을 URL에 써도 되는 글자 22자로 적어요. 서버에는 해시만 있어요. */
export const GUESTBOOK_TOKEN_PATTERN = ADDRESS_PATTERN;
/** 사과를 단 브라우저를 알아보는 무작위 열쇠예요. 자기 사과만 다시 보려고 써요. 서버에는 해시만 있어요. */
export const WRITER_KEY_PATTERN = ADDRESS_PATTERN;
/** 같은 링크로 1시간에 달 수 있는 사과 수예요. */
export const APPLES_PER_HOUR = 10;
export const HOUR_MS = 3_600_000;
/** 사과는 1년 동안 둬요. 주인이 숨기면 바로 지워요. */
export const APPLE_KEEP_MS = 365 * DAY_MS;

/** directory의 apple 한 줄이에요. 사람은 해시로만 가리켜요. */
export interface StoredApple {
  id: number;
  /** 주인의 guestId 해시예요. */
  owner: string;
  name: string;
  phrase: number;
  note: string | null;
  at: number;
  /** 사과를 단 링크의 토큰 해시예요. 시간당 개수를 세요. */
  linkHash: string;
  /** 사과를 단 브라우저 열쇠의 해시예요. */
  writerHash: string;
  slot: number;
}

/** 화면에 보내는 사과예요. 해시는 담지 않아요. */
export interface AppleCard {
  id: number;
  slot: number;
  name: string;
  phrase: number;
  note: string | null;
  at: number;
}

export function toAppleCard(apple: StoredApple): AppleCard {
  return { id: apple.id, slot: apple.slot, name: apple.name, phrase: apple.phrase, note: apple.note, at: apple.at };
}

/** seq번째(0부터) 사과가 열리는 자리예요. 41번째 사과는 첫 사과 자리에 열려서 나무 모양이 흔들리지 않아요. */
export function slotFor(seq: number): number {
  return ((Math.floor(seq) % APPLE_SLOTS) + APPLE_SLOTS) % APPLE_SLOTS;
}

/** 나무에 보이는 사과예요. 최근 40개만이고, 오래된 것이 앞이에요. */
export function visibleApples<T extends { id: number }>(apples: readonly T[]): T[] {
  return [...apples].sort((a, b) => a.id - b.id).slice(-APPLE_SLOTS);
}

/** 주인이 보는 나무예요. 사과 개수와 보이는 사과의 내용이에요. */
export function ownerTree(apples: readonly StoredApple[]): { count: number; apples: AppleCard[] } {
  return { count: apples.length, apples: visibleApples(apples).map(toAppleCard) };
}

/**
 * 링크로 온 사람이 보는 나무예요. 사과 개수와, 자기가 남긴 사과의 내용만 있어요.
 * 다른 사람이 남긴 사과는 몇 개인지만 알 수 있고, 이름·날짜·글은 보내지 않아요.
 */
export function visitorTree(apples: readonly StoredApple[], writerHash: string | null): { count: number; mine: AppleCard[] } {
  const mine = writerHash === null ? [] : visibleApples(apples).filter((apple) => apple.writerHash === writerHash);
  return { count: apples.length, mine: mine.map(toAppleCard) };
}

/* ───────────── 사과 달기 ───────────── */

export type AppleField = "name" | "phrase" | "note";
export type AppleProblem = { field: "name"; problem: NicknameProblem } | { field: "note"; problem: NicknameProblem } | { field: "phrase" };

export interface AppleDraft {
  name: string;
  phrase: number;
  note?: string | null;
}

export type AppleCheck = { ok: true; value: { name: string; phrase: number; note: string | null } } | ({ ok: false } & AppleProblem);

/** 짧은 글을 살펴요. 비어 있으면 null이에요. 100자, 금칙어, 주소, 이메일, 숫자 연속을 거절해요. */
export function checkAppleNote(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; problem: NicknameProblem } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const value = tidyText(raw);
  if (value.length === 0) return { ok: true, value: null };
  if (Array.from(value).length > APPLE_NOTE_MAX) return { ok: false, problem: "long" };
  const problem = textProblem(value);
  return problem ? { ok: false, problem } : { ok: true, value };
}

/** 사과에 적는 이름, 한마디 번호, 짧은 글을 살펴요. 이름은 닉네임과 같은 규칙(2~10자)이에요. */
export function checkApple(draft: AppleDraft): AppleCheck {
  const name = checkNickname(draft.name);
  if (!name.ok) return { ok: false, field: "name", problem: name.problem };
  if (!Number.isInteger(draft.phrase) || draft.phrase < 0 || draft.phrase >= APPLE_PHRASES.length) {
    return { ok: false, field: "phrase" };
  }
  const note = checkAppleNote(draft.note);
  if (!note.ok) return { ok: false, field: "note", problem: note.problem };
  return { ok: true, value: { name: name.value, phrase: draft.phrase, note: note.value } };
}

export type ApplePost = { kind: "ok"; link: VisitLinkRow } | { kind: "closed" } | { kind: "limit" };

/**
 * 링크로 사과를 달 수 있는지예요. 없거나 꺼진 링크는 거절해요.
 * recent는 이 링크로 단 사과의 시각들이에요. 1시간에 10개까지예요.
 */
export function checkApplePost(link: VisitLinkRow | null, recent: readonly number[], nowMs: number): ApplePost {
  if (!linkOpen(link)) return { kind: "closed" };
  if (recent.filter((at) => nowMs - at < HOUR_MS).length >= APPLES_PER_HOUR) return { kind: "limit" };
  return { kind: "ok", link };
}

/* ───────────── 누구에게 보내는지 ───────────── */

/** 사과를 담는 서버 메시지예요. 주인 한 사람의 연결에만 보내요. */
export const OWNER_ONLY_MESSAGES: ReadonlySet<string> = new Set(["guestbook", "my-tree"]);

const APPLE_KEY = /apple|guestbook|tree/i;

/**
 * 메시지에 사과에 관한 것이 들어 있는지 살펴요. 다른 사람에게 가는 메시지(snapshot, event 등)는 이 값이 늘 false여야 해요.
 * 키 이름과 메시지 종류(type)를 끝까지 살펴요.
 */
export function carriesAppleData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(carriesAppleData);
  if (value === null || typeof value !== "object") return false;
  for (const [key, inner] of Object.entries(value)) {
    if (APPLE_KEY.test(key)) return true;
    if (key === "type" && typeof inner === "string" && OWNER_ONLY_MESSAGES.has(inner)) return true;
    if (carriesAppleData(inner)) return true;
  }
  return false;
}

/* ───────────── 문구 ───────────── */

export const GUESTBOOK_HEADER = "온기병동 방명록";
export const GUESTBOOK_LINK_NOTE = "이 링크를 받은 분만 사과를 남길 수 있어요";
export const GUESTBOOK_SHARE_TEXT = "온기병동 사과나무에 사과 하나 달아 줄래요?";
export const GUESTBOOK_CLOSED_TEXT = "이 방명록 링크는 더 이상 열리지 않아요.";
export const APPLE_LIMIT_TEXT = "이 링크로는 사과가 많이 열렸어요. 한 시간 뒤에 다시 달아 주세요.";
export const OWNER_HINT = "사과를 누르면 남긴 마음을 볼 수 있어요";

export function guestbookTitle(ownerNickname: string): string {
  return `${ownerNickname}님의 사과나무`;
}

export function appleCountText(count: number): string {
  return count === 0 ? "아직 열린 사과가 없어요" : `지금까지 사과 ${count}개가 열렸어요`;
}

/** 한국 날짜로 "11월 9일"처럼 적어요. */
export function appleDateText(at: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).formatToParts(new Date(at));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${Number(month)}월 ${Number(day)}일`;
}

/** 이름 뒤에 붙는 '이/가'예요. 한글이 아니면 '이(가)'예요. */
export function subjectParticle(name: string): string {
  const last = name.at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "이(가)";
  return code % 28 === 0 ? "가" : "이";
}

/** 사과 버튼의 이름이에요. "엄마가 남긴 사과, 11월 9일" */
export function appleLabel(name: string, at: number): string {
  return `${name}${subjectParticle(name)} 남긴 사과, ${appleDateText(at)}`;
}

export function phraseText(phrase: number): string {
  return APPLE_PHRASES[phrase] ?? APPLE_PHRASES[0];
}

const NAME_MESSAGES: Record<NicknameProblem, string> = {
  short: `이름은 ${NICKNAME_MIN}자 이상으로 적어 주세요.`,
  long: `이름은 ${NICKNAME_MAX}자까지 적을 수 있어요.`,
  digits: "숫자는 4개 넘게 이어서 쓸 수 없어요.",
  url: "주소처럼 보이는 글자는 쓸 수 없어요.",
  email: "이메일처럼 보이는 글자는 쓸 수 없어요.",
  banned: "다른 이름으로 적어 주세요.",
};

const NOTE_MESSAGES: Record<NicknameProblem, string> = {
  short: "",
  long: `짧은 글은 ${APPLE_NOTE_MAX}자까지 적을 수 있어요.`,
  digits: "숫자는 4개 넘게 이어서 쓸 수 없어요.",
  url: "주소처럼 보이는 글자는 쓸 수 없어요.",
  email: "이메일처럼 보이는 글자는 쓸 수 없어요.",
  banned: "다른 말로 적어 주세요.",
};

export function appleProblemText(problem: AppleProblem): string {
  if (problem.field === "phrase") return "한마디를 하나 골라 주세요.";
  return problem.field === "name" ? NAME_MESSAGES[problem.problem] : NOTE_MESSAGES[problem.problem];
}
