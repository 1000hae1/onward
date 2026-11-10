/**
 * 그림책 사과나무예요. 나무는 SVG로 그리고, 열어 볼 수 있는 사과는 44px 버튼으로 그 위에 올려요.
 * 이름과 글은 모두 textContent로만 넣어요.
 */
import "./guestbook.css";
import { appleDateText, appleLabel, phraseText } from "../../shared/guestbook-rules";
import type { AppleCard } from "../../shared/guestbook-rules";
import { appleSlotPoint, CANOPY, COLORS, TREE_HEIGHT, TREE_WIDTH } from "./tree-shape";

const SVG = "http://www.w3.org/2000/svg";
/** 새 사과가 열리고 카드가 떠 있는 시간이에요. */
const BLOOM_MS = 600;
const NEW_CARD_MS = 2600;

export interface TreeViewOptions {
  /** 주인이면 사과 카드에 [숨기기]가 있어요. */
  onHide?: (apple: AppleCard) => void;
}

export interface TreeView {
  readonly element: HTMLElement;
  /** openable은 눌러서 내용을 볼 수 있는 사과, plain은 모양만 보이는 사과의 자리예요. */
  set(openable: readonly AppleCard[], plain: readonly number[]): void;
  /** 방금 단 사과예요. 봉오리에서 사과로 열린 뒤 카드가 잠깐 떠올라요. */
  bloom(id: number): void;
  closeCard(): void;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** 사과 한 알이에요. 가운데가 (15, 17)인 30×30 그림이에요. */
function appleDrawing(scale = 1, withRing = false): SVGGElement {
  const group = svg("g", {});
  if (withRing) group.append(svg("circle", { class: "gb-ring", cx: 15, cy: 17, r: 14, fill: "none", stroke: "#fff", "stroke-width": 3 }));
  const bud = svg("g", { class: "gb-bud" });
  bud.append(
    svg("circle", { cx: 15, cy: 17, r: 5, fill: "#A9CF95" }),
    svg("ellipse", { cx: 18, cy: 11, rx: 4, ry: 2, fill: COLORS.leaf, transform: "rotate(-30 18 11)" }),
  );
  const fruit = svg("g", { class: "gb-fruit" });
  fruit.append(
    svg("path", { d: "M15 7 Q15.5 4.5 17 3.5", stroke: COLORS.wood, "stroke-width": 1.6, fill: "none", "stroke-linecap": "round" }),
    svg("circle", { cx: 15, cy: 17, r: 10 * scale, fill: COLORS.apple }),
    svg("ellipse", { cx: 11.2, cy: 13.2, rx: 3, ry: 2.2, fill: COLORS.highlight, transform: "rotate(-35 11.2 13.2)" }),
    svg("ellipse", { cx: 20, cy: 6.5, rx: 4.2, ry: 2.1, fill: COLORS.leaf, transform: "rotate(-28 20 6.5)" }),
  );
  group.append(bud, fruit);
  return group;
}

function drawTree(): SVGSVGElement {
  const root = svg("svg", { viewBox: `0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`, "aria-hidden": "true", focusable: "false" });
  root.append(
    svg("ellipse", { cx: 170, cy: 372, rx: 128, ry: 18, fill: COLORS.ground }),
    // 줄기와 짧은 가지 두 개예요.
    svg("path", { d: "M152 374 C158 330 160 280 162 220 L178 220 C180 280 182 330 190 374 Z", fill: COLORS.wood }),
    svg("path", { d: "M166 286 C150 270 136 258 122 240", stroke: COLORS.wood, "stroke-width": 9, fill: "none", "stroke-linecap": "round" }),
    svg("path", { d: "M174 266 C190 252 204 240 218 226", stroke: COLORS.wood, "stroke-width": 8, fill: "none", "stroke-linecap": "round" }),
  );
  for (const circle of CANOPY) root.append(svg("circle", { cx: circle.x, cy: circle.y, r: circle.r, fill: circle.color }));
  return root;
}

export function createTreeView(options: TreeViewOptions = {}): TreeView {
  const element = document.createElement("div");
  element.className = "gb-tree";
  const picture = drawTree();
  /** 모양만 보이는 사과는 그림 안에 그려요. 화면 낭독기는 개수 문구로 알아요. */
  const plainLayer = svg("g", {});
  picture.append(plainLayer);
  const buttons = document.createElement("div");
  const card = document.createElement("div");
  card.className = "gb-card";
  card.hidden = true;
  card.tabIndex = -1;
  card.setAttribute("role", "dialog");
  element.append(picture, buttons, card);

  let apples: AppleCard[] = [];
  let openId: number | null = null;
  let newCardTimer = 0;
  const buttonFor = new Map<number, HTMLButtonElement>();

  const place = (target: HTMLElement | SVGElement, slot: number): { x: number; y: number } => {
    const point = appleSlotPoint(slot);
    if (target instanceof HTMLElement) {
      target.style.left = `${(point.x / TREE_WIDTH) * 100}%`;
      target.style.top = `${(point.y / TREE_HEIGHT) * 100}%`;
    }
    return point;
  };

  const closeCard = (returnFocus = false): void => {
    window.clearTimeout(newCardTimer);
    if (openId === null) return;
    const button = buttonFor.get(openId);
    button?.classList.remove("is-open");
    button?.setAttribute("aria-expanded", "false");
    card.hidden = true;
    openId = null;
    if (returnFocus) button?.focus();
  };

  const openCard = (apple: AppleCard, focus: boolean): void => {
    closeCard();
    openId = apple.id;
    const button = buttonFor.get(apple.id);
    button?.classList.add("is-open");
    button?.setAttribute("aria-expanded", "true");
    card.replaceChildren();
    const head = document.createElement("div");
    head.className = "gb-card-head";
    const name = document.createElement("p");
    name.className = "gb-card-name";
    name.textContent = apple.name;
    const date = document.createElement("span");
    date.className = "gb-card-date";
    date.textContent = appleDateText(apple.at);
    head.append(name, date);
    const chip = document.createElement("p");
    chip.className = "gb-chip-static";
    chip.textContent = phraseText(apple.phrase);
    card.append(head, chip);
    if (apple.note) {
      const note = document.createElement("p");
      note.className = "gb-card-note";
      note.textContent = apple.note;
      card.append(note);
    }
    if (options.onHide) {
      const hide = document.createElement("button");
      hide.type = "button";
      hide.className = "gb-text-button";
      hide.textContent = "이 사과 숨기기";
      hide.addEventListener("click", () => {
        closeCard();
        options.onHide?.(apple);
      });
      card.append(hide);
    }
    card.setAttribute("aria-label", appleLabel(apple.name, apple.at));
    card.hidden = false;
    // 사과 아래쪽에 띄우고, 나무 밖으로 나가지 않게 좌우를 맞춰요.
    const point = appleSlotPoint(apple.slot);
    const width = element.clientWidth || TREE_WIDTH;
    const height = element.clientHeight || TREE_HEIGHT;
    const x = (point.x / TREE_WIDTH) * width;
    const y = (point.y / TREE_HEIGHT) * height;
    const cardWidth = card.offsetWidth || 240;
    const cardHeight = card.offsetHeight || 140;
    card.style.left = `${Math.max(0, Math.min(width - cardWidth, x - cardWidth / 2))}px`;
    card.style.top = `${y + 22 + cardHeight > height ? Math.max(0, y - 22 - cardHeight) : y + 22}px`;
    if (focus) card.focus();
  };

  // 카드 밖을 누르면 닫혀요. 사과를 누른 것은 사과 버튼이 처리해요.
  document.addEventListener("pointerdown", (event) => {
    if (openId === null) return;
    const target = event.target as Node | null;
    if (target && (card.contains(target) || (target instanceof Element && target.closest(".gb-apple")))) return;
    closeCard();
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openId !== null) {
      event.stopPropagation();
      closeCard(true);
    }
  });

  return {
    element,
    set(openable, plain) {
      closeCard();
      apples = [...openable];
      plainLayer.replaceChildren();
      for (const slot of plain) {
        const point = place(plainLayer, slot);
        const drawing = appleDrawing(0.9);
        drawing.setAttribute("transform", `translate(${point.x - 15} ${point.y - 17})`);
        plainLayer.append(drawing);
      }
      buttons.replaceChildren();
      buttonFor.clear();
      for (const apple of apples) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gb-apple";
        button.setAttribute("aria-label", appleLabel(apple.name, apple.at));
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-haspopup", "dialog");
        const drawing = svg("svg", { viewBox: "0 0 30 30", "aria-hidden": "true", focusable: "false" });
        drawing.append(appleDrawing(1, true));
        button.append(drawing);
        place(button, apple.slot);
        button.addEventListener("click", () => {
          if (openId === apple.id) closeCard();
          else openCard(apple, true);
        });
        buttonFor.set(apple.id, button);
        buttons.append(button);
      }
    },
    bloom(id) {
      const apple = apples.find((entry) => entry.id === id);
      const button = buttonFor.get(id);
      if (!apple || !button) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      button.classList.add("is-new");
      window.setTimeout(
        () => {
          button.classList.remove("is-new");
          openCard(apple, false);
          newCardTimer = window.setTimeout(() => {
            if (openId === id) closeCard();
          }, NEW_CARD_MS);
        },
        still ? 0 : BLOOM_MS,
      );
    },
    closeCard: () => closeCard(),
  };
}
