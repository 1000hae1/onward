import "./onboarding.css";
import { Vector3 } from "three";
import type { Camera } from "three";
import { BEDS } from "../../shared/ward-layout";
import { track } from "../analytics";
import { loadGuestbookFonts } from "./fonts";
import type { NurseGuide } from "../ward/nurse-guide";
import type { Point } from "../ward/movement";
import {
  bubbleContent,
  firstStep,
  nextOnboarding,
  OFF,
  ONBOARDING_KEY,
  ONBOARDING_TEXT,
  onboardingStart,
  othersInMyRoom,
  parseOnboardingRecord,
} from "./onboarding-rules";
import type { BubbleContent, OnboardingEvent, OnboardingRecord, OnboardingState } from "./onboarding-rules";

/**
 * 병아리 간호사의 첫 안내예요. 말풍선은 3D 위에 띄운 HTML이고 글자는 textContent로만 넣어요.
 * 내 화면에서만 보여요. 서버에는 아무것도 보내지 않아요.
 */

/** 마지막 한마디("편히 쉬다 가세요")를 보여 주는 시간이에요. */
const FAREWELL_SECONDS = 3;
/** 머리 꼭대기에서 말풍선 꼬리 끝까지의 높이예요. */
const BUBBLE_LIFT = 0.3;
/** 빈 침대 위 화살표 높이예요. */
const MARKER_Y = 1.25;
/** 화면 가장자리와 하단 버튼에서 띄우는 거리예요. */
const EDGE = 16;
const GAP = 10;
/** 이 화면들이 떠 있으면 말풍선과 표시를 잠시 숨겨요. */
const COVERING = "#guestbook:not([hidden]), #gate:not([hidden]), #intro:not([hidden]), #sleep-overlay:not([hidden]), #entry:not([hidden])";

export interface OnboardingContext {
  me: Point;
  ownedBed: number | null;
  canLie: boolean;
  roomIndex: number | null;
  /** 다른 분이 쓰는 침대인지예요. */
  isTakenByOther(bed: number): boolean;
  /** 내가 고를 수 있는 빈 침대인지예요. */
  isFree(bed: number): boolean;
  /** 내 사과나무가 보이면 그 위 자리를 target에 써요. */
  treeTop(target: Vector3): Vector3 | null;
}

export interface OnboardingOptions {
  root: HTMLElement;
  guide: NurseGuide | null;
  nurseHead(target: Vector3): Vector3 | null;
  read(key: string): string | null;
  write(key: string, value: string | null): void;
  announce(text: string): void;
  highlightPray(on: boolean): void;
  openTree(): void;
  context(): OnboardingContext;
}

export interface Onboarding {
  /** 입장한 뒤 한 번 불러요. 처음 온 분이면 시작하고, 돌아온 분이면 끝낸 것으로 적어요. */
  begin(input: { returning: boolean; viaLink: boolean }): void;
  /** 설정의 [안내 다시 보기]예요. 기록을 지우고 다시 시작해요. */
  replay(): void;
  notify(event: Extract<OnboardingEvent, "blessed" | "link-shared">): void;
  /** 매 프레임 불러요. 간호사를 걸린 뒤 말풍선과 표시를 맞춰요. */
  update(dt: number, camera: Camera, stillMotion: boolean): void;
  /** 안내(마지막 한마디 포함)가 진행 중인지예요. */
  readonly active: boolean;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

export function createOnboarding(options: OnboardingOptions): Onboarding {
  const { root } = options;
  root.className = "ob-root";
  root.hidden = true;

  const bubble = document.createElement("div");
  bubble.className = "ob-bubble";
  bubble.setAttribute("role", "region");
  bubble.setAttribute("aria-label", "병아리 간호사의 안내");
  const text = document.createElement("p");
  text.className = "ob-text";
  const sub = document.createElement("p");
  sub.className = "ob-sub";
  const actions = document.createElement("div");
  actions.className = "ob-actions";
  const openTree = button(ONBOARDING_TEXT.step3Open, "ob-open onboard-glow", () => options.openTree());
  const later = button(ONBOARDING_TEXT.step3Later, "ob-later", () => dispatch("later"));
  actions.append(openTree, later);
  const quit = button(ONBOARDING_TEXT.quit, "ob-quit", () => dispatch("quit"));
  const skip = button(`${ONBOARDING_TEXT.skip} ›`, "ob-skip", () => dispatch("skip"));
  skip.setAttribute("aria-label", "이 단계 건너뛰기");
  const footer = document.createElement("div");
  footer.className = "ob-footer";
  footer.append(quit, skip);
  const tail = document.createElement("span");
  tail.className = "ob-tail";
  tail.setAttribute("aria-hidden", "true");
  bubble.append(text, sub, actions, footer, tail);
  const markersRoot = document.createElement("div");
  markersRoot.className = "ob-markers";
  markersRoot.setAttribute("aria-hidden", "true");
  root.append(markersRoot, bubble);

  let state: OnboardingState = OFF;
  let farewellLeft = 0;
  let shown: BubbleContent | null = null;
  let size = { width: 0, height: 0 };
  let covered = false;
  const head = new Vector3();
  const right = new Vector3();
  const point = new Vector3();
  const markers: HTMLElement[] = [];

  const measure = (): void => {
    size = { width: bubble.offsetWidth, height: bubble.offsetHeight };
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(bubble);

  const save = (record: OnboardingRecord | null): void => {
    if (record) options.write(ONBOARDING_KEY, record);
  };

  const render = (content: BubbleContent | null): void => {
    const same =
      shown !== null && content !== null && shown.text === content.text && shown.sub === content.sub && shown.actions === content.actions && shown.skip === content.skip;
    if (same || (shown === null && content === null)) return;
    const textChanged = content?.text !== shown?.text;
    shown = content;
    root.hidden = content === null;
    if (!content) return;
    text.textContent = content.text;
    sub.textContent = content.sub ?? "";
    sub.hidden = content.sub === null;
    actions.hidden = !content.actions;
    footer.hidden = !content.skip;
    measure();
    if (textChanged) options.announce(`병아리 간호사: ${content.text}`);
  };

  const enter = (next: OnboardingState): void => {
    const before = state;
    state = next;
    if (next.kind === "step" && (before.kind !== "step" || before.step !== next.step)) {
      track("onboarding_step", { step: next.step });
    }
    if (next.kind === "farewell") {
      farewellLeft = FAREWELL_SECONDS;
      track("onboarding_done");
    }
    if (next.kind === "off") {
      options.guide?.goHome();
      render(null);
    }
    options.highlightPray(next.kind === "step" && next.step === 2);
  };

  function dispatch(event: OnboardingEvent): void {
    if (state.kind !== "step") return;
    const step = state.step;
    const result = nextOnboarding(state, event);
    if (result.state === state) return;
    save(result.record);
    // 어느 단계에서 넘기거나 그만두는지 봐요.
    if (event === "skip") track("onboarding_skip", { step });
    if (event === "quit") track("onboarding_quit", { step });
    enter(result.state);
  }

  const start = (): void => {
    loadGuestbookFonts();
    const context = options.context();
    options.guide?.follow();
    enter({ kind: "step", step: firstStep({ canLie: context.canLie, ownsBed: context.ownedBed !== null }) });
  };

  /** 3D 자리를 화면 좌표로 바꿔요. 카메라 뒤면 null이에요. */
  const project = (world: Vector3, camera: Camera): { x: number; y: number } | null => {
    point.copy(world).project(camera);
    if (point.z > 1) return null;
    return { x: ((point.x + 1) / 2) * window.innerWidth, y: ((1 - point.y) / 2) * window.innerHeight };
  };

  /** 하단 행동 버튼과 확인 창의 윗선이에요. 말풍선은 이보다 위에 있어요. */
  const bottomLimit = (): number => {
    const bar = document.getElementById("action-bar");
    const rect = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
    return rect && rect.height > 0 ? rect.top - GAP : window.innerHeight - EDGE;
  };

  /** 위쪽 병동 표시와 설정 단추 아래예요. */
  const topLimit = (): number => {
    const value = Number.parseFloat(document.documentElement.style.getPropertyValue("--top-stack-bottom"));
    return (Number.isFinite(value) ? value : 0) + GAP;
  };

  const placeBubble = (camera: Camera): void => {
    const width = size.width;
    const height = size.height;
    const viewW = window.innerWidth;
    const top = topLimit();
    const bottom = Math.max(top + height, bottomLimit());
    const headWorld = options.nurseHead(head);
    let anchor: { x: number; y: number } | null = null;
    if (headWorld) {
      headWorld.y += BUBBLE_LIFT;
      anchor = project(headWorld, camera);
    }
    const onScreen = anchor !== null && anchor.x >= 0 && anchor.x <= viewW && anchor.y >= top && anchor.y <= window.innerHeight;
    let x: number;
    let y: number;
    let tailShown = false;
    if (anchor && onScreen) {
      x = Math.min(Math.max(anchor.x - width / 2, EDGE), viewW - EDGE - width);
      const want = anchor.y - height - 8;
      y = Math.min(Math.max(want, top), bottom - height);
      tailShown = Math.abs(y - want) < 6;
      const tailX = Math.min(Math.max(anchor.x - x, 22), width - 22);
      tail.style.left = `${Math.round(tailX)}px`;
    } else {
      // 간호사가 화면 밖이면 위쪽 가운데에 붙어 있어요.
      x = (viewW - width) / 2;
      y = top;
    }
    bubble.classList.toggle("is-docked", !tailShown);
    bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  const placeMarkers = (camera: Camera, points: readonly Vector3[]): void => {
    while (markers.length < points.length) {
      const marker = document.createElement("span");
      marker.className = "ob-marker";
      marker.append(document.createElement("span"));
      markersRoot.append(marker);
      markers.push(marker);
    }
    markers.forEach((marker, index) => {
      const world = points[index];
      const screen = world ? project(world, camera) : null;
      if (!screen) {
        marker.hidden = true;
        return;
      }
      marker.hidden = false;
      marker.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px) translate(-50%, -100%)`;
    });
  };

  const markerPoints = (context: OnboardingContext): Vector3[] => {
    if (state.kind !== "step") return [];
    if (state.step === 1 && context.roomIndex !== null) {
      const points: Vector3[] = [];
      BEDS.forEach((bed, index) => {
        if (bed.roomIndex === context.roomIndex && context.isFree(index)) points.push(new Vector3(bed.x, MARKER_Y, bed.z));
      });
      return points;
    }
    if (state.step === 3) {
      const top = context.treeTop(new Vector3());
      return top ? [top] : [];
    }
    return [];
  };

  return {
    begin(input) {
      const decision = onboardingStart({ record: parseOnboardingRecord(options.read(ONBOARDING_KEY)), ...input });
      if (decision === "mark-done") options.write(ONBOARDING_KEY, "done");
      if (decision === "start") start();
    },
    replay() {
      options.write(ONBOARDING_KEY, null);
      farewellLeft = 0;
      state = OFF;
      start();
    },
    notify(event) {
      dispatch(event);
    },
    get active() {
      return state.kind !== "off";
    },
    update(dt, camera, stillMotion) {
      const context = options.context();
      // 카메라의 오른쪽 방향이에요. 간호사는 화면에서 내 오른쪽 옆에 서요.
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      options.guide?.update(dt, context.me, { x: right.x, z: right.z }, stillMotion);
      if (state.kind === "off") return;
      if (state.kind === "step" && state.step === 1 && context.ownedBed !== null) dispatch("bed-owned");
      if (state.kind === "farewell") {
        farewellLeft -= dt;
        if (farewellLeft <= 0) {
          enter(OFF);
          return;
        }
      }
      const nowCovered = document.querySelector(COVERING) !== null;
      if (nowCovered !== covered) {
        covered = nowCovered;
        root.classList.toggle("is-covered", covered);
        options.highlightPray(!covered && state.kind === "step" && state.step === 2);
      }
      render(
        bubbleContent(state, {
          inRoom: context.roomIndex !== null,
          othersInRoom: othersInMyRoom(context.ownedBed, context.isTakenByOther),
        }),
      );
      if (covered) return;
      placeBubble(camera);
      placeMarkers(camera, markerPoints(context));
    },
  };
}
