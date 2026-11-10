/**
 * 그림책 사과나무의 모양이에요(시안 A). 340×400 그림 좌표이고, 화면과 상관없는 순수 값이라 테스트해요.
 */
import { APPLE_SLOTS } from "../../shared/apple-limits";

export const TREE_WIDTH = 340;
export const TREE_HEIGHT = 400;

export const COLORS = {
  ground: "#EADFC8",
  wood: "#8B6A4E",
  apple: "#E0574F",
  highlight: "#F6A49B",
  leaf: "#5E9A4E",
} as const;

/** 연두 원 6개를 겹친 둥근 수관이에요. 뒤에 있는 원부터 그려요. */
export const CANOPY: readonly { x: number; y: number; r: number; color: string }[] = [
  { x: 108, y: 168, r: 64, color: "#86B575" },
  { x: 232, y: 168, r: 64, color: "#86B575" },
  { x: 170, y: 178, r: 78, color: "#8FBD7D" },
  { x: 132, y: 112, r: 70, color: "#9CC58A" },
  { x: 208, y: 108, r: 70, color: "#9CC58A" },
  { x: 170, y: 82, r: 58, color: "#A9CF95" },
];

/** 수관 안에서 사과가 열리는 범위(타원)예요. 가운데부터 바깥으로 자리를 채워요. */
const FRUIT = { x: 170, y: 140, rx: 104, ry: 92 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** 사과 자리의 가운데예요. 0번은 수관 가운데이고, 번호가 클수록 바깥쪽이에요. */
export function appleSlotPoint(slot: number): { x: number; y: number } {
  const index = ((Math.floor(slot) % APPLE_SLOTS) + APPLE_SLOTS) % APPLE_SLOTS;
  const radius = Math.sqrt((index + 0.6) / APPLE_SLOTS);
  const angle = index * GOLDEN_ANGLE - Math.PI / 2;
  return {
    x: Math.round((FRUIT.x + Math.cos(angle) * radius * FRUIT.rx) * 10) / 10,
    y: Math.round((FRUIT.y + Math.sin(angle) * radius * FRUIT.ry) * 10) / 10,
  };
}

/** 한 점이 수관(연두 원 가운데 하나) 안에 있는지예요. margin만큼 안쪽이어야 해요. */
export function insideCanopy(x: number, y: number, margin = 0): boolean {
  return CANOPY.some((circle) => Math.hypot(x - circle.x, y - circle.y) <= circle.r - margin);
}

/**
 * 링크로 온 사람의 화면에서 다른 사람이 단 사과를 둘 자리예요.
 * 내 사과 자리는 비워 두고, 남은 자리를 0번부터 count만큼 채워요(최대 40개).
 */
export function othersSlots(count: number, mine: readonly number[]): number[] {
  const taken = new Set(mine);
  const others = Math.max(0, Math.min(count, APPLE_SLOTS) - taken.size);
  const slots: number[] = [];
  for (let slot = 0; slot < APPLE_SLOTS && slots.length < others; slot++) {
    if (!taken.has(slot)) slots.push(slot);
  }
  return slots;
}
