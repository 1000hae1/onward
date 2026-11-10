/**
 * 간호사실 병아리 간호사의 인사예요. 화면과 상관없는 순수 함수예요.
 * 인사는 내 화면에서만 보이고 서버에는 보내지 않아요.
 */

export const NURSE_WELCOME_TEXT = "어서 오세요. 편히 쉬다 가세요";
export const NURSE_WELCOME_BACK_TEXT = "다시 오셨네요";

/** 이 기기에서 간호사에게 인사를 받은 적이 있는지 적어 두는 이름이에요. */
export const NURSE_MET_KEY = "onward.nurse.met";

/** 처음이면 반기는 인사, 이미 만난 적이 있으면 "다시 오셨네요"예요. */
export function nurseGreeting(metBefore: boolean): string {
  return metBefore ? NURSE_WELCOME_BACK_TEXT : NURSE_WELCOME_TEXT;
}

/** 고개를 숙였다 드는 데 걸리는 시간이에요. */
export const NURSE_BOW_SECONDS = 1.6;
/** 가장 깊이 숙인 각도예요. */
export const NURSE_BOW_ANGLE = 0.42;

/** 인사를 시작한 뒤 seconds초에 숙인 각도예요. 천천히 숙이고 잠시 머문 뒤 천천히 들어요. */
export function nurseBowAngle(seconds: number): number {
  if (seconds <= 0 || seconds >= NURSE_BOW_SECONDS) return 0;
  const t = seconds / NURSE_BOW_SECONDS;
  // 0~0.35 숙이기, 0.35~0.6 머물기, 0.6~1 들기
  const amount = t < 0.35 ? smooth(t / 0.35) : t < 0.6 ? 1 : 1 - smooth((t - 0.6) / 0.4);
  return amount * NURSE_BOW_ANGLE;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 저장소를 읽고 쓰는 곳이에요. 사생활 보호 창처럼 저장할 수 없으면 처음 온 것으로 봐요. */
export interface GreetingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 들어올 때마다 할 인사를 골라 줘요. 만났다고 저장소에 적어 두고,
 * 저장할 수 없을 때도 이번 방문 안에서는 두 번째부터 "다시 오셨네요"예요.
 */
export function createNurseGreeter(store: GreetingStore | null): () => string {
  let metHere = false;
  return () => {
    let met = metHere;
    try {
      met ||= store?.getItem(NURSE_MET_KEY) === "1";
    } catch {
      // 읽지 못하면 이번 방문에서 만났는지만 봐요.
    }
    metHere = true;
    try {
      store?.setItem(NURSE_MET_KEY, "1");
    } catch {
      // 적어 두지 못해도 인사는 해요.
    }
    return nurseGreeting(met);
  };
}
