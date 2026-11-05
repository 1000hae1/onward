import { z } from "zod";

/** 프로토콜 버전. 화면과 Worker가 함께 쓰는 모든 메시지에 v 필드로 담아요. */
export const PROTOCOL_VERSION = 1;

export const healthResponseSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  ok: z.boolean(),
  sqlite: z.boolean(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
