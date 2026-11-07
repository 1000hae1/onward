/**
 * 창가 화분이에요. 병실에 모인 평안의 누적 수로 자라요. 줄지 않고, 아무도 오지 않아도 시들지 않아요.
 */

/** 단계가 바뀌는 누적 수예요. 새싹 → 잎 → 줄기 → 봉오리 → 꽃 한 송이 → 꽃 여러 송이. */
export const PLANTER_STAGES = [0, 30, 100, 300, 1000, 3000] as const;
export const PLANTER_STAGE_NAMES = ["새싹", "잎", "줄기", "봉오리", "꽃 한 송이", "꽃 여러 송이"] as const;

/** 누적 수에 맞는 단계예요. 0~5예요. */
export function planterStage(total: number): number {
  let stage = 0;
  for (let index = 0; index < PLANTER_STAGES.length; index++) {
    if (total >= PLANTER_STAGES[index]) stage = index;
  }
  return stage;
}

/** 평안이 모였어요. 음수나 소수는 받지 않아서 줄어드는 일이 없어요. */
export function addPeace(total: number, amount = 1): { total: number; stage: number; grew: boolean } {
  const added = Number.isInteger(amount) && amount > 0 ? amount : 0;
  const next = Math.max(0, total) + added;
  return { total: next, stage: planterStage(next), grew: planterStage(next) > planterStage(total) };
}

/** 세 자리마다 쉼표를 넣어요. 기기 언어 설정과 상관없이 같은 모양이에요. */
export function formatCount(count: number): string {
  return String(Math.max(0, Math.floor(count))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function planterText(total: number): string {
  return `이 병실에 모인 평안 ${formatCount(total)}`;
}
