import { z } from "zod";
import { ADDRESS_PATTERN } from "./left-blessings.ts";

/** 프로토콜 버전. 화면과 Worker가 함께 쓰는 모든 메시지에 v 필드로 담아요. */
export const PROTOCOL_VERSION = 2;
/** 이보다 긴 메시지는 읽지 않고 버려요. */
export const MAX_MESSAGE_BYTES = 1024;
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

const v = z.literal(PROTOCOL_VERSION);
const coordinate = z.number().finite().min(-1000).max(1000);
const bedId = z.number().int().min(0).max(BED_COUNT - 1);
/** 다른 사람을 가리키는 공개 번호예요. guestId는 남에게 보내지 않아요. */
const publicId = z.string().regex(/^[a-z0-9]{8}$/);
const phrase = z.number().int().min(0).max(4);
const item = z.number().int().min(0).max(4);
/** 평안 주소예요. 다른 사람에게 보여도 되는 무작위 값이고, 서버에는 해시로만 있어요. */
const address = z.string().regex(ADDRESS_PATTERN);
export const animalSchema = z.enum(["rabbit", "bear", "penguin", "otter", "deer"]);
export const outfitSchema = z.enum(["patient", "visitor"]);

/** 누구에게 보낼지예요. 사람(targetId)이나 침대(bedId) 가운데 하나만 적어요. */
const exactlyOneTarget = (value: { targetId?: string; bedId?: number }): boolean =>
  (value.targetId === undefined) !== (value.bedId === undefined);

export const clientMessageSchema = z.union([
  z.object({
    v,
    type: z.literal("hello"),
    guestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
    animal: animalSchema,
    outfit: outfitSchema,
    nickname: z.string().max(64),
    withCat: z.boolean(),
    /** 문병 링크로 들어올 때만 담아요. 서버가 directory에서 확인해요. */
    visitToken: address.optional(),
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
  /** 내 침대로 오는 문병 링크를 만들거나(create), 끄거나(off), 지금 상태를 물어요(info). */
  z.object({ v, type: z.literal("visit-link"), action: z.enum(["create", "off", "info"]) }),
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
  /** 문병 링크는 침대에 누운 뒤 만들 수 있어요. */
  "no-bed",
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
    /** 문병 링크로 들어왔으면 누구에게 왔는지예요. 주인 닉네임은 링크를 가진 사람에게만 보내요. */
    visit: z
      .object({ ownerNickname: z.string().max(64), ownerPresent: z.boolean(), bed: bedId })
      .nullable(),
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
  /** 내 문병 링크의 상태예요. token은 새로 만든 그 순간에만 주인에게 보내요. 서버에는 해시만 있어요. */
  z.object({
    v,
    type: z.literal("visit-link"),
    token: address.nullable(),
    active: z.boolean(),
    visits: z.number().int().min(0),
  }),
  /** 문병 링크로 들어오지 못했어요. closed면 일반 입장으로 이어 가고, busy면 들어가지 않아요. */
  z.object({ v, type: z.literal("visit-denied"), reason: z.enum(["closed", "busy"]) }),
  /** 내 침대로 문병객이 왔어요. 주인의 연결에만 보내요. */
  z.object({ v, type: z.literal("visitor-arrived"), id: publicId, nickname: z.string().max(64) }),
  /** 보낸 메시지의 버전이 서버와 달라요. v에는 서버의 버전이 있어요. */
  z.object({ v, type: z.literal("version-mismatch") }),
  /** 선물과 불빛처럼 서버가 받지 않은 동작이에요. 요청 목록에는 없지만 안내 문구를 보여 주려고 더했어요. */
  z.object({
    v,
    type: z.literal("action-denied"),
    action: z.enum(["bless", "bow", "gift", "lamp", "visit-link"]),
    reason: deniedReasonSchema,
    /** 선물이면 어떤 선물이었는지예요. 오잎클로버 안내를 따로 보여 주려고요. */
    item: item.optional(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** 받은 글자를 메시지로 읽어요. 형식이 맞지 않으면 null이에요. */
export function parseMessage<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES * 4) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/** /api/visit/{토큰}의 답이에요. 열리는 링크면 주인 닉네임과 동물, 들어갈 병동을 알려 줘요. */
export const visitPreviewSchema = z.union([
  z.object({
    v,
    open: z.literal(true),
    ownerNickname: z.string().max(64),
    ownerAnimal: animalSchema,
    ward: z.number().int().min(1).max(99),
    instance: z.number().int().min(1).max(20),
  }),
  z.object({ v, open: z.literal(false) }),
]);
export type VisitPreview = z.infer<typeof visitPreviewSchema>;
