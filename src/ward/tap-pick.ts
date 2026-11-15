/**
 * 화면을 눌렀을 때 무엇을 눌렀는지 정하는 순수 함수예요. 화면과 상관없어서 테스트해요.
 *
 * 누를 수 있는 것은 두 겹이에요.
 * - object: 캐릭터, 고양이, 사과나무, 화분처럼 작은 것이에요. 모양에 꼭 맞는 상자를 써요.
 * - area: 침대, 벤치처럼 큰 것이에요. 누르기 쉽게 모양보다 넉넉한 보이지 않는 상자를 써요.
 * 넉넉한 상자는 보이지 않으니 앞뒤를 가리는 데 쓰지 않아요. 큰 것의 실제 몸통(cover)에 시선이 먼저 닿을 때만
 * 큰 것이 앞이에요. 그래서 침대 위 고양이나 침대 옆 사과나무를 누르면 그것이 골라지고,
 * 침대 몸통 뒤에 가려진 것을 누르면 침대가 골라져요.
 */

/** 손가락이 이만큼 움직이면 화면 돌리기예요. */
export const TAP_MAX_MOVE_PX = 10;
/** 이보다 오래 누르면 탭이 아니에요. */
export const TAP_MAX_MS = 300;

/** 시선이 상자에 들어간 비율(enter)과 나온 비율(exit)이에요. 0에 가까울수록 카메라 앞이에요. */
export interface TapHit {
  enter: number;
  exit: number;
}

export type TapLayer = "object" | "area";

export interface TapCandidate<T> {
  layer: TapLayer;
  /** 시선이 누르는 상자에 들어간 비율이에요. */
  enter: number;
  /** area만: 시선이 실제로 보이는 몸통에 들어간 비율이에요. 넉넉한 부분만 지나면 null이에요. */
  cover?: number | null;
  value: T;
}

/** 눌린 것 가운데 하나를 골라요. 아무것도 없으면 null이에요. */
export function chooseTap<T>(candidates: readonly TapCandidate<T>[]): TapCandidate<T> | null {
  const front = (layer: TapLayer): TapCandidate<T> | null => {
    let best: TapCandidate<T> | null = null;
    for (const candidate of candidates) {
      if (candidate.layer === layer && (!best || candidate.enter < best.enter)) best = candidate;
    }
    return best;
  };
  const object = front("object");
  const area = front("area");
  if (object && (!area || area.cover == null || object.enter <= area.cover)) return object;
  return area;
}

/**
 * 누르고 뗀 것이 탭인지예요. 누르는 동안 가장 멀리 움직인 거리(maxMovedPx)로 봐요.
 * 손가락이 10px 이상 움직였거나 300ms 넘게 눌렀으면 화면 돌리기나 길게 누르기예요.
 */
export function isTap(maxMovedPx: number, heldMs: number): boolean {
  return maxMovedPx < TAP_MAX_MOVE_PX && heldMs <= TAP_MAX_MS;
}
