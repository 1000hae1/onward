/**
 * 처음 들어온 분에게 병아리 간호사가 한 단계씩 알려 주는 첫 안내예요. 화면과 상관없는 순수 함수예요.
 * 안내는 내 화면에서만 보이고 서버에는 아무것도 보내지 않아요.
 */
import { BEDS } from "../../shared/ward-layout";

/** 이 기기에 안내를 끝냈는지(또는 건너뛰었는지) 적어 두는 이름이에요. */
export const ONBOARDING_KEY = "onward.onboarding";

export type OnboardingRecord = "done" | "skipped";
export type OnboardingStep = 1 | 2 | 3;

export type OnboardingState =
  | { kind: "off" }
  | { kind: "step"; step: OnboardingStep }
  /** "편히 쉬다 가세요" 한마디를 하는 중이에요. 끝나면 간호사가 제자리로 돌아가요. */
  | { kind: "farewell" };

export type OnboardingEvent =
  /** 서버가 내 침대를 정해 주었어요. */
  | "bed-owned"
  /** 평안을 한 번 빌었어요(침대, 사람, 자리에 없는 분 모두). */
  | "blessed"
  /** 방명록 링크를 복사하거나 보냈어요. */
  | "link-shared"
  /** [다음에 할게요]를 눌렀어요. */
  | "later"
  /** [건너뛰기]를 눌렀어요. 이 단계만 넘기고 다음 단계로 가요. */
  | "skip"
  /** [안내 그만 보기]를 눌렀어요. 안내를 바로 끝내요. */
  | "quit";

export const OFF: OnboardingState = { kind: "off" };

export const ONBOARDING_TEXT = {
  step1: "빈 침대를 눌러 보세요",
  /** 병실 밖(로비, 복도, 바깥)에 있으면 1단계 아래에 덧붙여요. */
  step1Lobby: "병실에 들어가면 빈 침대가 보여요",
  step2: "옆 침대 분께 평안을 빌어 보세요",
  step2Alone: "빈 침대에도 평안을 남길 수 있어요. 다음에 눕는 분께 닿아요",
  step3: "보고 싶은 얼굴들에게 사과나무를 보내 보세요",
  step3Open: "🍎 내 사과나무",
  step3Later: "다음에 할게요",
  farewell: "편히 쉬다 가세요",
  skip: "건너뛰기",
  quit: "안내 그만 보기",
  /** 설정 메뉴의 버튼 이름이에요. */
  replay: "안내 다시 보기",
} as const;

/** 저장해 둔 기록을 읽어요. 모르는 값이면 기록이 없는 것으로 봐요. */
export function parseOnboardingRecord(raw: string | null): OnboardingRecord | null {
  return raw === "done" || raw === "skipped" ? raw : null;
}

export type OnboardingStart = "start" | "mark-done" | "none";

/**
 * 들어올 때 안내를 시작할지 정해요.
 * - 방명록·문병 링크로 왔으면 시작하지 않아요.
 * - 이미 끝냈거나 건너뛰었으면 다시 나오지 않아요.
 * - 기록은 없지만 "돌아왔네요"로 들어온 분(이 기능 전부터 오던 분)은 보여 주지 않고 끝낸 것으로 적어요.
 */
export function onboardingStart(input: { record: OnboardingRecord | null; returning: boolean; viaLink: boolean }): OnboardingStart {
  if (input.viaLink || input.record !== null) return "none";
  return input.returning ? "mark-done" : "start";
}

/** 처음 보여 줄 단계예요. 침대에 누울 수 없는 문병객이거나 이미 내 침대가 있으면 2단계부터예요. */
export function firstStep(input: { canLie: boolean; ownsBed: boolean }): OnboardingStep {
  return !input.canLie || input.ownsBed ? 2 : 1;
}

/** 사건이 오면 다음 상태와, 새로 적어 둘 기록(있으면)을 돌려줘요. 맞지 않는 사건은 그대로 둬요. */
export function nextOnboarding(
  state: OnboardingState,
  event: OnboardingEvent,
): { state: OnboardingState; record: OnboardingRecord | null } {
  const stay = { state, record: null };
  if (state.kind !== "step") return stay;
  if (event === "quit") return { state: OFF, record: "skipped" };
  if (event === "skip") {
    // 3단계를 넘기면 마지막 한마디로 마무리해요. 끝까지 본 것으로 적어요.
    if (state.step === 3) return { state: { kind: "farewell" }, record: "done" };
    return { state: { kind: "step", step: state.step === 1 ? 2 : 3 }, record: null };
  }
  if (state.step === 1 && event === "bed-owned") return { state: { kind: "step", step: 2 }, record: null };
  if (state.step === 2 && event === "blessed") return { state: { kind: "step", step: 3 }, record: null };
  if (state.step === 3 && (event === "link-shared" || event === "later")) return { state: { kind: "farewell" }, record: "done" };
  return stay;
}

/** 내 침대와 같은 병실의 다른 침대에 누가 있는지예요. 내 침대가 없으면 false예요. */
export function othersInMyRoom(myBed: number | null, isTakenByOther: (bed: number) => boolean): boolean {
  if (myBed === null || !BEDS[myBed]) return false;
  const room = BEDS[myBed].roomIndex;
  return BEDS.some((bed, index) => index !== myBed && bed.roomIndex === room && isTakenByOther(index));
}

export interface BubbleContent {
  text: string;
  /** 본문 아래 작은 글이에요. 없으면 null이에요. */
  sub: string | null;
  /** 3단계에서만 [내 사과나무]·[다음에 할게요]가 보여요. */
  actions: boolean;
  /** 아래쪽 [안내 그만 보기]·[건너뛰기]가 보이는지예요. 마지막 한마디에는 없어요. */
  skip: boolean;
}

/** 말풍선에 넣을 글이에요. 글자는 화면에 textContent로만 넣어요. */
export function bubbleContent(
  state: OnboardingState,
  context: { inRoom: boolean; othersInRoom: boolean },
): BubbleContent | null {
  if (state.kind === "off") return null;
  if (state.kind === "farewell") return { text: ONBOARDING_TEXT.farewell, sub: null, actions: false, skip: false };
  if (state.step === 1) {
    return { text: ONBOARDING_TEXT.step1, sub: context.inRoom ? null : ONBOARDING_TEXT.step1Lobby, actions: false, skip: true };
  }
  if (state.step === 2) {
    return { text: context.othersInRoom ? ONBOARDING_TEXT.step2 : ONBOARDING_TEXT.step2Alone, sub: null, actions: false, skip: true };
  }
  return { text: ONBOARDING_TEXT.step3, sub: null, actions: true, skip: true };
}

/** 간호사가 나를 따라올 때 서는 거리예요. */
export const GUIDE_DISTANCE = 1.1;

/**
 * 간호사가 설 자리예요. 화면에서 내 오른쪽 옆(카메라의 오른쪽 방향)으로 GUIDE_DISTANCE만큼이에요.
 * 카메라와 나 사이에 서서 화면을 가리지 않게 옆에 서요. right는 바닥 위 방향이고 길이는 상관없어요.
 */
export function guideSpot(
  me: { x: number; z: number },
  right: { x: number; z: number },
  distance = GUIDE_DISTANCE,
): { x: number; z: number } {
  const length = Math.hypot(right.x, right.z);
  if (length < 1e-6) return { x: me.x + distance, z: me.z };
  return { x: me.x + (right.x / length) * distance, z: me.z + (right.z / length) * distance };
}
