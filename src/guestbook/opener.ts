/**
 * "내 사과나무"를 여는 과정이에요. 사과나무를 누르거나 설정에서 열 때 같이 써요.
 *
 * 누르는 즉시 기다림 표시를 띄우고, 서버에 내 방명록을 한 번만 물어요. 화면 코드도 함께 불러와요.
 * 서버의 답과 화면 코드가 모두 준비되면 표시를 지우고 화면을 열어요.
 * 3초가 지나면 "조금 오래 걸리고 있어요", 10초가 지나면 "다시 눌러 주세요"로 바꾸고 기다림을 풀어요.
 * 기다리는 동안 다시 눌러도 다시 묻지 않아요.
 * 화면(DOM)과 시계는 밖에서 받아서, 이 파일은 브라우저 없이 테스트해요.
 */
import type { ServerMessage } from "../../shared/protocol";

type GuestbookMessage = Extract<ServerMessage, { type: "guestbook" }>;

export const OPEN_SLOW_MS = 3_000;
export const OPEN_GIVE_UP_MS = 10_000;
/** "다시 눌러 주세요"를 보여 주는 시간이에요. 그 뒤에는 표시를 지워요. */
export const OPEN_RETRY_SHOWN_MS = 2_500;

export const OPEN_GOING_TEXT = "사과나무로 가는 중…";
export const OPEN_SLOW_TEXT = "조금 오래 걸리고 있어요";
export const OPEN_RETRY_TEXT = "다시 눌러 주세요";
export const OPEN_OFFLINE_TEXT = "병동에 다시 이어지면 사과나무를 볼 수 있어요.";

export type OpenStage = "going" | "slow" | "retry";

/** 누른 뒤 지난 시간에 맞는 단계예요. */
export function openStage(elapsedMs: number): OpenStage {
  if (elapsedMs >= OPEN_GIVE_UP_MS) return "retry";
  if (elapsedMs >= OPEN_SLOW_MS) return "slow";
  return "going";
}

const STAGE_TEXT: Record<OpenStage, string> = {
  going: OPEN_GOING_TEXT,
  slow: OPEN_SLOW_TEXT,
  retry: OPEN_RETRY_TEXT,
};

export interface GuestbookOpenerDeps {
  online(): boolean;
  /** 지금 시각(ms)이에요. 화면 코드를 늦게 받지 못했을 때 써요. */
  now(): number;
  /** 서버에 내 방명록을 물어요. 답은 receive로 와요. */
  request(): void;
  /** "내 사과나무" 화면 코드를 불러와요. 이미 불러왔으면 바로 끝나요. */
  loadPanel(): Promise<void>;
  /** 받은 내용으로 화면을 열어요. */
  show(message: GuestbookMessage): void;
  /** 기다림 표시예요. text가 null이면 지워요. busy면 원형 로딩과 사과 흔들기를 보여요. */
  status(text: string | null, busy: boolean): void;
  toast(text: string): void;
}

export interface GuestbookOpener {
  /** 기다리는 중이면 true예요. */
  readonly waiting: boolean;
  /** 열기 시작해요. 이미 기다리는 중이면 아무것도 하지 않고 false예요. */
  start(nowMs: number): boolean;
  /** 서버의 방명록 답이에요. 기다리던 답이면 쓰고 true예요. */
  receive(message: GuestbookMessage): boolean;
  /** 서버가 거절했어요(too-fast 등). 기다리던 중이었으면 풀고 true예요. */
  denied(nowMs: number): boolean;
  /** 매 프레임 불러요. 단계에 맞게 문구를 바꿔요. */
  update(nowMs: number): void;
}

export function createGuestbookOpener(deps: GuestbookOpenerDeps): GuestbookOpener {
  let wait: { startedAt: number; stage: OpenStage; message: GuestbookMessage | null; panelReady: boolean } | null = null;
  /** "다시 눌러 주세요"를 지울 시각이에요. */
  let clearAt: number | null = null;

  const finishIfReady = (): void => {
    if (!wait || !wait.message || !wait.panelReady) return;
    const { message } = wait;
    wait = null;
    clearAt = null;
    deps.status(null, false);
    deps.show(message);
  };

  const giveUp = (nowMs: number): void => {
    wait = null;
    clearAt = nowMs + OPEN_RETRY_SHOWN_MS;
    deps.status(OPEN_RETRY_TEXT, false);
  };

  return {
    get waiting() {
      return wait !== null;
    },
    start(nowMs) {
      if (wait) return false;
      if (!deps.online()) {
        deps.toast(OPEN_OFFLINE_TEXT);
        return false;
      }
      const started = { startedAt: nowMs, stage: "going" as OpenStage, message: null, panelReady: false };
      wait = started;
      clearAt = null;
      deps.status(OPEN_GOING_TEXT, true);
      deps.request();
      void deps.loadPanel().then(
        () => {
          if (wait !== started) return;
          started.panelReady = true;
          finishIfReady();
        },
        () => {
          // 화면 코드를 받지 못했어요(연결이 잠깐 끊겼을 때). 다시 누르면 다시 받아요.
          if (wait === started) giveUp(deps.now());
        },
      );
      return true;
    },
    receive(message) {
      if (!wait) return false;
      wait.message = message;
      finishIfReady();
      return true;
    },
    denied(nowMs) {
      if (!wait) return false;
      giveUp(nowMs);
      return true;
    },
    update(nowMs) {
      if (clearAt !== null && nowMs >= clearAt) {
        clearAt = null;
        deps.status(null, false);
      }
      if (!wait) return;
      const stage = openStage(nowMs - wait.startedAt);
      if (stage === wait.stage) return;
      if (stage === "retry") {
        giveUp(nowMs);
        return;
      }
      wait.stage = stage;
      deps.status(STAGE_TEXT[stage], true);
    },
  };
}
