/**
 * 빈 침대와 자리에 없는 사람에게 남기는 평안이에요. 화면과 상관없는 순수 함수이고,
 * Durable Object는 저장만 하고 무엇을 남기고 지울지는 여기서 정해요.
 */
import { GIFTS } from "./gestures.ts";

export const DAY_MS = 86_400_000;
/** 남긴 평안은 7일이 지나면 지워요. */
export const KEEP_MS = 7 * DAY_MS;
/** 침대마다 최근 5개까지만 둬요. */
export const LEFT_PER_BED = 5;
/** 받는 사람마다 최근 10개까지만 둬요. */
export const INBOX_PER_GUEST = 10;
/** 오잎클로버의 번호예요. 하루 한 번만 놓을 수 있어요. */
export const FIVE_LEAF_ITEM = 1;

export type LeftKind = "bless" | "gift";

/** 남긴 사람이 보이는 정보예요. 남긴 사람이 누구인지 가리키는 해시는 화면에 보내지 않아요. */
export interface BlessingCard {
  nickname: string;
  animal: string;
  kind: LeftKind;
  item: number | null;
  at: number;
}

/** 저장할 때는 남긴 사람의 해시도 함께 둬요. 내가 남긴 것을 내가 받지 않게 하고, 하루 1번을 세려고요. */
export interface StoredBlessing extends BlessingCard {
  sender: string;
}

export function toCard(stored: StoredBlessing): BlessingCard {
  return { nickname: stored.nickname, animal: stored.animal, kind: stored.kind, item: stored.item, at: stored.at };
}

/** 7일이 지나지 않은 것만 남겨요. */
export function fresh<T extends { at: number }>(list: readonly T[], nowMs: number): T[] {
  return list.filter((entry) => nowMs - entry.at < KEEP_MS);
}

/** 새로 남긴 것을 더하고, 오래된 것은 limit개만 남겨요. 최근 것이 앞이에요. */
export function addLatest<T extends { at: number }>(list: readonly T[], entry: T, limit: number, nowMs: number): T[] {
  return [entry, ...fresh(list, nowMs)].sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * 침대를 받은 사람에게 줄 평안이에요. 받으면 모두 지워요.
 * 내가 남긴 것은 보여 주지 않고 지우기만 해요. 오래된 것부터 보여 주려고 시각 순으로 돌려줘요.
 */
export function takeForTaker(list: readonly StoredBlessing[], takerHash: string, nowMs: number): BlessingCard[] {
  return fresh(list, nowMs)
    .filter((entry) => entry.sender !== takerHash)
    .sort((a, b) => a.at - b.at)
    .map(toCard);
}

/**
 * 받은 평안 카드 가운데 가장 늦은 시각이에요. 화면은 이 값으로 받았다고 알리고, 서버는 그때까지 남겨진 것만 지워요.
 * 카드가 없으면 알릴 것이 없어서 null이에요.
 */
export function inboxAckUpTo(cards: readonly { at: number }[]): number | null {
  return cards.length === 0 ? null : Math.max(...cards.map((card) => card.at));
}

/** 받았다고 알린 뒤에도 남는 평안이에요. 그사이 새로 도착한 것은 다음에 전해요. */
export function inboxAfterAck<T extends { at: number }>(list: readonly T[], upTo: number): T[] {
  return list.filter((entry) => entry.at > upTo);
}

/** 같은 사람에게는 한국 시간으로 하루 한 번만 남길 수 있어요. */
export function dailyKey(senderHash: string, ownerHash: string, koreanDay: string): string {
  return `${koreanDay}:${senderHash}>${ownerHash}`;
}

/** 오잎클로버를 오늘 이미 놓았는지예요. lastDay는 마지막으로 놓은 한국 날짜예요. */
export function fiveLeafAllowed(lastDay: string | null, today: string): boolean {
  return lastDay !== today;
}

/** 받침이 있으면 을, 없으면 를이에요. */
function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "를";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

/** "3시간 전"처럼 지난 시간을 부드럽게 말해요. */
export function timeAgo(atMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "어제" : `${days}일 전`;
}

function giftWord(item: number | null): string | null {
  return item === null ? null : (GIFTS[item] ?? null);
}

/** 침대에 남겨진 평안 카드의 문구예요. */
export function bedCardText(card: BlessingCard, nowMs: number): string {
  const when = timeAgo(card.at, nowMs);
  const gift = card.kind === "gift" ? giftWord(card.item) : null;
  if (gift) return `${when}, ${card.nickname}님이 이 침대에 ${gift}${objectParticle(gift)} 남겨두었어요`;
  return `${when}, ${card.nickname}님이 이 침대에 평안을 남겨두었어요`;
}

/** 내가 없는 동안 도착한 평안의 문구예요. */
export function inboxCardText(card: BlessingCard, nowMs: number): string {
  const when = timeAgo(card.at, nowMs);
  const gift = card.kind === "gift" ? giftWord(card.item) : null;
  if (gift) return `${when}, ${card.nickname}님이 ${gift}${objectParticle(gift)} 남겨두었어요`;
  return `${when}, ${card.nickname}님이 평안을 남겨두었어요`;
}

/** 평안 주소예요. 128비트 무작위 값을 URL에 써도 되는 글자 22자로 적어요. */
export const ADDRESS_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function encodeAddress(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
