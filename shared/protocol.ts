import { z } from "zod";

/** 프로토콜 버전. 화면과 Worker가 함께 쓰는 모든 메시지에 v 필드로 담아요. */
export const PROTOCOL_VERSION = 1;
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
});
export type Guest = z.infer<typeof guestSchema>;

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
]);
export type WardEvent = z.infer<typeof wardEventSchema>;

export const deniedReasonSchema = z.enum([
  "out-of-season",
  "gift-limit",
  "lamp-full",
  "not-in-room",
  "no-target",
  "too-fast",
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
  }),
  z.object({ v, type: z.literal("event"), event: wardEventSchema }),
  z.object({ v, type: z.literal("position-corrected"), x: coordinate, z: coordinate }),
  z.object({ v, type: z.literal("bed-granted"), bedId }),
  z.object({ v, type: z.literal("bed-unavailable"), bedId }),
  z.object({
    v,
    type: z.literal("nickname-rejected"),
    problem: z.enum(["short", "long", "digits", "url", "email", "banned"]),
  }),
  z.object({ v, type: z.literal("room-full"), capacity: z.number().int() }),
  /** 선물과 불빛처럼 서버가 받지 않은 동작이에요. 요청 목록에는 없지만 안내 문구를 보여 주려고 더했어요. */
  z.object({ v, type: z.literal("action-denied"), action: z.enum(["bless", "bow", "gift", "lamp"]), reason: deniedReasonSchema }),
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
