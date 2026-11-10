/**
 * 주인만 보는 "내 사과나무" 화면이에요. 내 침대 메뉴에서 열어요.
 * 내용은 병실 서버가 이 연결에만 보내 준 guestbook 메시지로 채워요.
 */
import { GUESTBOOK_LINK_NOTE, OWNER_HINT } from "../../shared/guestbook-rules";
import type { AppleCard } from "../../shared/guestbook-rules";
import type { ServerMessage } from "../../shared/protocol";
import { copyText, guestbookUrl, loadMyLink, saveMyLink, shareLink } from "../net/guestbook-api";
import { loadGuestbookFonts } from "./fonts";
import { createGuestbookHeader } from "./header";
import { createTreeView } from "./tree-view";

export type GuestbookMessage = Extract<ServerMessage, { type: "guestbook" }>;

export interface OwnerGuestbookOptions {
  nickname(): string;
  /** 서버에 물어요. 답은 update로 와요. */
  request(action: "info" | "create" | "off"): void;
  hide(appleId: number): void;
  /** 닫았어요. */
  onClose(): void;
}

export interface OwnerGuestbook {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  update(message: GuestbookMessage): void;
}

const COPIED_MS = 1800;

export function createOwnerGuestbook(root: HTMLElement, options: OwnerGuestbookOptions): OwnerGuestbook {
  root.className = "gb-screen";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "내 사과나무");
  root.hidden = true;
  const inner = document.createElement("div");
  inner.className = "gb-inner";
  root.append(inner);

  const topbar = document.createElement("div");
  topbar.className = "gb-topbar";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gb-text-button";
  close.textContent = "닫기";
  topbar.append(close);

  const header = createGuestbookHeader("h2");
  const linkCard = document.createElement("section");
  linkCard.className = "gb-link-card";
  linkCard.setAttribute("aria-label", "내 방명록 링크");
  const tree = createTreeView({ onHide: (apple) => options.hide(apple.id) });
  const hint = document.createElement("p");
  hint.className = "gb-hint";
  hint.textContent = OWNER_HINT;
  const loading = document.createElement("p");
  loading.className = "gb-message";
  loading.textContent = "사과나무를 살펴보는 중이에요.";
  inner.append(topbar, header.element, loading);

  let state: { active: boolean; count: number; apples: AppleCard[] } | null = null;
  /** 링크를 만들거나 끈 직후에 한 번 보여 주는 안내예요. */
  let note = "";
  let pendingCreate = false;
  let open = false;

  const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
  };

  const renderLink = (): void => {
    linkCard.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = "내 방명록 링크";
    linkCard.append(title);
    const token = state?.active ? loadMyLink() : null;
    if (state?.active && token) {
      const url = guestbookUrl(token);
      const address = document.createElement("p");
      address.className = "gb-link-url";
      address.textContent = url;
      const row = document.createElement("div");
      row.className = "gb-link-row";
      const copy = button("복사", "gb-secondary", () => {
        void copyText(url).then((ok) => {
          copy.textContent = ok ? "복사했어요" : "길게 눌러 복사해 주세요";
          window.setTimeout(() => (copy.textContent = "복사"), COPIED_MS);
        });
      });
      copy.setAttribute("aria-live", "polite");
      const send = button("보내기", "gb-secondary", () => {
        void shareLink(url).then((result) => {
          if (result === "copied") send.textContent = "복사했어요";
          else if (result === "failed") send.textContent = "길게 눌러 복사해 주세요";
          else return;
          window.setTimeout(() => (send.textContent = "보내기"), COPIED_MS);
        });
      });
      send.setAttribute("aria-live", "polite");
      row.append(copy, send);
      const small = document.createElement("p");
      small.className = "gb-small";
      small.textContent = GUESTBOOK_LINK_NOTE;
      linkCard.append(address, row, small);
    } else if (state?.active) {
      // 다른 기기에서 만들었거나 저장소가 지워져서 이 기기에는 링크 원본이 없어요. 서버에는 해시만 있어요.
      const text = document.createElement("p");
      text.className = "gb-small";
      text.textContent = "이 기기에는 링크 주소가 없어요. 새 링크를 만들면 볼 수 있어요.";
      linkCard.append(text);
    } else {
      const text = document.createElement("p");
      text.className = "gb-small";
      text.textContent = "지금은 켜진 방명록 링크가 없어요. 링크를 만들어 보내면 받은 분만 사과를 남길 수 있어요.";
      linkCard.append(text);
    }
    if (note) {
      const status = document.createElement("p");
      status.className = "gb-small";
      status.setAttribute("role", "status");
      status.textContent = note;
      linkCard.append(status);
    }
    const manage = document.createElement("div");
    manage.className = "gb-link-row";
    if (state?.active) {
      manage.append(
        button("링크 끄기", "gb-secondary", () => options.request("off")),
        button("새 링크 만들기", "gb-secondary", () => {
          pendingCreate = true;
          options.request("create");
        }),
      );
    } else {
      manage.append(
        button("링크 만들기", "gb-secondary", () => {
          pendingCreate = true;
          options.request("create");
        }),
      );
    }
    linkCard.append(manage);
  };

  const render = (): void => {
    if (!state) return;
    header.set(options.nickname(), state.count);
    renderLink();
    tree.set(state.apples, []);
    hint.hidden = state.apples.length === 0;
    if (loading.isConnected) loading.replaceWith(linkCard, tree.element, hint);
  };

  const hide = (): void => {
    if (!open) return;
    open = false;
    tree.closeCard();
    root.hidden = true;
    options.onClose();
  };
  close.addEventListener("click", hide);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) hide();
  });

  return {
    get isOpen() {
      return open;
    },
    open() {
      loadGuestbookFonts();
      open = true;
      note = "";
      root.hidden = false;
      close.focus();
      options.request("info");
    },
    close: hide,
    update(message) {
      const wasActive = state?.active ?? false;
      if (message.token) {
        saveMyLink(message.token);
        note = wasActive ? "새 링크를 만들었어요. 예전 링크는 이제 열리지 않아요." : "링크가 준비됐어요. 보내고 싶은 분께 보내 주세요.";
      } else if (!message.active) {
        if (wasActive) note = "링크를 껐어요. 이제 이 링크로는 사과를 달 수 없어요.";
        saveMyLink(null);
      }
      if (pendingCreate && !message.token) note = note || "링크를 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.";
      pendingCreate = false;
      state = { active: message.active, count: message.count, apples: message.apples };
      if (open) render();
    },
  };
}
