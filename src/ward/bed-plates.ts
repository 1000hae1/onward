import { Vector3 } from "three";
import type { Camera } from "three";
import { BEDS, bedFootSpot, roomAt } from "../../shared/ward-layout";

/**
 * 침대 발치의 이름표예요. 누가 어느 침대에 누웠는지는 서버가 정한 값(guest.bed)을 따라요.
 * 닉네임은 textContent로만 넣어요.
 */

export interface PlateSource {
  nickname: string;
  bed: number | null;
  outfit: "patient" | "visitor";
}

/**
 * 침대 번호마다 걸 닉네임이에요. 환자복을 입고 침대를 받은 사람만 걸려요.
 * 내 침대가 서버가 아는 다른 분의 침대와 겹치면 서버 쪽을 따라요.
 */
export function bedPlates(
  others: readonly PlateSource[],
  me: { nickname: string; bed: number | null } | null,
): Map<number, string> {
  const plates = new Map<number, string>();
  for (const guest of others) {
    if (guest.outfit !== "patient" || guest.bed === null || plates.has(guest.bed)) continue;
    plates.set(guest.bed, guest.nickname);
  }
  if (me && me.bed !== null && !plates.has(me.bed)) plates.set(me.bed, me.nickname);
  return plates;
}

/** 이 침대의 이름표를 지금 보여 줄지예요. 같은 병실 안에서, 너무 멀지 않을 때만 보여요. */
export function plateVisible(bed: number, viewer: { x: number; z: number }, maxDistance: number): boolean {
  const spot = BEDS[bed];
  const room = roomAt(viewer.x, viewer.z);
  if (!room || room.index !== spot.roomIndex) return false;
  const foot = bedFootSpot(spot);
  return Math.hypot(foot.x - viewer.x, foot.z - viewer.z) <= maxDistance;
}

const PLATE_DISTANCE = 9;

export interface BedPlatesView {
  /** 걸 이름표를 바꿔요. 같은 내용이면 아무것도 하지 않아요. */
  sync(plates: ReadonlyMap<number, string>): void;
  update(camera: Camera, viewer: { x: number; z: number }): void;
}

export function createBedPlatesView(root: HTMLElement): BedPlatesView {
  const shown = new Map<number, { element: HTMLElement; name: string; x: number; y: number; hidden: boolean }>();
  const point = new Vector3();

  return {
    sync(plates) {
      for (const [bed, plate] of shown) {
        if (plates.has(bed)) continue;
        plate.element.remove();
        shown.delete(bed);
      }
      for (const [bed, name] of plates) {
        const existing = shown.get(bed);
        if (existing) {
          if (existing.name !== name) {
            existing.name = name;
            existing.element.textContent = name;
          }
          continue;
        }
        const element = document.createElement("p");
        element.className = "bed-plate";
        element.textContent = name;
        element.hidden = true;
        root.append(element);
        shown.set(bed, { element, name, x: NaN, y: NaN, hidden: true });
      }
    },
    update(camera, viewer) {
      for (const [bed, plate] of shown) {
        let hidden = !plateVisible(bed, viewer, PLATE_DISTANCE);
        if (!hidden) {
          const foot = bedFootSpot(BEDS[bed]);
          point.set(foot.x, foot.y, foot.z).project(camera);
          hidden = point.z > 1;
          if (!hidden) {
            const x = Math.round(((point.x + 1) / 2) * window.innerWidth);
            const y = Math.round(((1 - point.y) / 2) * window.innerHeight);
            if (x !== plate.x || y !== plate.y) {
              plate.x = x;
              plate.y = y;
              plate.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
            }
          }
        }
        if (hidden !== plate.hidden) {
          plate.hidden = hidden;
          plate.element.hidden = hidden;
        }
      }
    },
  };
}
