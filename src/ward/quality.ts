/**
 * 그리기 품질을 정하는 순수 함수예요. 화면(scene.ts)은 이 결과만 따라요.
 *
 * - 보통: 픽셀 비율 최대 2(휴대폰은 1.75), 안티에일리어싱, 눈 입자 전부
 * - 가볍게: 픽셀 비율 최대 1.5, 안티에일리어싱 끔, 눈 입자 1/3, 먼 곳의 동물은 몸만
 * 그림자는 원래 쓰지 않아요.
 */

export type Quality = "normal" | "light";
/** 설정에서 고른 값이에요. auto면 처음 5초의 프레임 속도와 기기 정보로 정해요. */
export type QualityChoice = "auto" | Quality;

export interface DeviceHints {
  /** navigator.deviceMemory(GB)예요. 브라우저가 알려 주지 않으면 없어요. */
  deviceMemory?: number;
  /** navigator.hardwareConcurrency예요. */
  cores?: number;
}

/** 프레임 속도를 재는 시간이에요. */
export const PROBE_SECONDS = 5;
/** 처음 불러오는 동안은 느려서 빼고 재요. */
export const PROBE_SKIP_SECONDS = 0.5;
/** 이보다 느리면 가볍게 그려요. */
export const LIGHT_BELOW_FPS = 40;
/** 코어가 적은 기기는 이보다 느리면 가볍게 그려요. */
export const LIGHT_BELOW_FPS_FEW_CORES = 50;
/** 가볍게 그리는 중에는 이만큼 빨라야 보통으로 돌아가요. 오락가락하지 않게 해요. */
export const NORMAL_FROM_FPS = 55;
/** 가볍게 그릴 때 이보다 먼 동물은 몸만 그려요(미터). */
export const SIMPLE_AVATAR_DISTANCE = 9;

const PIXEL_RATIO_LIGHT = 1.5;
const PIXEL_RATIO_NORMAL = 2;
const PIXEL_RATIO_NORMAL_PHONE = 1.75;

/** 재 보지 않아도 가볍게 그려야 하는 기기예요. */
export function hintsSayLight(hints: DeviceHints): boolean {
  return (hints.deviceMemory !== undefined && hints.deviceMemory <= 2) || (hints.cores !== undefined && hints.cores <= 2);
}

/**
 * 화면을 처음 만들 때의 품질이에요. 안티에일리어싱은 이때 정한 값을 바꿀 수 없어서,
 * 지난번에 잰 결과(lastAuto)를 먼저 따라요.
 */
export function startQuality(choice: QualityChoice, hints: DeviceHints, lastAuto: Quality | null): Quality {
  if (choice !== "auto") return choice;
  if (hintsSayLight(hints)) return "light";
  return lastAuto ?? "normal";
}

/** 처음 5초 동안 잰 프레임 속도로 품질을 정해요. 지금 품질에 따라 기준을 조금 달리해요. */
export function judgeQuality(fps: number, hints: DeviceHints, current: Quality): Quality {
  if (hintsSayLight(hints)) return "light";
  if (current === "light") return fps >= NORMAL_FROM_FPS ? "normal" : "light";
  if (fps < LIGHT_BELOW_FPS) return "light";
  if (hints.cores !== undefined && hints.cores <= 4 && fps < LIGHT_BELOW_FPS_FEW_CORES) return "light";
  return "normal";
}

export function pixelRatioFor(quality: Quality, devicePixelRatio: number, phone: boolean): number {
  const cap = quality === "light" ? PIXEL_RATIO_LIGHT : phone ? PIXEL_RATIO_NORMAL_PHONE : PIXEL_RATIO_NORMAL;
  return Math.min(Math.max(devicePixelRatio, 1), cap);
}

/** 눈 입자를 얼마나 그릴지예요. 가볍게 보기나 움직임 줄이기면 1/3이에요. */
export function snowFraction(quality: Quality, reducedMotion: boolean): number {
  return quality === "light" || reducedMotion ? 1 / 3 : 1;
}

/** 움직임 줄이기면 눈이 멈추지 않고 천천히 내려요. */
export function snowSpeed(reducedMotion: boolean): number {
  return reducedMotion ? 0.35 : 1;
}

/** 이 거리의 동물을 몸만 그릴지예요. */
export function simpleAvatarAt(quality: Quality, distance: number): boolean {
  return quality === "light" && distance > SIMPLE_AVATAR_DISTANCE;
}

export interface FpsProbe {
  /** 프레임마다 실제 걸린 시간(초)을 넣어요. 다 재면 평균 fps를 한 번 돌려주고, 그 뒤로는 null이에요. */
  add(seconds: number): number | null;
  /** 탭이 숨겨졌다 돌아오면 처음부터 다시 재요. */
  restart(): void;
  readonly done: boolean;
}

export function createFpsProbe(seconds = PROBE_SECONDS, skip = PROBE_SKIP_SECONDS): FpsProbe {
  let elapsed = 0;
  let measured = 0;
  let frames = 0;
  let done = false;
  return {
    add(dt) {
      if (done || !(dt > 0)) return null;
      elapsed += dt;
      if (elapsed <= skip) return null;
      measured += dt;
      frames++;
      if (measured < seconds) return null;
      done = true;
      return frames / measured;
    },
    restart() {
      if (done) return;
      elapsed = 0;
      measured = 0;
      frames = 0;
    },
    get done() {
      return done;
    },
  };
}
