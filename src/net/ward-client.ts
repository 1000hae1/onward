import {
  MAX_SERVER_MESSAGE_CHARS,
  parseMessage,
  PING,
  PONG,
  PROTOCOL_VERSION,
  serverMessageSchema,
} from "../../shared/protocol";
import type { ClientMessage, ServerMessage, WardEvent } from "../../shared/protocol";
import type { NicknameProblem } from "../../shared/nickname";
import { readVersion } from "../../shared/ward-rules";
import type { Profile } from "../ui/profile";
import { loadGuestToken, MAX_INSTANCE, saveGuestToken } from "./ward-params";
import type { WardParams } from "./ward-params";

/** 연결을 유지하려고 보내는 간격이에요. 서버는 깨어나지 않고 자동으로 답해요. */
const PING_SECONDS = 30;
/** 끊기면 1초, 2초, 4초… 최대 30초 간격으로 다시 이어요. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(30, 2 ** attempt);
}
/** hello를 보낸 뒤 이만큼 답이 없으면 연결을 닫고 다시 이어요. "연결 중"에 멈춰 있지 않게요. */
export const HELLO_ANSWER_MS = 8000;
/** 직접 닫았어요. hello에 답이 없었어요. */
const NO_ANSWER_CODE = 4100;

/** hello에 대한 서버의 답인지예요. 이 가운데 하나가 오면 기다리기를 그만둬요. */
export function answersHello(type: ServerMessage["type"]): boolean {
  return (
    type === "snapshot" ||
    type === "nickname-rejected" ||
    type === "visit-denied" ||
    type === "room-full" ||
    type === "entry-denied" ||
    type === "entry-failed" ||
    type === "version-mismatch"
  );
}

/** 정원이 차면 다음 인스턴스로 넘어가는 횟수예요. */
const MAX_OVERFLOW = 5;
const BED_ANSWER_MS = 5000;
const REPLACED_CODE = 4000;
/** 서버가 들어올 수 없다고 닫았어요. 다시 잇지 않아요. */
const DENIED_CODE = 4003;

/**
 * offline은 한 번도 닿지 못한 때, reconnecting은 이어졌다가 끊긴 때예요.
 * outdated는 화면과 서버의 버전이 달라 새로고침이 필요한 때예요.
 */
export type ConnectionStatus =
  | "connecting"
  | "online"
  | "offline"
  | "reconnecting"
  | "replaced"
  | "full"
  | "outdated"
  /** 오래 입력이 없어 이 화면이 연결을 잠시 닫았어요. 누르면 다시 이어요. */
  | "paused"
  /** 운영자가 입장을 막았어요. */
  | "blocked"
  /** 새 게스트를 너무 많이 만들어 잠시 들어올 수 없어요. */
  | "limited";

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;
type Denied = Extract<ServerMessage, { type: "action-denied" }>;

export interface WardClientHandlers {
  onSnapshot(snapshot: Snapshot, reconnected: boolean): void;
  onEvent(event: WardEvent): void;
  onCorrected(x: number, z: number): void;
  onNicknameRejected(problem: NicknameProblem): void;
  onDenied(denied: Denied): void;
  onLeftBlessings(message: Extract<ServerMessage, { type: "left-blessings" }>): void;
  onLeftSaved(): void;
  onStatus(status: ConnectionStatus, instance: number): void;
  /** 문병 링크로 들어오지 못했어요. closed면 일반 입장으로 이어졌고, busy면 들어가지 않았어요. */
  onVisitDenied(reason: "closed" | "busy"): void;
  onVisitLink(status: Extract<ServerMessage, { type: "visit-link" }>): void;
  onVisitorArrived(nickname: string): void;
  /** 운영자가 내 닉네임을 자동 닉네임으로 되돌렸어요. */
  onNicknameReset(nickname: string): void;
  onReportResult(result: Extract<ServerMessage, { type: "report-result" }>["result"]): void;
  /** 누군가 나를 안아 주려고 해요. fromId는 공개 번호예요. */
  onHugOffer(requestId: string, fromId: string): void;
  /** 내가 보낸 안아 주기에 상대가 [다음에요]를 눌렀어요. */
  onHugDeclined(): void;
  /** 퇴원을 받아 줬어요. until까지 배웅을 모아요(서버 시각). */
  onDischargeStarted(until: number): void;
  onFarewellCount(count: number): void;
  /** 받은 메시지의 종류예요. ?debug=1 표시에만 써요. event는 "event:join"처럼 알려 줘요. */
  onMessageType?(kind: string): void;
}

export interface WardClient {
  readonly online: boolean;
  /** 서버 시계로 맞춘 지금 시각이에요. 아직 닿지 못했으면 이 기기의 시각이에요. */
  serverNow(): number;
  readonly instance: number;
  /** 들어가거나, 들어간 뒤 모습을 바꿀 때 보내요. */
  hello(profile: Profile): void;
  send(message: DistributiveOmit<ClientMessage, "v">): void;
  /** 침대를 달라고 해요. 서버에 닿지 않을 때는 혼자 쓰는 화면이라 바로 허락해요. */
  askBed(bed: number): Promise<boolean>;
  /** 문병 링크로 들어갈 병동과 토큰이에요. hello를 보내기 전에 정해요. null이면 일반 입장이에요. */
  setVisit(visit: { token: string; ward: number; instance: number } | null): void;
  readonly ward: number;
  /** 오래 입력이 없을 때 연결을 닫아요. 다시 잇지 않고 resume을 기다려요. */
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** 퇴원처럼 스스로 나갈 때 연결을 닫고 다시 잇지 않아요. */
  leave(): void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 병동 서버와의 연결이에요. 끊기면 잠시 뒤 다시 이어요. */
export function createWardClient(
  params: WardParams,
  handlers: WardClientHandlers,
): WardClient {
  let socket: WebSocket | null = null;
  /** 서버가 서명해 준 토큰이에요. 처음이면 null이고, 서버가 보내 주면 저장해요. */
  let token = loadGuestToken();
  let online = false;
  let everOnline = false;
  let profile: Profile | null = null;
  let instance = params.instance;
  let ward = params.ward;
  /** 문병 링크 토큰이에요. 서버가 받거나 거절하면 지워서 다시 이을 때 보내지 않아요. */
  let visitToken: string | null = null;
  let overflow = 0;
  let retry = 0;
  let stopped = false;
  let paused = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** hello의 답을 기다리는 타이머예요. */
  let answerTimer: ReturnType<typeof setTimeout> | null = null;
  const stopWaiting = (): void => {
    if (answerTimer) clearTimeout(answerTimer);
    answerTimer = null;
  };
  /** 서버 시각에서 이 기기 시각을 뺀 값이에요. */
  let clockOffset = 0;
  const bedAnswers = new Map<number, (granted: boolean) => void>();

  const helloMessage = (current: Profile): ClientMessage => ({
    v: PROTOCOL_VERSION,
    type: "hello",
    ...(token ? { token } : {}),
    animal: current.species,
    outfit: current.outfit,
    nickname: current.nickname,
    withCat: current.withCat,
    hugsOff: current.hugsOff,
    ...(visitToken ? { visitToken } : {}),
  });

  const rawSend = (message: ClientMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  /** 들어가려고 hello를 보내요. 아직 들어가지 않았으면 답을 기다리고, 없으면 다시 이어요. */
  const sendHello = (current: Profile): void => {
    const opened = socket;
    rawSend(helloMessage(current));
    if (online || !opened) return;
    stopWaiting();
    answerTimer = setTimeout(() => {
      answerTimer = null;
      if (socket !== opened || online) return;
      try {
        opened.close(NO_ANSWER_CODE, "no-answer");
      } catch {
        // 이미 닫혔으면 그대로예요.
      }
    }, HELLO_ANSWER_MS);
  };

  const settleBeds = (granted: boolean): void => {
    for (const answer of bedAnswers.values()) answer(granted);
    bedAnswers.clear();
  };

  const handle = (message: ServerMessage): void => {
    if (answersHello(message.type)) stopWaiting();
    switch (message.type) {
      case "snapshot": {
        const reconnected = everOnline;
        clockOffset = message.serverNow - Date.now();
        overflow = 0;
        online = true;
        everOnline = true;
        retry = 0;
        // 받아들여졌으면 30초 안에 다시 이어도 서버가 역할을 기억해요. 토큰을 다시 보낼 필요가 없어요.
        if (!message.visit) visitToken = null;
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
        // 서버가 알려 준 다음 병실로 넘어가요. 연결은 서버가 닫아요.
        overflow++;
        instance = Math.min(MAX_INSTANCE, message.next);
        retry = 0;
        return;
      case "version-mismatch":
        outdated();
        return;
      case "action-denied":
        handlers.onDenied(message);
        return;
      case "left-blessings":
        handlers.onLeftBlessings(message);
        return;
      case "left-saved":
        handlers.onLeftSaved();
        return;
      case "visit-denied":
        if (message.reason === "closed") visitToken = null;
        handlers.onVisitDenied(message.reason);
        return;
      case "visit-link":
        handlers.onVisitLink(message);
        return;
      case "visitor-arrived":
        handlers.onVisitorArrived(message.nickname);
        return;
      case "guest-token":
        token = message.token;
        saveGuestToken(message.token);
        return;
      case "entry-denied":
        // 다시 이어도 들어올 수 없으니 멈춰요. 연결은 서버가 닫아요.
        stopped = true;
        online = false;
        handlers.onStatus(message.reason, instance);
        return;
      case "entry-failed":
        // 서버가 닫으면 close에서 다시 이어요.
        return;
      case "nickname-reset":
        handlers.onNicknameReset(message.nickname);
        return;
      case "report-result":
        handlers.onReportResult(message.result);
        return;
      case "hug-offer":
        handlers.onHugOffer(message.requestId, message.fromId);
        return;
      case "hug-declined":
        handlers.onHugDeclined();
        return;
      case "discharge-started":
        handlers.onDischargeStarted(message.until);
        return;
      case "farewell-count":
        handlers.onFarewellCount(message.count);
        return;
    }
  };

  /** 버전이 다르면 다시 이어도 소용없으니 멈추고 새로고침을 부탁해요. */
  const outdated = (): void => {
    stopped = true;
    online = false;
    handlers.onStatus("outdated", instance);
    socket?.close(1000, "outdated");
  };

  const scheduleRetry = (): void => {
    if (stopped || retryTimer) return;
    const seconds = retryDelaySeconds(retry);
    retry++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, seconds * 1000);
  };

  function connect(): void {
    if (stopped || !profile) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?ward=${ward}&instance=${instance}`;
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
      if (profile) sendHello(profile);
      ping = setInterval(() => {
        if (opened.readyState === WebSocket.OPEN) opened.send(PING);
      }, PING_SECONDS * 1000);
    });
    opened.addEventListener("message", (event) => {
      if (event.data === PONG) return;
      const version = readVersion(event.data, MAX_SERVER_MESSAGE_CHARS);
      if (version !== null && version !== PROTOCOL_VERSION) {
        outdated();
        return;
      }
      const message = parseMessage(serverMessageSchema, event.data, MAX_SERVER_MESSAGE_CHARS);
      // 맞지 않는 메시지는 무시해요.
      if (!message) return;
      handlers.onMessageType?.(message.type === "event" ? `event:${message.event.kind}` : message.type);
      handle(message);
    });
    opened.addEventListener("close", (event) => {
      if (socket !== opened) return;
      socket = null;
      online = false;
      stopWaiting();
      if (ping) clearInterval(ping);
      ping = null;
      settleBeds(false);
      if (stopped) return;
      if (paused) {
        handlers.onStatus("paused", instance);
        return;
      }
      if (event.code === DENIED_CODE) {
        // 들어올 수 없다는 메시지를 놓쳤어도 다시 잇지 않아요.
        if (!stopped) handlers.onStatus("blocked", instance);
        stopped = true;
        return;
      }
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
      // 이어졌던 적이 있으면 같은 병실로 다시 이어서 침대와 자리를 돌려받아요.
      handlers.onStatus(everOnline ? "reconnecting" : "offline", instance);
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
    serverNow() {
      return Date.now() + clockOffset;
    },
    get paused() {
      return paused;
    },
    get ward() {
      return ward;
    },
    setVisit(visit) {
      visitToken = visit?.token ?? null;
      if (visit) {
        ward = visit.ward;
        instance = visit.instance;
      }
    },
    leave() {
      stopped = true;
      online = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      socket?.close(1000, "bye");
    },
    pause() {
      if (paused || stopped) return;
      paused = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) socket.close(1000, "idle");
      else handlers.onStatus("paused", instance);
    },
    resume() {
      if (!paused) return;
      paused = false;
      retry = 0;
      // 같은 병실로 다시 이어요. 30초 안이면 침대와 자리를 그대로 돌려받아요.
      if (!socket) connect();
    },
    hello(next) {
      profile = next;
      if (socket?.readyState === WebSocket.OPEN) {
        sendHello(next);
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
