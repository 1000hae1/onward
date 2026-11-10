import { createButton, createEmojiButton, createText } from "./widgets";

/** 수면 모드에서 들리는 바람결 소리의 크기예요. 아주 작게 들려요. */
const SOUND_VOLUME = 0.035;

export interface SleepModeOptions {
  /** 잠들기 버튼이 들어갈 곳이에요. */
  buttonRoot: HTMLElement;
  /** 화면을 덮는 어두운 막이에요. */
  overlay: HTMLElement;
  onChange(sleeping: boolean): void;
}

export interface SleepMode {
  readonly sleeping: boolean;
  /** 누워 있을 때만 잠들기 버튼을 보여 줘요. 일어나면 수면 모드도 끝나요. */
  setLying(lying: boolean): void;
  wake(): void;
}

type WakeLockLike = { release(): Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } };

/** 눈 오는 밤의 아주 작은 바람결 소리예요. 소리 파일 없이 걸러 낸 잡음으로 만들어요. */
function createSnowSound(): { stop(): void } | null {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  const seconds = 4;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  // 낮은 소리가 많은 잡음이에요. 귀에 거슬리지 않고 멀리서 바람이 스치는 느낌이에요.
  let last = 0;
  for (let index = 0; index < data.length; index++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[index] = last * 3.5;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(SOUND_VOLUME, context.currentTime + 3);
  // 바람이 천천히 오가는 것처럼 크기가 아주 조금씩 바뀌어요.
  const sway = context.createOscillator();
  sway.frequency.value = 0.07;
  const swayDepth = context.createGain();
  swayDepth.gain.value = SOUND_VOLUME * 0.4;
  sway.connect(swayDepth).connect(gain.gain);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  sway.start();
  return {
    stop() {
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.6);
      window.setTimeout(() => void context.close(), 800);
    },
  };
}

/** 누워 있을 때 고를 수 있는 수면 모드예요. 화면을 아주 어둡게 하고 작은 소리만 남겨요. */
export function createSleepMode(options: SleepModeOptions): SleepMode {
  const { buttonRoot, overlay, onChange } = options;
  let sleeping = false;
  let lying = false;
  let sound: { stop(): void } | null = null;
  let wakeLock: WakeLockLike | null = null;
  const wakeLockApi = (navigator as WakeLockNavigator).wakeLock;

  const sleepButton = createEmojiButton("🌙", "잠들기", () => setSleeping(true));
  sleepButton.classList.add("sleep-button");
  buttonRoot.append(sleepButton);
  buttonRoot.hidden = true;

  const wakeButton = createButton("깨어나기", () => setSleeping(false));
  const hint = createText(
    "p",
    wakeLockApi
      ? "밤새 화면이 꺼지지 않아요. 충전기를 연결해 두면 편해요."
      : "화면이 꺼지면 연결이 끊겨 잠시 뒤 침대가 비워질 수 있어요.",
  );
  hint.className = "sleep-hint";
  overlay.append(wakeButton, hint);
  overlay.hidden = true;

  /** 화면 꺼짐 방지는 화면이 다시 보일 때 풀려 있을 수 있어서 그때 다시 청해요. */
  const holdScreen = async (): Promise<void> => {
    if (!wakeLockApi || !sleeping || document.visibilityState !== "visible") return;
    try {
      wakeLock = await wakeLockApi.request("screen");
    } catch {
      wakeLock = null;
    }
  };
  document.addEventListener("visibilitychange", () => void holdScreen());

  function setSleeping(next: boolean): void {
    if (sleeping === next) return;
    if (next && !lying) return;
    sleeping = next;
    overlay.hidden = !next;
    buttonRoot.hidden = next || !lying;
    if (next) {
      sound = createSnowSound();
      void holdScreen();
    } else {
      sound?.stop();
      sound = null;
      void wakeLock?.release().catch(() => undefined);
      wakeLock = null;
    }
    onChange(next);
  }

  return {
    get sleeping() {
      return sleeping;
    },
    setLying(next) {
      if (lying === next) return;
      lying = next;
      if (!next) setSleeping(false);
      buttonRoot.hidden = sleeping || !lying;
    },
    wake() {
      setSleeping(false);
    },
  };
}
