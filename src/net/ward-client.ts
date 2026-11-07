import {
  parseMessage,
  PING,
  PONG,
  PROTOCOL_VERSION,
  serverMessageSchema,
} from "../../shared/protocol";
import type { ClientMessage, ServerMessage, WardEvent } from "../../shared/protocol";
import type { NicknameProblem } from "../../shared/nickname";
import type { Profile } from "../ui/profile";
import { MAX_INSTANCE } from "./ward-params";
import type { WardParams } from "./ward-params";

/** 연결을 유지하려고 보내는 간격이에요. 서버는 깨어나지 않고 자동으로 답해요. */
const PING_SECONDS = 30;
const RETRY_SECONDS = [1, 2, 5, 10, 30] as const;
/** 정원이 차면 다음 인스턴스로 넘어가는 횟수예요. */
const MAX_OVERFLOW = 5;
const BED_ANSWER_MS = 5000;
const REPLACED_CODE = 4000;

export type ConnectionStatus = "connecting" | "online" | "offline" | "replaced" | "full";

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;
type Denied = Extract<ServerMessage, { type: "action-denied" }>;

export interface WardClientHandlers {
  onSnapshot(snapshot: Snapshot, reconnected: boolean): void;
  onEvent(event: WardEvent): void;
  onCorrected(x: number, z: number): void;
  onNicknameRejected(problem: NicknameProblem): void;
  onDenied(denied: Denied): void;
  onStatus(status: ConnectionStatus, instance: number): void;
}

export interface WardClient {
  readonly online: boolean;
  readonly instance: number;
  /** 들어가거나, 들어간 뒤 모습을 바꿀 때 보내요. */
  hello(profile: Profile): void;
  send(message: DistributiveOmit<ClientMessage, "v">): void;
  /** 침대를 달라고 해요. 서버에 닿지 않을 때는 혼자 쓰는 화면이라 바로 허락해요. */
  askBed(bed: number): Promise<boolean>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 병동 서버와의 연결이에요. 끊기면 잠시 뒤 다시 이어요. */
export function createWardClient(
  params: WardParams,
  guestId: string,
  handlers: WardClientHandlers,
): WardClient {
  let socket: WebSocket | null = null;
  let online = false;
  let everOnline = false;
  let profile: Profile | null = null;
  let instance = params.instance;
  let overflow = 0;
  let retry = 0;
  let stopped = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const bedAnswers = new Map<number, (granted: boolean) => void>();

  const helloMessage = (current: Profile): ClientMessage => ({
    v: PROTOCOL_VERSION,
    type: "hello",
    guestId,
    animal: current.species,
    outfit: current.outfit,
    nickname: current.nickname,
    withCat: current.withCat,
  });

  const rawSend = (message: ClientMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const settleBeds = (granted: boolean): void => {
    for (const answer of bedAnswers.values()) answer(granted);
    bedAnswers.clear();
  };

  const handle = (message: ServerMessage): void => {
    switch (message.type) {
      case "snapshot": {
        const reconnected = everOnline;
        online = true;
        everOnline = true;
        retry = 0;
        handlers.onStatus("online", instance);
        handlers.onSnapshot(message, reconnected);
        return;
      }
      case "event":
        handlers.onEvent(message.event);
        return;
      case "position-corrected":
        handlers.onCorrected(message.x, message.z);
        return;
      case "bed-granted":
      case "bed-unavailable": {
        const answer = bedAnswers.get(message.bedId);
        bedAnswers.delete(message.bedId);
        answer?.(message.type === "bed-granted");
        return;
      }
      case "nickname-rejected":
        handlers.onNicknameRejected(message.problem);
        return;
      case "room-full":
        // 다음 인스턴스로 넘어가요. 연결은 서버가 닫아요.
        overflow++;
        instance = instance >= MAX_INSTANCE ? 1 : instance + 1;
        retry = 0;
        return;
      case "action-denied":
        handlers.onDenied(message);
        return;
    }
  };

  const scheduleRetry = (): void => {
    if (stopped || retryTimer) return;
    const seconds = RETRY_SECONDS[Math.min(retry, RETRY_SECONDS.length - 1)];
    retry++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, seconds * 1000);
  };

  function connect(): void {
    if (stopped || !profile) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?ward=${params.ward}&instance=${instance}`;
    handlers.onStatus("connecting", instance);
    let opened: WebSocket;
    try {
      opened = new WebSocket(url);
    } catch {
      handlers.onStatus("offline", instance);
      scheduleRetry();
      return;
    }
    socket = opened;
    opened.addEventListener("open", () => {
      if (profile) rawSend(helloMessage(profile));
      ping = setInterval(() => {
        if (opened.readyState === WebSocket.OPEN) opened.send(PING);
      }, PING_SECONDS * 1000);
    });
    opened.addEventListener("message", (event) => {
      if (event.data === PONG) return;
      const message = parseMessage(serverMessageSchema, event.data);
      // 맞지 않는 메시지는 무시해요.
      if (message) handle(message);
    });
    opened.addEventListener("close", (event) => {
      if (socket !== opened) return;
      socket = null;
      online = false;
      if (ping) clearInterval(ping);
      ping = null;
      settleBeds(false);
      if (event.code === REPLACED_CODE) {
        // 다른 창에서 같은 사람이 들어왔어요. 이 창은 다시 잇지 않아요.
        stopped = true;
        handlers.onStatus("replaced", instance);
        return;
      }
      if (overflow > 0 && overflow <= MAX_OVERFLOW && event.code !== 1000) {
        connect();
        return;
      }
      if (overflow > MAX_OVERFLOW) {
        stopped = true;
        handlers.onStatus("full", instance);
        return;
      }
      handlers.onStatus("offline", instance);
      scheduleRetry();
    });
  }

  return {
    get online() {
      return online;
    },
    get instance() {
      return instance;
    },
    hello(next) {
      profile = next;
      if (socket?.readyState === WebSocket.OPEN) {
        rawSend(helloMessage(next));
      } else if (!socket && !retryTimer) {
        connect();
      }
    },
    send(message) {
      if (!online) return;
      rawSend({ v: PROTOCOL_VERSION, ...message } as ClientMessage);
    },
    askBed(bed) {
      if (!online) return Promise.resolve(true);
      bedAnswers.get(bed)?.(false);
      return new Promise((resolve) => {
        bedAnswers.set(bed, resolve);
        rawSend({ v: PROTOCOL_VERSION, type: "lie-down", bedId: bed });
        setTimeout(() => {
          if (bedAnswers.get(bed) === resolve) {
            bedAnswers.delete(bed);
            resolve(false);
          }
        }, BED_ANSWER_MS);
      });
    },
  };
}
