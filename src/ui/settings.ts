import type { Profile } from "./profile";
import type { ViewPrefs } from "./view-prefs";
import type { QualityChoice } from "../ward/quality";
import { createButton, createChoiceRow, createText } from "./widgets";

export interface SettingsOptions {
  initial: Profile;
  onChange(profile: Profile): void;
  onOpenChange(open: boolean): void;
  /** 가볍게 보기와 글자 크게예요. 이 기기에만 저장해요. */
  view: ViewPrefs;
  onViewChange(view: ViewPrefs): void;
}

export interface Settings {
  /** 서버가 닉네임을 바꿨을 때처럼 밖에서 바뀐 값을 맞춰요. */
  setProfile(profile: Profile): void;
}

function link(text: string, href: string, newTab: boolean): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.className = "settings-link";
  anchor.href = href;
  anchor.textContent = text;
  if (newTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  return anchor;
}

/**
 * 입장한 뒤에 고양이, 안아 주기 요청, 보기를 바꾸는 패널이에요. 오른쪽 위 버튼으로 열어요.
 * 동물과 닉네임은 입장 화면에서만 골라요.
 */
export function createSettings(root: HTMLElement, options: SettingsOptions): Settings {
  let profile = options.initial;
  let view = options.view;
  let open = false;

  const toggle = createButton("설정", () => setOpen(!open));
  toggle.className = "settings-toggle";

  const sheet = document.createElement("div");
  sheet.className = "ward-panel settings-sheet";

  const catRow = createChoiceRow<boolean>(
    [
      { value: true, label: "켜기" },
      { value: false, label: "끄기" },
    ],
    (withCat) => change({ ...profile, withCat }),
  );
  const hugRow = createChoiceRow<boolean>(
    [
      { value: false, label: "받기" },
      { value: true, label: "받지 않기" },
    ],
    (hugsOff) => change({ ...profile, hugsOff }),
  );
  const qualityRow = createChoiceRow<QualityChoice>(
    [
      { value: "auto", label: "자동" },
      { value: "light", label: "켜기" },
      { value: "normal", label: "끄기" },
    ],
    (quality) => changeView({ ...view, quality }),
  );
  const largeTextRow = createChoiceRow<boolean>(
    [
      { value: true, label: "켜기" },
      { value: false, label: "끄기" },
    ],
    (largeText) => changeView({ ...view, largeText }),
  );
  const qualityNote = createText("p", "가볍게 보면 배터리를 덜 써요. 가장자리 매끄럽게 하기는 다음에 열 때부터 바뀌어요.");
  qualityNote.className = "settings-note";
  sheet.append(
    createText("p", "고양이와 함께 다니기"),
    catRow.element,
    createText("p", "안아 주기 요청"),
    hugRow.element,
    createText("p", "가볍게 보기"),
    qualityRow.element,
    qualityNote,
    createText("p", "글자 크게"),
    largeTextRow.element,
    (() => {
      const help = document.createElement("div");
      help.className = "settings-help";
      help.append(
        createText("p", "마음이 많이 힘들 때는 109(자살예방상담전화, 24시간)에 전화해 주세요."),
        link("109에 전화하기", "tel:109", false),
        // 개인정보 처리방침은 잠시 내려 두었어요. 페이지는 docs/disabled/privacy.html에 있어요.
        // 다시 켜려면 그 파일을 public/privacy.html로 옮기고 아래 줄의 주석을 풀어 주세요.
        // link("개인정보 처리방침", "/privacy", true),
        link("만든 사람과 출처", "/credits", true),
      );
      return help;
    })(),
    createButton("닫기", () => setOpen(false)),
  );
  root.append(toggle, sheet);

  function render(): void {
    sheet.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    catRow.select(profile.withCat);
    hugRow.select(profile.hugsOff);
    qualityRow.select(view.quality);
    largeTextRow.select(view.largeText);
  }

  function changeView(next: ViewPrefs): void {
    view = next;
    render();
    options.onViewChange(view);
  }

  // Esc로 설정을 닫고, 포커스는 [설정] 버튼으로 돌려요.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    // 아래 동작 메뉴는 이번 Esc로 함께 닫히지 않게 해요.
    event.stopImmediatePropagation();
    setOpen(false);
    toggle.focus();
  });

  function setOpen(next: boolean): void {
    open = next;
    render();
    options.onOpenChange(open);
  }

  function change(next: Profile): void {
    profile = next;
    render();
    options.onChange(profile);
  }

  render();
  root.hidden = false;
  return {
    setProfile(next) {
      profile = next;
      render();
    },
  };
}
