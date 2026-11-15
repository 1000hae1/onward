import "./intro.css";
import { track } from "../analytics";
import { loadGuestbookFonts } from "./fonts";
import { INTRO_TEXT, splitStrong } from "./intro-rules";
import type { IntroItem, IntroSource } from "./intro-rules";

/**
 * 처음 온 분에게 동물 고르기 앞에서 한 번 보여 주는 소개 카드예요. 설정의 [온기병동 소개]로도 다시 열어요.
 * 글자는 모두 textContent로 넣어요. 캐릭터 그림은 꾸밈이라 alt를 비워 화면 낭독기가 읽지 않아요.
 * 그림에 width·height를 적어 두어서, 그림이 늦게 와도 자리가 밀리지 않고 글자가 먼저 보여요.
 */
export interface IntroOptions {
  source: IntroSource;
  /** [병실로 들어가기]를 누르면 카드를 닫고 불러요. */
  onEnter(): void;
}

const ART = "/intro/";
const SVG_NS = "http://www.w3.org/2000/svg";

/** 꾸밈용 그림이에요. 코드에 적어 둔 그림만 넣어요(사용자 글자는 들어가지 않아요). */
function decoration(markup: string, className: string): SVGSVGElement {
  const holder = document.createElementNS(SVG_NS, "svg");
  holder.innerHTML = markup;
  const svg = holder.firstElementChild as SVGSVGElement;
  svg.classList.add(className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

function art(file: string, className: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = `${ART}${file}`;
  img.alt = "";
  img.loading = "eager";
  img.decoding = "async";
  img.width = 1024;
  img.height = 1024;
  img.draggable = false;
  img.className = className;
  return img;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ICONS: Record<IntroItem["icon"], string> = {
  tree: `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="10.8" y="12.5" width="2.4" height="8.5" rx="1" fill="#9A6A45"/><circle cx="12" cy="9.5" r="7" fill="#7DAA6E"/><circle cx="8.8" cy="8.6" r="1.7" fill="#D9574A"/><circle cx="14.8" cy="7.4" r="1.7" fill="#D9574A"/><circle cx="12.6" cy="12.2" r="1.7" fill="#D9574A"/></svg>`,
  hands: `<svg viewBox="0 0 24 24" width="24" height="24"><path d="M11.7 2.6c-1.2 0-2.1 1-2.1 2.2v6.4L6.2 14.5c-1 1-1 2.5 0 3.4l3.8 3.6h1.7z" fill="#CB9A63"/><path d="M12.3 2.6c1.2 0 2.1 1 2.1 2.2v6.4l3.4 3.3c1 1 1 2.5 0 3.4L14 21.5h-1.7z" fill="#B7844F"/><path d="M8.4 11.6l1.2 1.3M15.6 11.6l-1.2 1.3" stroke="#F1E7D6" stroke-width="1" stroke-linecap="round"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="24" height="24"><path d="M15.2 3.4a8.6 8.6 0 1 0 5.4 13.4A7.2 7.2 0 0 1 15.2 3.4z" fill="#7D88AE"/><circle cx="18.4" cy="5.6" r="1" fill="#A9B1CC"/></svg>`,
};

/** 휴대폰의 밤하늘: 오른쪽 위 작은 보름달과 별 몇 개예요. */
function sky(): HTMLElement {
  const box = el("div", "intro-sky");
  box.append(el("span", "intro-moon"));
  for (let i = 0; i < 7; i += 1) box.append(el("span", `intro-star intro-star-${i}`));
  return box;
}

/** PC의 병실: 보름달 뜬 창문과 창가 화분이에요. */
const ROOM_WINDOW = `<svg viewBox="0 0 400 300">
  <defs>
    <linearGradient id="intro-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151B29"/><stop offset="1" stop-color="#25304A"/></linearGradient>
    <radialGradient id="intro-moonglow"><stop offset="0" stop-color="#F6E7B8" stop-opacity=".35"/><stop offset="1" stop-color="#F6E7B8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="104" y="22" width="192" height="206" rx="10" fill="#3A4460"/>
  <rect x="116" y="34" width="168" height="182" rx="4" fill="url(#intro-night)"/>
  <circle cx="232" cy="88" r="56" fill="url(#intro-moonglow)"/>
  <circle cx="232" cy="88" r="24" fill="#F6E7B8"/>
  <circle cx="140" cy="60" r="1.6" fill="#F6E7B8" opacity=".8"/>
  <circle cx="172" cy="104" r="1.2" fill="#F6E7B8" opacity=".6"/>
  <circle cx="262" cy="150" r="1.4" fill="#F6E7B8" opacity=".7"/>
  <circle cx="150" cy="170" r="1.1" fill="#F6E7B8" opacity=".5"/>
  <rect x="197" y="34" width="6" height="182" fill="#3A4460"/>
  <rect x="116" y="122" width="168" height="6" fill="#3A4460"/>
  <rect x="92" y="226" width="216" height="12" rx="4" fill="#4B5677"/>
  <g transform="translate(134 226)">
    <ellipse cx="10" cy="-40" rx="7" ry="15" fill="#7DAA6E" transform="rotate(-28 10 -40)"/>
    <ellipse cx="26" cy="-46" rx="7" ry="17" fill="#8FBA7C" transform="rotate(14 26 -46)"/>
    <ellipse cx="18" cy="-50" rx="6" ry="16" fill="#6E9A62"/>
    <path d="M2 -28 H34 L30 0 H6 Z" fill="#C67B5C"/>
    <rect x="0" y="-31" width="36" height="6" rx="2" fill="#D48C6C"/>
  </g>
</svg>`;

/** 곰의 등불에서 잠든 토끼 머리맡으로 가는 점선 빛이에요. 좌표는 캐릭터 줄(가로:세로 = 1.75:1) 기준이에요. */
const BEAM = `<svg viewBox="0 0 175 100" preserveAspectRatio="none">
  <path d="M110 50 Q 86 12 54 22" fill="none" stroke="#F6E7B8" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="0.1 7" vector-effect="non-scaling-stroke" opacity=".8"/>
  <circle cx="52" cy="23" r="1.8" fill="#F6E7B8" opacity=".85"/>
</svg>`;

function figure(className: string, file: string, lamp: boolean): HTMLElement {
  const box = el("div", `intro-figure ${className}`);
  box.append(art(file, "intro-art"));
  if (lamp) box.append(el("span", "intro-lamp"));
  return box;
}

function scene(): HTMLElement {
  const box = el("div", "intro-scene");
  box.setAttribute("aria-hidden", "true");
  const cast = el("div", "intro-cast");
  cast.append(
    figure("intro-rabbit", "onward-rabbit-sleep.png", false),
    figure("intro-bear", "onward-bear-pray.png", true),
    figure("intro-otter", "onward-otter-pray.png", true),
    figure("intro-cat-scene", "onward-ward-cat-sit.png", false),
    decoration(BEAM, "intro-beam"),
  );
  box.append(sky(), decoration(ROOM_WINDOW, "intro-window"), el("div", "intro-floor"), cast);
  return box;
}

function item(entry: IntroItem): HTMLLIElement {
  const li = el("li", entry.highlight ? "intro-item is-highlight" : "intro-item");
  const icon = el("span", `intro-icon intro-icon-${entry.icon}`);
  icon.setAttribute("aria-hidden", "true");
  icon.append(decoration(ICONS[entry.icon], "intro-icon-svg"));
  const text = el("p", "intro-item-text");
  const parts = splitStrong(entry.text, entry.strong);
  text.append(parts.before);
  if (parts.strong) text.append(el("strong", "intro-strong", parts.strong), parts.after);
  li.append(icon, text);
  return li;
}

/** 소개 카드를 보여 줘요. 이미 열려 있으면 새로 그려요. */
export function showIntroCard(root: HTMLElement, options: IntroOptions): void {
  loadGuestbookFonts();
  root.replaceChildren();
  root.className = "intro";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "intro-title");
  // 빈 곳을 눌러도 포커스가 카드 안에 머물러요.
  root.tabIndex = -1;

  const card = el("div", "intro-card");
  const title = el("h1", "intro-title", INTRO_TEXT.title);
  title.id = "intro-title";
  const list = el("ul", "intro-list");
  list.append(...INTRO_TEXT.items.map(item));
  const enter = el("button", "intro-enter", INTRO_TEXT.enter);
  enter.type = "button";
  const cat = art("onward-ward-cat-sit.png", "intro-cat");
  cat.setAttribute("aria-hidden", "true");
  card.append(cat, title, el("p", "intro-subtitle", INTRO_TEXT.subtitle), el("hr", "intro-rule"), list, enter);

  const panel = el("div", "intro-panel");
  panel.append(card);
  root.append(scene(), panel);

  const close = (): void => {
    root.removeEventListener("keydown", onKey);
    root.hidden = true;
    root.replaceChildren();
    track("intro_enter", { from: options.source });
    options.onEnter();
  };
  const onKey = (event: KeyboardEvent): void => {
    // 카드가 열려 있는 동안 키보드가 뒤의 병동(걷기, 설정, 동작 메뉴)에 닿지 않게 해요.
    event.stopPropagation();
    if (event.key === "Enter" && event.target === root) {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      // 누를 수 있는 것은 버튼 하나뿐이라 포커스가 카드 밖으로 나가지 않게 해요.
      event.preventDefault();
      enter.focus();
    } else if (event.key === "Escape" && options.source === "settings") {
      event.preventDefault();
      close();
    }
  };
  root.addEventListener("keydown", onKey);
  enter.addEventListener("click", close);

  root.hidden = false;
  root.scrollTop = 0;
  // 대화상자 자체에 포커스를 둬서 화면 낭독기가 제목부터 읽어요. Tab이나 Enter 한 번이면 버튼이에요.
  root.focus({ preventScroll: true });
  track("intro_view", { from: options.source });
}
