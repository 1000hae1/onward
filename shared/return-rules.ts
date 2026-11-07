/**
 * 다시 오는 사람을 알아보는 판단이에요. 다녀간 날 수는 directory에 guestId 해시로만 두고,
 * 본인에게도 숫자로 보내지 않아요. 반겨 줄지만 알려요.
 */

/** 이만큼 다른 날에 다녀가면 병동 고양이가 먼저 반겨요. */
export const GREET_AFTER_DAYS = 3;
/** 마지막으로 다녀간 뒤 이만큼 지나면 기록을 지워요. */
export const VISIT_DAYS_KEEP_MS = 180 * 86_400_000;

export interface VisitDays {
  days: number;
  /** 마지막으로 센 한국 날짜예요. */
  lastDay: string;
}

/** 오늘 들어왔어요. 같은 날 여러 번 와도 한 번만 세요. 날짜가 거꾸로 가도 세지 않아요. */
export function countVisitDay(previous: VisitDays | null, today: string): VisitDays & { counted: boolean } {
  if (!previous) return { days: 1, lastDay: today, counted: true };
  if (today <= previous.lastDay) return { ...previous, counted: false };
  return { days: previous.days + 1, lastDay: today, counted: true };
}

/** 병동 고양이가 먼저 반겨 줄 만큼 자주 왔는지예요. */
export function shouldGreet(days: number): boolean {
  return days >= GREET_AFTER_DAYS;
}

export const WELCOME_BACK_TEXT = "다시 들러 주셨네요";
