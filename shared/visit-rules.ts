/**
 * 문병 링크의 판단이에요. 화면과 Durable Object가 함께 쓰는 순수 함수이고,
 * directory와 병실 서버는 저장과 전송만 하고 무엇을 허락할지는 여기서 정해요.
 */
import { ADDRESS_PATTERN } from "./left-blessings.ts";
import { bedApproach, BEDS } from "./ward-layout.ts";
import { clampToWalkable } from "./ward-rules.ts";

/** 링크 토큰이에요. 평안 주소처럼 128비트 무작위 값을 URL에 써도 되는 글자 22자로 적어요. */
export const VISIT_TOKEN_PATTERN = ADDRESS_PATTERN;
/** 한 링크로 동시에 들어와 있을 수 있는 문병객 수예요. */
export const MAX_VISITORS_PER_LINK = 3;
/** 한 링크로 1시간 동안 들어올 수 있는 횟수예요. */
export const VISITS_PER_HOUR = 30;
export const HOUR_MS = 3_600_000;
/** 들어와 있는 문병객 기록이 이보다 오래되면 나간 것으로 봐요. 병실 서버가 나감을 알리지 못했을 때를 위해서예요. */
export const VISIT_SESSION_MS = 12 * HOUR_MS;

/** directory의 visit_link 한 줄이에요. 토큰 원본은 없고 해시만 있어요. */
export interface VisitLinkRow {
  tokenHash: string;
  /** 주인의 guestId 해시예요. */
  owner: string;
  /** 주인의 지금 평안 주소 해시예요. 들어올 때마다 바뀌어요. */
  addressHash: string;
  nickname: string;
  animal: string;
  created: number;
  off: boolean;
  /** 이 링크로 지금까지 문병 온 횟수예요. */
  visits: number;
  /** 주인이 마지막으로 있던 병동, 인스턴스, 침대예요. */
  ward: number;
  instance: number;
  bed: number;
}

/**
 * 새 링크를 만들어요. 한 사람당 하나뿐이라, 같은 주인의 예전 링크는 바로 지워요.
 * rows에는 지금 있는 링크를 넣고, 돌려받은 목록을 그대로 저장해요.
 */
export function replaceLink(rows: readonly VisitLinkRow[], next: Omit<VisitLinkRow, "off" | "visits">): VisitLinkRow[] {
  return [...rows.filter((row) => row.owner !== next.owner), { ...next, off: false, visits: 0 }];
}

/** 링크를 꺼요. 다시 켤 수는 없고, 새로 만들어야 해요. */
export function turnOffLink(rows: readonly VisitLinkRow[], owner: string): VisitLinkRow[] {
  return rows.map((row) => (row.owner === owner ? { ...row, off: true } : row));
}

export function findLink(rows: readonly VisitLinkRow[], tokenHash: string): VisitLinkRow | null {
  return rows.find((row) => row.tokenHash === tokenHash) ?? null;
}

/** 링크가 열려 있는지예요. 없거나 꺼진 링크는 열리지 않아요. */
export function linkOpen(link: VisitLinkRow | null): link is VisitLinkRow {
  return link !== null && !link.off;
}

/** 1시간 안의 입장 시각만 남겨요. */
export function recentAttempts(attempts: readonly number[], nowMs: number): number[] {
  return attempts.filter((at) => nowMs - at < HOUR_MS);
}

export type VisitCheck =
  | { kind: "ok"; link: VisitLinkRow }
  /** 없거나 꺼진 링크예요. 일반 입장으로 안내해요. */
  | { kind: "closed" }
  /** 지금 문병객이 많거나 1시간에 너무 자주 들어왔어요. 조금 뒤에 다시 와 달라고 해요. */
  | { kind: "busy" }
  /** 주인이 자기 링크로 들어왔어요. 그냥 일반 입장이에요. */
  | { kind: "self" };

/**
 * 링크로 들어오려는 사람을 받을지 정해요.
 * active는 이 링크로 지금 들어와 있는 문병객 수, attempts는 이 링크로 들어온 시각들이에요.
 */
export function checkVisit(
  link: VisitLinkRow | null,
  visitor: string,
  active: number,
  attempts: readonly number[],
  nowMs: number,
): VisitCheck {
  if (!linkOpen(link)) return { kind: "closed" };
  if (link.owner === visitor) return { kind: "self" };
  if (active >= MAX_VISITORS_PER_LINK) return { kind: "busy" };
  if (recentAttempts(attempts, nowMs).length >= VISITS_PER_HOUR) return { kind: "busy" };
  return { kind: "ok", link };
}

/**
 * 문병객이 보낼 수 있는 메시지예요. 침대에 눕기, 불빛, 자리에 없는 사람에게 남기기, 링크 만들기, 퇴원은 받지 않아요.
 * 안아 주기는 받아요. 누구를 안을 수 있는지(주인만)는 hug-rules가 정해요.
 */
const VISITOR_ALLOWED = new Set(["hello", "walk-to", "bless", "bow", "gift", "report", "hug-request", "hug-answer", "inbox-ack"]);

export function visitorMay(type: string): boolean {
  return VISITOR_ALLOWED.has(type);
}

/** 문병객이 서는 자리예요. 주인 침대 곁에서, 먼저 온 문병객 수만큼 발치 쪽으로 조금씩 비켜 서요. */
export function visitorSpot(bed: number, alreadyThere: number): { x: number; z: number } {
  const place = BEDS[bed] ?? BEDS[0];
  const spot = bedApproach(place);
  const step = Math.min(alreadyThere, MAX_VISITORS_PER_LINK - 1) * 0.5;
  // 침대 곁 자리에서 병실 문 쪽(+z)으로 비켜 서요. 걸을 수 없는 곳이면 가장 가까운 자리예요.
  return clampToWalkable(spot.x, spot.z + step);
}

/**
 * 문병객의 평안과 선물을 어디로 보낼지예요. 주인이 이 병동에 없고 주인 침대로 보냈으면
 * 주인에게 '내가 없는 동안 도착한 평안'으로 전해요. 나머지는 병실에서 그대로 보여요.
 */
export function visitorDelivery(visitBed: number, ownerPresent: boolean, targetBed: number | null): "owner-inbox" | "room" {
  return !ownerPresent && targetBed === visitBed ? "owner-inbox" : "room";
}

export { readVisitPath } from "./visit-path.ts";

/** 입장 화면의 제목이에요. */
export function visitTitle(ownerNickname: string): string {
  return `${ownerNickname}님에게 문병 왔어요`;
}

export function visitorArrivedText(nickname: string): string {
  return `${nickname}님이 문병 왔어요`;
}

export function visitCountText(visits: number): string {
  return visits === 0 ? "아직 문병 온 분이 없어요." : `지금까지 ${visits}번 문병 왔어요.`;
}

export const VISIT_SHARE_TEXT = "온기병동에 문병 와 줄래요?";
export const VISIT_CLOSED_TEXT = "이 문병 링크는 더 이상 열리지 않아요. 병동에 들러 다른 분들의 평안을 빌어 주세요";
export const VISIT_BUSY_TEXT = "지금은 문병객이 많아요. 조금 뒤에 다시 와 주세요";
