import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { Object3D } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ROOM, ROOMS, WINDOW } from "../../shared/ward-layout";
import { smoothstep } from "../avatar/pose";

/** 창문이 다 열리는 데 걸리는 시간이에요. 천천히 열려요. */
const OPEN_SECONDS = 5;
/** 햇빛이 다 들어오는 데 걸리는 시간이에요. */
const SUN_SECONDS = 4;
/** 9시가 지나 조용히 닫힐 때예요. */
const CLOSE_SECONDS = 3;
const SASH_LEFT = 0.8;
const SASH_RIGHT = WINDOW.maxX;
const SASH_SLIDE = SASH_RIGHT - SASH_LEFT;
const SUN_OPACITY = 0.2;
const FLOOR_SUN_OPACITY = 0.16;

export interface MorningWindows {
  /** 창문을 열어요. instant면 연출 없이 열린 채로 둬요. 이미 열려 있으면 그대로예요. */
  open(room: number, instant: boolean): void;
  /** 아침이 지나면 모두 조용히 닫아요. */
  closeAll(instant: boolean): void;
  update(dt: number, stillMotion: boolean): void;
}

/** 병실 창문의 미닫이 한 짝과 아침 햇빛이에요. 아침이 아니면 닫혀 있고 햇빛도 없어요. */
export function createMorningWindows(parent: Object3D): MorningWindows {
  const frameMaterial = new MeshBasicMaterial({ color: "#eef0f0" });
  const glassMaterial = new MeshBasicMaterial({ color: "#dfeef2", transparent: true, opacity: 0.28, depthWrite: false });
  const width = SASH_RIGHT - SASH_LEFT;
  const height = WINDOW.maxY - WINDOW.minY - 0.08;
  const centerY = (WINDOW.minY + WINDOW.maxY) / 2;
  const frameGeometry = new RoundedBoxGeometry(width, 0.06, 0.05, 2, 0.02);
  const sideGeometry = new RoundedBoxGeometry(0.06, height, 0.05, 2, 0.02);
  const glassGeometry = new PlaneGeometry(width - 0.06, height - 0.06);
  // 창에서 바닥으로 비스듬히 내려오는 빛줄기예요.
  const beamGeometry = new PlaneGeometry(WINDOW.maxX - WINDOW.minX, 3.2);
  const floorGeometry = new PlaneGeometry(3.6, 2.6);

  const windows = ROOMS.map((room) => {
    const root = new Group();
    root.position.set(room.x, 0, room.z);
    root.rotation.y = room.rotationY;
    parent.add(root);

    const sash = new Group();
    sash.position.set((SASH_LEFT + SASH_RIGHT) / 2, centerY, ROOM.minZ + 0.06);
    const top = new Mesh(frameGeometry, frameMaterial);
    top.position.y = height / 2;
    const bottom = new Mesh(frameGeometry, frameMaterial);
    bottom.position.y = -height / 2;
    const left = new Mesh(sideGeometry, frameMaterial);
    left.position.x = -width / 2;
    const right = new Mesh(sideGeometry, frameMaterial);
    right.position.x = width / 2;
    const glass = new Mesh(glassGeometry, glassMaterial);
    sash.add(top, bottom, left, right, glass);
    root.add(sash);

    const beamMaterial = new MeshBasicMaterial({
      color: "#ffe7b0",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const beam = new Mesh(beamGeometry, beamMaterial);
    beam.position.set(0, 1.5, ROOM.minZ + 1.1);
    beam.rotation.x = -0.75;
    beam.visible = false;
    const floorMaterial = beamMaterial.clone();
    const floor = new Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.02, ROOM.minZ + 2.4);
    floor.visible = false;
    root.add(beam, floor);

    return { sash, beam, beamMaterial, floor, floorMaterial, progress: 0, goal: 0, rate: 1 / OPEN_SECONDS };
  });

  const draw = (entry: (typeof windows)[number]): void => {
    const slide = smoothstep(0, 1, entry.progress);
    entry.sash.position.x = (SASH_LEFT + SASH_RIGHT) / 2 - slide * SASH_SLIDE;
    // 미닫이가 안쪽 짝 뒤로 지나가도록 살짝 안쪽으로 비켜 줘요.
    entry.sash.position.z = ROOM.minZ + 0.06 + 0.04 * Math.min(1, slide * 4);
    const sun = smoothstep(0.15, 1, Math.min(1, entry.progress * (OPEN_SECONDS / SUN_SECONDS)));
    entry.beamMaterial.opacity = SUN_OPACITY * sun;
    entry.floorMaterial.opacity = FLOOR_SUN_OPACITY * sun;
    entry.beam.visible = sun > 0.001;
    entry.floor.visible = sun > 0.001;
  };

  return {
    open(room, instant) {
      const entry = windows[room];
      if (!entry || entry.goal === 1) return;
      entry.goal = 1;
      entry.rate = 1 / OPEN_SECONDS;
      if (instant) {
        entry.progress = 1;
        draw(entry);
      }
    },
    closeAll(instant) {
      for (const entry of windows) {
        if (entry.goal === 0 && entry.progress === 0) continue;
        entry.goal = 0;
        entry.rate = 1 / CLOSE_SECONDS;
        if (instant) {
          entry.progress = 0;
          draw(entry);
        }
      }
    },
    update(dt, stillMotion) {
      for (const entry of windows) {
        if (entry.progress === entry.goal) continue;
        const step = stillMotion ? 1 : dt * entry.rate;
        entry.progress =
          entry.goal > entry.progress ? Math.min(entry.goal, entry.progress + step) : Math.max(entry.goal, entry.progress - step);
        draw(entry);
      }
    },
  };
}
