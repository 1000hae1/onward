/**
 * 접속자 수를 세는 판단이에요. 병실 서버와 directory는 이 순수 함수만 불러요.
 *
 * 병실은 들고 날 때 "우리 병실 지금 인원"을 directory에 알려요. 차이값이 아니라 현재값이라
 * 같은 값을 두 번 보내거나 하나를 놓쳐도 다음 보고에서 바로 맞춰져요.
 * 주기적으로 세지 않아요. 이벤트가 있을 때만 알리고, 그때 마지막 보고가 오래됐으면 같은 값이라도 다시 알려요.
 */

/** 병실 하나의 인원이에요. 문병객은 정원과 따로 세요. */
export interface Headcount {
  patients: number;
  visitors: number;
}

/** directory에 적어 두는 병실별 인원이에요. 숫자와 병실 이름만 있어요. */
export interface PresenceRow extends Headcount {
  room: string;
  at: number;
}

/** 병실이 마지막으로 directory에 알린 값이에요. */
export interface LastReport extends Headcount {
  at: number;
}

/** 값이 같아도 이보다 오래됐으면, 다음 이벤트 때 한 번 더 알려요. */
export const PRESENCE_REFRESH_MS = 60 * 60 * 1000;
/** 이보다 오래 소식이 없는 병실은 세지 않고 지워요. 재시작으로 퇴장 소식을 놓친 병실이에요. */
export const PRESENCE_STALE_MS = 12 * 60 * 60 * 1000;
/** 병실 하나에서 믿을 수 있는 최대 인원이에요. 이보다 큰 값은 잘못 온 것으로 봐요. */
export const MAX_ROOM_HEADCOUNT = 200;

const ROOM_PATTERN = /^ward-\d{1,2}-\d{1,2}$/;

/** 병실에 있는 사람을 환자와 문병객으로 나눠 세요. 잠시 끊긴 사람도 자리를 지키고 있으니 넣어서 불러요. */
export function headcount(records: readonly { visit?: unknown }[]): Headcount {
  let visitors = 0;
  for (const record of records) if (record.visit) visitors++;
  return { patients: records.length - visitors, visitors };
}

function total(count: Headcount): number {
  return count.patients + count.visitors;
}

/** directory에 알려야 하는지예요. 값이 바뀌었거나, 사람이 있는데 마지막 보고가 오래됐을 때만 알려요. */
export function shouldReport(last: LastReport | null, current: Headcount, nowMs: number): boolean {
  if (last === null) return total(current) > 0;
  if (last.patients !== current.patients || last.visitors !== current.visitors) return true;
  return total(current) > 0 && nowMs - last.at >= PRESENCE_REFRESH_MS;
}

function cleanCount(value: number): number | null {
  return Number.isInteger(value) && value >= 0 && value <= MAX_ROOM_HEADCOUNT ? value : null;
}

/**
 * directory가 받은 보고를 어떻게 적을지 정해요. 아무도 없는 병실은 지워요.
 * 병실 이름이나 숫자가 이상하면 아무것도 하지 않아요.
 */
export function presenceChange(
  room: string,
  count: Headcount,
  nowMs: number,
): { kind: "ignore" } | { kind: "delete"; room: string } | { kind: "upsert"; row: PresenceRow } {
  const patients = cleanCount(count.patients);
  const visitors = cleanCount(count.visitors);
  if (!ROOM_PATTERN.test(room) || patients === null || visitors === null) return { kind: "ignore" };
  if (patients + visitors === 0) return { kind: "delete", room };
  return { kind: "upsert", row: { room, patients, visitors, at: nowMs } };
}

/** 공개 통계예요. 숫자만 있어요. */
export interface PresenceTally {
  online: number;
  wards: number;
  /** 오래돼서 세지 않은 병실이에요. directory가 지워요. */
  stale: string[];
}

/** 병실별 인원을 더해요. 문병객도 접속자에 넣어요. 오래된 병실과 빈 병실은 세지 않아요. */
export function tally(rows: readonly PresenceRow[], nowMs: number): PresenceTally {
  let online = 0;
  let wards = 0;
  const stale: string[] = [];
  for (const row of rows) {
    if (nowMs - row.at > PRESENCE_STALE_MS) {
      stale.push(row.room);
      continue;
    }
    const people = total(row);
    if (people <= 0) continue;
    online += people;
    wards++;
  }
  return { online, wards, stale };
}

/** 공개 응답의 시각이에요. 밀리초는 빼고 UTC로 적어요. */
export function statsTimestamp(nowMs: number): string {
  return new Date(Math.floor(nowMs / 1000) * 1000).toISOString().replace(".000Z", "Z");
}
