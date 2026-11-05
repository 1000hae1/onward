/**
 * 병동 고양이가 무엇을 할지 정해요. 화면과 상관없는 순수 함수이고, 시드가 같으면 결과도 같아요.
 *
 * 위치를 계속 내놓는 대신 "언제 어디로 간다"는 계획이 바뀔 때만 새 값을 돌려줘요. 그래서 서버를 붙이면
 * Durable Object가 이 함수를 그대로 돌리고, 계획이 바뀔 때만 모두에게 알리면 같은 위치로 보여요.
 */

export type CatPlan =
  /** 바닥에서 쉬어요. */
  | { kind: "pause"; until: number }
  /** spot번째 자리로 걸어가요. */
  | { kind: "stroll"; spot: number }
  /** 침대 곁으로 걸어가요. visit이면 누워 있는 사람을 찾아가는 길이에요. */
  | { kind: "toBed"; bed: number; purpose: CatPurpose }
  /** 침대 위에 있어요. until이 null이면 찾아간 사람이 일어날 때까지 머물러요. */
  | { kind: "onBed"; bed: number; purpose: CatPurpose; until: number | null }
  /** 침대에서 내려와요. */
  | { kind: "offBed"; bed: number; until: number };

export type CatPurpose = "rest" | "visit";

export interface CatBrain {
  /** 다음 난수를 만들 상태예요. */
  seed: number;
  plan: CatPlan;
}

export interface CatFacts {
  /** 초 단위의 현재 시각이에요. */
  now: number;
  /** 이 병실의 침대 번호들이에요. */
  beds: readonly number[];
  /** 누가 쓰거나 가고 있는 침대들이에요. */
  takenBeds: readonly number[];
  /** 이 병실에 누워 있는 사람이에요. since는 눕기 시작한 시각이에요. */
  lying: { bed: number; since: number } | null;
  /** 누워 있는 사람 곁에 아무도 없는지예요. 지금은 내 화면만 보니 언제나 혼자예요. */
  alone: boolean;
  /** 걷던 길이 끝났는지예요. */
  arrived: boolean;
  /** 걸어갈 수 있는 자리 수예요. */
  spotCount: number;
}

/** 이만큼 혼자 누워 있으면 고양이가 찾아와요. */
export const CAT_VISIT_AFTER_SECONDS = 120;
export const CAT_HOP_SECONDS = 0.7;
export const CAT_GREET_SECONDS = 1.8;
/** 이만큼 가까워지면 코를 맞대요. */
export const CAT_GREET_DISTANCE = 0.8;
/** 코를 맞댄 뒤 다시 맞대기까지 기다리는 시간이에요. */
export const CAT_GREET_GAP_SECONDS = 45;

const PAUSE_MIN = 6;
const PAUSE_MAX = 16;
const REST_ON_BED_MIN = 30;
const REST_ON_BED_MAX = 70;
/** 쉬고 난 뒤 침대로 갈 확률이에요. */
const BED_CHANCE = 0.25;
const SHORT_PAUSE = 2;

function roll(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let mixed = next;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return { value: ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296, seed: next };
}

function pauseFor(seed: number, now: number): CatBrain {
  const { value, seed: next } = roll(seed);
  return {
    seed: next,
    plan: { kind: "pause", until: now + PAUSE_MIN + value * (PAUSE_MAX - PAUSE_MIN) },
  };
}

export function createCatBrain(seed: number, now: number): CatBrain {
  return pauseFor(seed >>> 0, now);
}

/** 쉬고 난 뒤 다음에 할 일을 골라요. */
function chooseNext(seed: number, facts: CatFacts): CatBrain {
  const first = roll(seed);
  const freeBeds = facts.beds.filter((bed) => !facts.takenBeds.includes(bed));
  const second = roll(first.seed);
  if (first.value < BED_CHANCE && freeBeds.length > 0) {
    const bed = freeBeds[Math.floor(second.value * freeBeds.length)];
    return { seed: second.seed, plan: { kind: "toBed", bed, purpose: "rest" } };
  }
  const spot = Math.floor(second.value * facts.spotCount);
  return { seed: second.seed, plan: { kind: "stroll", spot } };
}

const leaveBed = (brain: CatBrain, bed: number, now: number): CatBrain => ({
  seed: brain.seed,
  plan: { kind: "offBed", bed, until: now + CAT_HOP_SECONDS },
});

/** 지금 사실에 맞는 다음 상태를 돌려줘요. 바뀔 일이 없으면 받은 객체를 그대로 돌려줘요. */
export function decideCat(brain: CatBrain, facts: CatFacts): CatBrain {
  const { plan } = brain;
  const { now, lying, takenBeds } = facts;

  // 오래 혼자 누워 있는 사람을 찾아가는 일이 가장 먼저예요.
  const wanted =
    lying && facts.alone && now - lying.since >= CAT_VISIT_AFTER_SECONDS && facts.beds.includes(lying.bed)
      ? lying.bed
      : null;
  if (wanted !== null) {
    const already =
      (plan.kind === "toBed" || plan.kind === "onBed") &&
      plan.purpose === "visit" &&
      plan.bed === wanted;
    if (!already) {
      if (plan.kind === "onBed") return leaveBed(brain, plan.bed, now);
      if (plan.kind !== "offBed") {
        return { seed: brain.seed, plan: { kind: "toBed", bed: wanted, purpose: "visit" } };
      }
    }
  }

  switch (plan.kind) {
    case "pause":
      return now >= plan.until ? chooseNext(brain.seed, facts) : brain;
    case "stroll":
      return facts.arrived ? pauseFor(brain.seed, now) : brain;
    case "toBed": {
      const stillWanted =
        plan.purpose === "visit" ? lying?.bed === plan.bed : !takenBeds.includes(plan.bed);
      if (!stillWanted) {
        return { seed: brain.seed, plan: { kind: "pause", until: now + SHORT_PAUSE } };
      }
      if (!facts.arrived) return brain;
      if (plan.purpose === "visit") {
        return { seed: brain.seed, plan: { kind: "onBed", bed: plan.bed, purpose: "visit", until: null } };
      }
      const { value, seed } = roll(brain.seed);
      return {
        seed,
        plan: {
          kind: "onBed",
          bed: plan.bed,
          purpose: "rest",
          until: now + REST_ON_BED_MIN + value * (REST_ON_BED_MAX - REST_ON_BED_MIN),
        },
      };
    }
    case "onBed": {
      if (plan.purpose === "visit") {
        return lying?.bed === plan.bed ? brain : leaveBed(brain, plan.bed, now);
      }
      // 쉬던 침대에 사람이 오면 비켜 줘요.
      if (takenBeds.includes(plan.bed)) return leaveBed(brain, plan.bed, now);
      return plan.until !== null && now >= plan.until ? leaveBed(brain, plan.bed, now) : brain;
    }
    case "offBed":
      return now >= plan.until ? pauseFor(brain.seed, now) : brain;
  }
}

/** 코를 맞대도 되는지 알려 줘요. 침대 위에 있거나 오르내리는 중이면 안 돼요. */
export function catCanGreet(plan: CatPlan): boolean {
  return plan.kind === "pause" || plan.kind === "stroll";
}

export function shouldGreet(distance: number, now: number, lastGreet: number | null): boolean {
  if (distance > CAT_GREET_DISTANCE) return false;
  return lastGreet === null || now - lastGreet >= CAT_GREET_GAP_SECONDS;
}

/** 코를 맞대는 동안 멈춰 서요. */
export function startGreet(brain: CatBrain, now: number): CatBrain {
  return { seed: brain.seed, plan: { kind: "pause", until: now + CAT_GREET_SECONDS } };
}
