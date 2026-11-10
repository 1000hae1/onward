/**
 * 퇴원의 판단이에요. 퇴원 기록으로 불이익을 주는 일은 없어요. 다시 오면 "다시 들러 주셨네요"로만 맞아요.
 * 1분을 세는 타이머는 서버에 두지 않아요. 배웅이 올 때 시각을 견줘요.
 */
import type { GuestRecord } from "./ward-rules.ts";

/** 이 시간 동안 받은 배웅을 모아요. */
export const FAREWELL_MS = 60_000;
/** 배웅해 준 사람은 이만큼까지만 기억해요. */
const MAX_FAREWELLS = 50;

export type DischargeCheck = "ok" | "no-bed" | "visitor" | "already";

/** 퇴원할 수 있는지예요. 내 침대에 있는 환자만 퇴원해요. */
export function canDischarge(record: GuestRecord): DischargeCheck {
  if (record.discharge) return "already";
  if (record.visit) return "visitor";
  if (record.bed === null || record.outfit !== "patient") return "no-bed";
  return "ok";
}

/** 퇴원을 시작해요. 침대를 비우고 환자복을 벗고 문병객 모습이 돼요. closeLink면 방명록 링크도 꺼진 것으로 둬요. */
export function startDischarge(record: GuestRecord, nowMs: number, closeLink = false): GuestRecord {
  return {
    ...record,
    bed: null,
    lyingSince: null,
    bench: null,
    outfit: "visitor",
    linked: closeLink ? false : record.linked,
    discharge: { at: nowMs, from: [] },
  };
}

/**
 * 배웅을 하나 받아요. 1분 안에, 처음 배웅하는 사람만 세요. 나 자신은 세지 않아요.
 * counted가 false면 기록은 그대로예요.
 */
export function countFarewell(
  record: GuestRecord,
  fromKey: string,
  nowMs: number,
): { record: GuestRecord; counted: boolean } {
  const discharge = record.discharge;
  if (!discharge) return { record, counted: false };
  if (nowMs - discharge.at > FAREWELL_MS) return { record, counted: false };
  if (fromKey === record.key || discharge.from.includes(fromKey)) return { record, counted: false };
  if (discharge.from.length >= MAX_FAREWELLS) return { record, counted: false };
  return { record: { ...record, discharge: { ...discharge, from: [...discharge.from, fromKey] } }, counted: true };
}

export function farewellCount(record: GuestRecord): number {
  return record.discharge?.from.length ?? 0;
}

export const DISCHARGE_CONFIRM_TEXT = "오늘 퇴원할까요? 언제든 다시 들를 수 있어요";

export function dischargeNoticeText(nickname: string): string {
  return `${nickname}님이 퇴원해요`;
}

/** 1분 뒤 퇴원하는 사람에게 보여 주는 카드예요. */
export function farewellCardText(count: number): string {
  if (count <= 0) return "오늘도 머물러 주셔서 고마워요. 평안히 다녀가세요";
  return `${count}분이 배웅해 주셨어요`;
}
