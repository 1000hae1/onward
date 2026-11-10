import { fiveLeafAllowed } from "../../shared/left-blessings";

/**
 * 오잎클로버를 오늘 놓았는지 화면이 기억해요. 선물 고르기 창에서 버튼을 흐리게 하는 데만 써요.
 * 하루 한 번인지 정하는 것은 서버예요. 서버가 알려 준 값(snapshot, 내 선물 event, 거절)으로만 고쳐요.
 */
export interface FiveLeafMemory {
  /** today는 한국 날짜("2026-11-10")예요. */
  used(today: string): boolean;
  mark(today: string): void;
  clear(): void;
}

const STORAGE_KEY = "onward.fiveLeafDay";

type DayStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createFiveLeafMemory(storage: DayStorage | null): FiveLeafMemory {
  let lastDay: string | null = null;
  try {
    lastDay = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    lastDay = null;
  }
  const save = (): void => {
    try {
      if (lastDay === null) storage?.removeItem(STORAGE_KEY);
      else storage?.setItem(STORAGE_KEY, lastDay);
    } catch {
      // 저장할 수 없어도 이 화면에서는 기억해요.
    }
  };
  return {
    used: (today) => !fiveLeafAllowed(lastDay, today),
    mark(today) {
      lastDay = today;
      save();
    },
    clear() {
      lastDay = null;
      save();
    },
  };
}
