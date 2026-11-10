/**
 * 방명록 링크(/guestbook/{토큰})로 온 사람의 화면이에요. 3D 병동은 불러오지 않아요.
 * 같은 나무를 보여 주고, 다른 사람이 단 사과는 모양과 개수만, 내가 단 사과는 내용까지 보여 줘요.
 */
import { APPLE_LIMIT_TEXT, appleProblemText, GUESTBOOK_CLOSED_TEXT } from "../../shared/guestbook-rules";
import type { AppleCard } from "../../shared/guestbook-rules";
import type { GuestbookView } from "../../shared/protocol";
import { fetchGuestbook, goVisit, postApple } from "../net/guestbook-api";
import { checkNickname } from "../../shared/nickname";
import { createAppleSheet } from "./apple-sheet";
import { loadGuestbookFonts } from "./fonts";
import { createGuestbookHeader } from "./header";
import { othersSlots } from "./tree-shape";
import { createTreeView } from "./tree-view";

/** 이 기기에 저장된 병동 닉네임이에요. 프로필 모듈은 3D 모습을 함께 불러와서 여기서는 닉네임만 읽어요. */
const PROFILE_KEY = "onward.profile";

function savedNickname(): string {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PROFILE_KEY) ?? "null");
    const nickname = raw && typeof raw === "object" && "nickname" in raw ? raw.nickname : null;
    if (typeof nickname !== "string") return "";
    const checked = checkNickname(nickname);
    return checked.ok ? checked.value : "";
  } catch {
    return "";
  }
}

const OFFLINE_TEXT = "방명록에 닿지 못했어요. 잠시 뒤 다시 열어 주세요.";

export function startGuestbookPage(root: HTMLElement, token: string): void {
  loadGuestbookFonts();
  document.title = "온기병동 방명록";
  root.className = "gb-screen";
  root.setAttribute("aria-label", "방명록");
  root.hidden = false;
  const inner = document.createElement("div");
  inner.className = "gb-inner";
  root.replaceChildren(inner);

  const showMessage = (text: string, retry: boolean): void => {
    const message = document.createElement("p");
    message.className = "gb-message";
    message.textContent = text;
    const actions = document.createElement("div");
    actions.className = "gb-actions";
    if (retry) {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "gb-primary";
      again.textContent = "다시 열기";
      again.addEventListener("click", () => void load());
      actions.append(again);
    }
    const ward = document.createElement("a");
    ward.className = "gb-go";
    ward.href = "/";
    ward.textContent = "병동에 들르기 →";
    actions.append(ward);
    inner.replaceChildren(message, actions);
  };

  const render = (view: Extract<GuestbookView, { open: true }>): void => {
    let count = view.count;
    let mine: AppleCard[] = [...view.mine];
    const header = createGuestbookHeader("h1");
    const tree = createTreeView();
    const hint = document.createElement("p");
    hint.className = "gb-hint";
    hint.textContent = "내가 단 사과를 누르면 다시 볼 수 있어요";
    const refresh = (): void => {
      header.set(view.ownerNickname, count);
      tree.set(
        mine,
        othersSlots(
          count,
          mine.map((apple) => apple.slot),
        ),
      );
      hint.hidden = mine.length === 0;
    };

    const actions = document.createElement("div");
    actions.className = "gb-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "gb-primary";
    add.textContent = "사과 하나 달아 주기";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "gb-go";
    go.textContent = "병실에 문병 가기 →";
    go.addEventListener("click", () => goVisit(token));
    actions.append(add, go);

    const sheet = createAppleSheet(root, {
      initialName: savedNickname(),
      async submit(draft) {
        const result = await postApple(token, draft);
        if (!result) return OFFLINE_TEXT;
        if (result.result === "closed") return GUESTBOOK_CLOSED_TEXT;
        if (result.result === "limit") return APPLE_LIMIT_TEXT;
        if (result.result === "invalid") {
          return appleProblemText(
            result.field === "phrase" ? { field: "phrase" } : { field: result.field, problem: result.problem ?? "banned" },
          );
        }
        count = result.count;
        // 같은 자리에 있던 예전 사과는 나무에서 내려와요(41번째부터는 가장 오래된 자리에 열려요).
        mine = [...mine.filter((apple) => apple.slot !== result.apple.slot), result.apple];
        refresh();
        tree.bloom(result.apple.id);
        return null;
      },
    });
    add.addEventListener("click", () => sheet.open());

    inner.replaceChildren(header.element, tree.element, hint, actions);
    refresh();
  };

  const load = async (): Promise<void> => {
    const view = await fetchGuestbook(token);
    if (!view) return showMessage(OFFLINE_TEXT, true);
    if (!view.open) return showMessage(`${GUESTBOOK_CLOSED_TEXT} 병동에 들러 다른 분들의 평안을 빌어 주세요.`, false);
    render(view);
  };

  if (!token) {
    showMessage(GUESTBOOK_CLOSED_TEXT, false);
    return;
  }
  void load();
}
