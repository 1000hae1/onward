import { z } from "zod";
import { ADDRESS_PATTERN } from "./left-blessings.ts";
import { APPLE_NOTE_MAX, APPLE_PHRASES, APPLE_SLOTS } from "./apple-limits.ts";

/** 프로토콜 버전. 화면과 Worker가 함께 쓰는 모든 메시지에 v 필드로 담아요. */
export const PROTOCOL_VERSION = 6;
/** 화면이 보내는 메시지는 이보다 길면 읽지 않고 버려요. */
export const MAX_MESSAGE_BYTES = 1024;
/** 화면이 읽는 서버 메시지의 최대 글자 수예요. 손님 30명과 잠시 끊긴 사람이 다 든 snapshot도 넉넉히 들어가요. */
export const MAX_SERVER_MESSAGE_CHARS = 65_536;
/** 연결 유지용 글자예요. 서버가 객체를 깨우지 않고 자동으로 답해요. */
export const PING = "ping";
export const PONG = "pong";
export const WARD_CAPACITY = 30;
export const BED_COUNT = 36;

export const healthResponseSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  ok: z.boolean(),
  sqlite: z.boolean(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * 공개 접속자 수예요. 다른 사이트도 읽어요.
 * 숫자와 시각만 있어요. 닉네임, 동물, guestId, 공개 번호는 이 형식에 넣을 자리가 없어요.
 */
export const statsResponseSchema = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  online: z.number().int().min(0),
  wards: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

const v = z.literal(PROTOCOL_VERSION);
const coordinate = z.number().finite().min(-1000).max(1000);
const bedId = z.number().int().min(0).max(BED_COUNT - 1);
/** 다른 사람을 가리키는 공개 번호예요. guestId는 남에게 보내지 않아요. */
const publicId = z.string().regex(/^[a-z0-9]{8}$/);
/** 한마디 번호예요. 5번 "좋은 아침이에요"는 아침(06:30~09:00)에만 서버가 받아요. */
const phrase = z.number().int().min(0).max(5);
const item = z.number().int().min(0).max(4);
/** 평안 주소예요. 다른 사람에게 보여도 되는 무작위 값이고, 서버에는 해시로만 있어요. */
const address = z.string().regex(ADDRESS_PATTERN);
/** 안아 주기 요청 번호예요. 서버가 무작위로 만들어요. */
const requestId = z.string().regex(/^[a-z0-9]{12}$/);
const roomIndex = z.number().int().min(0).max(5);
const appleId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
/** 사과 한 알이에요. 주인에게는 모든 사과, 링크로 온 사람에게는 자기가 단 사과만 보내요. */
export const appleCardSchema = z.object({
  id: appleId,
  slot: z.number().int().min(0).max(APPLE_SLOTS - 1),
  name: z.string().max(64),
  phrase: z.number().int().min(0).max(APPLE_PHRASES.length - 1),
  note: z.string().max(APPLE_NOTE_MAX * 2).nullable(),
  at: z.number().finite(),
});
export type AppleCardMessage = z.infer<typeof appleCardSchema>;
export const animalSchema = z.enum(["rabbit", "bear", "penguin", "otter", "deer"]);
export const outfitSchema = z.enum(["patient", "visitor"]);

/** 누구에게 보낼지예요. 사람(targetId)이나 침대(bedId) 가운데 하나만 적어요. */
const exactlyOneTarget = (value: { targetId?: string; bedId?: number }): boolean =>
  (value.targetId === undefined) !== (value.bedId === undefined);

export const clientMessageSchema = z.union([
  z.object({
    v,
    type: z.literal("hello"),
    /** 서버가 서명해 준 게스트 토큰이에요. 처음이면 비워 보내고, 서버가 새로 만들어 줘요. */
    token: z.string().max(128).optional(),
    animal: animalSchema,
    outfit: outfitSchema,
    nickname: z.string().max(64),
    withCat: z.boolean(),
    /** 방명록 링크에서 [병실에 문병 가기]로 들어올 때만 담아요. 방명록 링크 토큰이에요. 서버가 directory에서 확인해요. */
    visitToken: address.optional(),
    /** 설정의 "안아 주기 요청 받지 않기"예요. */
    hugsOff: z.boolean().optional(),
  }),
  z.object({ v, type: z.literal("walk-to"), x: coordinate, z: coordinate }),
  z.object({ v, type: z.literal("lie-down"), bedId }),
  z.object({ v, type: z.literal("get-up") }),
  z
    .object({ v, type: z.literal("bless"), targetId: publicId.optional(), bedId: bedId.optional() })
    .refine(exactlyOneTarget),
  z.object({ v, type: z.literal("bow"), phrase }),
  z
    .object({ v, type: z.literal("gift"), item, targetId: publicId.optional(), bedId: bedId.optional() })
    .refine(exactlyOneTarget),
  z.object({ v, type: z.literal("lamp") }),
  /** 지금 자리에 없는 사람에게 평안이나 선물을 남겨요. */
  z
    .object({ v, type: z.literal("leave-for"), address, kind: z.enum(["bless", "gift"]), item: item.optional() })
    .refine((value) => (value.kind === "gift") === (value.item !== undefined)),
  /** 내 방명록(사과나무)을 열어 보거나(info), 링크를 새로 만들거나(create), 꺼요(off). 답은 나에게만 와요. */
  z.object({ v, type: z.literal("guestbook"), action: z.enum(["create", "off", "info"]) }),
  /** 내 나무의 사과 하나를 숨겨요. 서버에서 바로 지워요. */
  z.object({ v, type: z.literal("hide-apple"), appleId }),
  /** 수면 모드를 켜거나 껐어요. 잠든 사람에게는 안아 주기 요청이 가지 않아요. */
  z.object({ v, type: z.literal("sleep"), sleeping: z.boolean() }),
  /** 다른 동물을 안아 주고 싶어요. 서버가 거리·횟수·설정을 살펴요. */
  z.object({ v, type: z.literal("hug-request"), targetId: publicId }),
  /** 받은 안아 주기 요청에 답해요. */
  z.object({ v, type: z.literal("hug-answer"), requestId, accept: z.boolean() }),
  /** 오늘 퇴원해요. closeLink면 방명록 링크도 함께 꺼요. */
  z.object({ v, type: z.literal("discharge"), closeLink: z.boolean() }),
  /** 내가 없는 동안 도착한 평안을 받았어요. upTo 시각까지 남겨진 것을 서버가 지워요. */
  z.object({ v, type: z.literal("inbox-ack"), upTo: z.number().finite() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type HelloMessage = Extract<ClientMessage, { type: "hello" }>;

export const guestSchema = z.object({
  id: publicId,
  animal: animalSchema,
  outfit: outfitSchema,
  nickname: z.string().max(64),
  withCat: z.boolean(),
  x: coordinate,
  z: coordinate,
  bed: bedId.nullable(),
  address,
  /** 지금 안아 주기 요청을 받을 수 있는지예요. 잠들었는지, 설정으로 껐는지는 나누지 않아요. */
  hugOk: z.boolean(),
});
export type Guest = z.infer<typeof guestSchema>;

/** 남겨진 평안 카드예요. 남긴 사람의 해시는 담지 않아요. */
const blessingCardSchema = z.object({
  nickname: z.string().max(64),
  animal: animalSchema,
  kind: z.enum(["bless", "gift"]),
  item: item.nullable(),
  at: z.number().finite(),
});
export type BlessingCardMessage = z.infer<typeof blessingCardSchema>;

/** 오늘 이 병실의 집계예요. 한국 날짜가 바뀌면 0부터 다시 세요. */
const statsSchema = z.object({
  visitors: z.number().int().min(0),
  blessings: z.number().int().min(0),
  lamps: z.number().int().min(0),
});
export type WardStats = z.infer<typeof statsSchema>;

const catVisitSchema = z.object({
  room: z.number().int().min(0).max(5),
  bed: bedId,
  at: z.number().finite(),
});

const placedGiftSchema = z.object({
  stand: bedId,
  slot: z.number().int().min(0).max(1),
  item,
});
export type PlacedGiftState = z.infer<typeof placedGiftSchema>;

export const wardEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("join"), guest: guestSchema }),
  z.object({ kind: z.literal("update"), guest: guestSchema }),
  z.object({ kind: z.literal("leave"), id: publicId }),
  z.object({ kind: z.literal("walk"), id: publicId, x: coordinate, z: coordinate }),
  z.object({ kind: z.literal("lie"), id: publicId, bedId }),
  z.object({ kind: z.literal("get-up"), id: publicId }),
  z.object({ kind: z.literal("bless"), id: publicId, bedId: bedId.nullable(), targetId: publicId.nullable() }),
  z.object({ kind: z.literal("bow"), id: publicId, phrase }),
  z.object({ kind: z.literal("gift"), id: publicId, gift: placedGiftSchema }),
  z.object({ kind: z.literal("lamp"), id: publicId, room: z.number().int().min(0).max(5), count: z.number().int().min(0) }),
  /** 오늘의 집계가 바뀌었어요. 새 사람이 처음 오거나 평안이 모일 때만 보내요. */
  z.object({ kind: z.literal("stats"), stats: statsSchema }),
  /** 병동 고양이가 찾아갈 침대예요. visit이 null이면 changedAt부터 찾아가기를 그만둬요. */
  z.object({
    kind: z.literal("cat-visit"),
    room: z.number().int().min(0).max(5),
    visit: catVisitSchema.nullable(),
    changedAt: z.number().finite(),
  }),
  /** 두 동물이 안아요. bed는 안기는 사람이 누워 있는 침대예요. 서 있으면 null이에요. */
  z.object({ kind: z.literal("hug"), a: publicId, b: publicId, bed: bedId.nullable() }),
  /** 아침에 그날 처음 누가 병실에 들어와서 창문이 열려요. 병실마다 하루 한 번이에요. */
  z.object({ kind: z.literal("window-open"), room: roomIndex }),
  /** 이 병실에 모인 평안의 누적 수예요. 줄지 않아요. */
  z.object({ kind: z.literal("planter"), room: roomIndex, total: z.number().int().min(0) }),
  /** 같은 병실의 누군가 퇴원해요. 같은 병실 사람에게만 보내요. */
  z.object({ kind: z.literal("discharge"), id: publicId }),
]);
export type WardEvent = z.infer<typeof wardEventSchema>;

export const deniedReasonSchema = z.enum([
  "out-of-season",
  "gift-limit",
  "lamp-full",
  "not-in-room",
  "no-target",
  "too-fast",
  "once-a-day",
  /** 방명록 링크는 침대에 누운 뒤 만들 수 있어요. */
  "no-bed",
  /** 안아 주기: 2m보다 멀어요. */
  "too-far",
  /** 안아 주기: 같은 분께는 10분에 한 번이에요. */
  "too-soon",
  /** 안아 주기: 지금은 요청을 받지 않아요. */
  "unavailable",
  /** 좋은 아침이에요: 아침이 아니에요. */
  "not-morning",
]);
export type DeniedReason = z.infer<typeof deniedReasonSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    v,
    type: z.literal("snapshot"),
    you: publicId,
    capacity: z.number().int(),
    guests: z.array(guestSchema),
    gifts: z.array(placedGiftSchema),
    lamps: z.array(z.number().int().min(0)),
    /** 귤·홍시·호빵을 놓을 수 있는 철인지예요. */
    seasonalGifts: z.boolean(),
    /** 서버 시각이에요. 병동 고양이를 모두 같은 시계로 움직이려고 보내요. */
    serverNow: z.number().finite(),
    catVisits: z.array(catVisitSchema),
    /** 30초 안에 돌아와 침대와 자리를 그대로 받았는지예요. */
    restored: z.boolean(),
    /** 내가 없는 동안 도착한 평안이에요. 보내고 나면 서버에서 지워요. */
    inbox: z.array(blessingCardSchema),
    stats: statsSchema,
    /** 방명록 링크로 문병 왔으면 누구에게 왔는지예요. 주인 닉네임은 링크를 가진 사람에게만 보내요. 사과는 담지 않아요. */
    visit: z
      .object({ ownerNickname: z.string().max(64), ownerPresent: z.boolean(), bed: bedId })
      .nullable(),
    /** 자주 온 사람이면 병동 고양이가 먼저 반겨요. 다녀간 날 수는 보내지 않아요. */
    greet: z.boolean(),
    /** 퇴원한 뒤 다시 들어왔어요. */
    welcomeBack: z.boolean(),
    /** 오늘 아침 창문이 열린 병실이에요. */
    morningRooms: z.array(roomIndex),
    /** 병실마다 모인 평안의 누적 수예요. */
    planters: z.array(z.number().int().min(0)),
  }),
  /** 받은 침대에 남겨져 있던 평안이에요. 보내고 나면 서버에서 지워요. */
  z.object({ v, type: z.literal("left-blessings"), bedId, cards: z.array(blessingCardSchema) }),
  /** 자리에 없는 사람에게 남긴 평안이 잘 저장됐어요. */
  z.object({ v, type: z.literal("left-saved") }),
  z.object({ v, type: z.literal("event"), event: wardEventSchema }),
  z.object({ v, type: z.literal("position-corrected"), x: coordinate, z: coordinate }),
  z.object({ v, type: z.literal("bed-granted"), bedId }),
  z.object({ v, type: z.literal("bed-unavailable"), bedId }),
  z.object({
    v,
    type: z.literal("nickname-rejected"),
    problem: z.enum(["short", "long", "digits", "url", "email", "banned"]),
  }),
  z.object({ v, type: z.literal("room-full"), capacity: z.number().int(), next: z.number().int().min(1) }),
  /**
   * 내 방명록이에요. 주인의 연결에만 보내요. token은 링크를 새로 만든 그 순간에만 보내요. 서버에는 해시만 있어요.
   * apples는 나무에 보이는 최근 40개, count는 1년 안에 열린 모든 사과 수예요.
   */
  z.object({
    v,
    type: z.literal("guestbook"),
    token: address.nullable(),
    active: z.boolean(),
    count: z.number().int().min(0),
    apples: z.array(appleCardSchema).max(APPLE_SLOTS),
  }),
  /** 내 침대 옆에 작은 사과나무를 그릴지예요. 들어올 때 주인의 연결에만 보내요. */
  z.object({ v, type: z.literal("my-tree"), active: z.boolean(), count: z.number().int().min(0) }),
  /** 방명록 링크로 문병 오지 못했어요. closed면 일반 입장으로 이어 가고, busy면 들어가지 않아요. */
  z.object({ v, type: z.literal("visit-denied"), reason: z.enum(["closed", "busy"]) }),
  /** 내 침대로 문병객이 왔어요. 주인의 연결에만 보내요. */
  z.object({ v, type: z.literal("visitor-arrived"), id: publicId, nickname: z.string().max(64) }),
  /** 서버가 새로 서명한 게스트 토큰이에요. 이 브라우저에만 보내고, 화면은 저장해 두었다가 다음 hello에 담아요. */
  z.object({ v, type: z.literal("guest-token"), token: z.string().max(128) }),
  /** 들어올 수 없어요. blocked는 운영자가 막았을 때, limited는 새 게스트를 너무 많이 만들었을 때예요. */
  z.object({ v, type: z.literal("entry-denied"), reason: z.enum(["blocked", "limited"]) }),
  /** 서버가 들어오는 일을 처리하지 못했어요. 화면은 잠시 뒤 다시 이어요. */
  z.object({ v, type: z.literal("entry-failed") }),
  /** 운영자가 내 닉네임을 자동 닉네임으로 되돌렸어요. */
  z.object({ v, type: z.literal("nickname-reset"), nickname: z.string().max(64) }),
  /** 누군가 나를 안아 주려고 해요. 받는 사람에게만 보내요. */
  z.object({ v, type: z.literal("hug-offer"), requestId, fromId: publicId }),
  /** 상대가 [다음에요]를 눌렀어요. 보낸 사람에게만 보내요. 답이 없으면 아무것도 보내지 않아요. */
  z.object({ v, type: z.literal("hug-declined") }),
  /** 퇴원을 받아 줬어요. 지금부터 1분 동안 배웅을 모아요. */
  z.object({ v, type: z.literal("discharge-started"), until: z.number().finite() }),
  /** 지금까지 배웅해 준 사람 수예요. 퇴원하는 사람에게만 보내요. */
  z.object({ v, type: z.literal("farewell-count"), count: z.number().int().min(0) }),
  /** 보낸 메시지의 버전이 서버와 달라요. v에는 서버의 버전이 있어요. */
  z.object({ v, type: z.literal("version-mismatch") }),
  /** 선물과 불빛처럼 서버가 받지 않은 동작이에요. 요청 목록에는 없지만 안내 문구를 보여 주려고 더했어요. */
  z.object({
    v,
    type: z.literal("action-denied"),
    action: z.enum(["bless", "bow", "gift", "lamp", "guestbook", "hug", "discharge"]),
    reason: deniedReasonSchema,
    /** 선물이면 어떤 선물이었는지예요. 오잎클로버 안내를 따로 보여 주려고요. */
    item: item.optional(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * 받은 글자를 메시지로 읽어요. 형식이 맞지 않으면 null이에요.
 * maxChars는 기본이 화면이 보내는 메시지의 한도예요. 화면이 서버 메시지를 읽을 때는 MAX_SERVER_MESSAGE_CHARS를 넣어요.
 */
export function parseMessage<T>(schema: z.ZodType<T>, raw: unknown, maxChars = MAX_MESSAGE_BYTES * 4): T | null {
  if (typeof raw !== "string" || raw.length > maxChars) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * GET /api/guestbook/{토큰}의 답이에요. 토큰을 가진 사람에게만 열려요.
 * 사과는 개수와, 이 브라우저가 단 사과(mine)만 담아요. 다른 사람이 단 사과의 이름·날짜·글은 담지 않아요.
 * ward와 instance는 [병실에 문병 가기]로 들어갈 병동이에요.
 */
export const guestbookViewSchema = z.union([
  z.strictObject({
    v,
    open: z.literal(true),
    ownerNickname: z.string().max(64),
    ownerAnimal: animalSchema,
    ward: z.number().int().min(1).max(99),
    instance: z.number().int().min(1).max(20),
    count: z.number().int().min(0),
    mine: z.array(appleCardSchema).max(APPLE_SLOTS),
  }),
  z.strictObject({ v, open: z.literal(false) }),
]);
export type GuestbookView = z.infer<typeof guestbookViewSchema>;

/** POST /api/guestbook/{토큰}/apples 의 본문이에요. 글자는 서버가 다시 살펴요. writer는 이 브라우저의 무작위 열쇠예요. */
export const applePostSchema = z.strictObject({
  v,
  writer: address,
  name: z.string().max(64),
  phrase: z.number().int().min(0).max(APPLE_PHRASES.length - 1),
  note: z.string().max(APPLE_NOTE_MAX * 4).nullable().optional(),
});
export type ApplePost = z.infer<typeof applePostSchema>;

export const applePostResultSchema = z.discriminatedUnion("result", [
  z.object({ v, result: z.literal("saved"), apple: appleCardSchema, count: z.number().int().min(0) }),
  /** 링크가 없거나 꺼졌어요. */
  z.object({ v, result: z.literal("closed") }),
  /** 같은 링크로 1시간에 10개를 넘었어요. */
  z.object({ v, result: z.literal("limit") }),
  /** 이름이나 짧은 글이 규칙에 맞지 않아요. */
  z.object({
    v,
    result: z.literal("invalid"),
    field: z.enum(["name", "phrase", "note"]),
    problem: z.enum(["short", "long", "digits", "url", "email", "banned"]).optional(),
  }),
]);
export type ApplePostResult = z.infer<typeof applePostResultSchema>;

/* ───────────── 운영자 API ───────────── */

/** guestId 해시와 IP 해시는 모두 SHA-256 16진수 64자예요. */
const hash64 = z.string().regex(/^[0-9a-f]{64}$/);
/** 운영자가 적는 사유예요. 사용자에게는 보이지 않고 audit_log에만 남아요. */
const adminReason = z.string().trim().min(1).max(200);

export const adminBlockSchema = z
  .object({ v, guestHash: hash64.optional(), ipHash: hash64.optional(), reason: adminReason })
  .refine((value) => (value.guestHash === undefined) !== (value.ipHash === undefined));
export type AdminBlock = z.infer<typeof adminBlockSchema>;

/** 한 사람(guestId 해시)에게 하는 작업이에요. 닉네임 되돌리기, 방명록 링크 끄기, 가림 풀기에 써요. */
export const adminGuestActionSchema = z.object({ v, guestHash: hash64, reason: adminReason });
export type AdminGuestAction = z.infer<typeof adminGuestActionSchema>;

/** 사과 하나를 숨겨요(지워요). 사과 번호는 주인이 알려 준 번호예요. */
export const adminHideAppleSchema = z.object({ v, appleId, reason: adminReason });
export type AdminHideApple = z.infer<typeof adminHideAppleSchema>;
