import { BLESSINGS, blessingText, GIFTS } from "../../shared/gestures";
import { giftAllowedNow } from "../../shared/ward-rules";
import { MORNING_PHRASE } from "../../shared/morning";
import { DISCHARGE_CONFIRM_TEXT } from "../../shared/discharge-rules";
import { bedHeadSpot, BEDS, roomAt } from "../../shared/ward-layout";
import { gestureDuration } from "../avatar/pose";
import type { PlayerControls } from "../ward/controls";
import type { Offerings } from "../ward/offerings";
import type { HeadLabels } from "./head-labels";
import { createButton, createEmojiButton, createText } from "./widgets";
import { SOLO_ONLY_TEXT } from "../../shared/offering-rules";
import { FIVE_LEAF_ITEM } from "../../shared/left-blessings";
import { giftIcon } from "./icons/gift-icons";
import type { HugMenuState } from "../../shared/hug-rules";

/** 손을 모은 뒤 빛이 떠나기까지 기다리는 시간이에요. */
export const LIGHT_DELAY_SECONDS = gestureDuration("pray") * 0.55;
const TOAST_SECONDS = 2.6;

/** 서버에 닿았을 때 동작을 알리는 곳이에요. 혼자 쓰는 화면이면 online이 false예요. */
export interface ActionSink {
  online(): boolean;
  bless(bed: number): void;
  bow(phrase: number): void;
  gift(bed: number, item: number): void;
  lamp(): void;
  /** 같은 병실에 있는 사람에게 바로 평안을 보내요. */
  blessPerson(id: string): void;
  /** 자리에 없는 사람에게 평안이나 선물을 남겨요. */
  leaveFor(address: string, kind: "bless" | "gift", item?: number): void;
  /** 다른 동물에게 안아 주기를 요청해요. 서버가 거리와 횟수를 살펴요. */
  hug(id: string): void;
  /** 오늘 퇴원해요. closeLink면 방명록 링크도 함께 꺼요. */
  discharge(closeLink: boolean): void;
}

/** 오늘 같은 병실에서 만난 사람이에요. present는 지금 같은 병실에 있으면 그 사람의 머리 자리예요. */
export interface PersonChoice {
  address: string;
  nickname: string;
  present: { id: string; head: { x: number; y: number; z: number }; bed: number | null } | null;
}

/** 자리에 없는 분께 남기는 메뉴의 이름이에요. */
export const LEAVE_FOR_LABEL = "자리에 없는 분께 남기기";

export interface ActionBarOptions {
  root: HTMLElement;
  toast: HTMLElement;
  player: PlayerControls;
  offerings: Offerings;
  labels: HeadLabels;
  sink: ActionSink;
  stillMotion(): boolean;
  /** 오늘 만난 사람들이에요. 서버에 닿지 않을 때는 빈 목록이에요. */
  people(): PersonChoice[];
  /** 방명록 링크로 온 문병객이면 침대를 골라 보내기만 하고, 불빛과 내 침대 메뉴는 없어요. */
  visiting(): boolean;
  /** 켜진 방명록 링크가 있는지예요. 퇴원할 때 함께 끌지 물어봐요. */
  guestbookActive(): boolean;
  /** 한국 시간 06:30~09:00이면 "좋은 아침이에요"를 보여 줘요. 서버도 시간을 다시 살펴요. */
  morning(): boolean;
  /** 오잎클로버를 오늘 이미 놓았는지예요. 화면에서 버튼을 흐리게 할 뿐이고, 정하는 것은 서버예요. */
  fiveLeafUsed(): boolean;
}

/** 오잎클로버를 오늘 이미 놓았을 때 버튼 아래에 작게 적는 말이에요. */
export const FIVE_LEAF_USED_NOTE = "내일 다시";

export interface ActionBar {
  openDischarge(): void;
  update(dt: number): void;
  showToast(text: string): void;
  /** 다른 동물을 눌렀을 때 나오는 메뉴예요. 안아 주기를 할 수 없으면 버튼을 끄고 이유를 보여 줘요. */
  openPerson(person: { id: string; nickname: string; hug: HugMenuState }): void;
  /** 화면 아래 버튼을 감추거나 다시 보여요. 퇴원하는 동안 감춰요. */
  setHidden(hidden: boolean): void;
  /** "이 침대로 옮길까요?"를 물어요. [옮길게요]를 누르면 proceed를 불러요. */
  confirmMove(proceed: () => void): void;
  /** 아직 내 침대가 없을 때 빈 침대를 누르면 이 침대를 쓸지 물어요. */
  confirmClaim(proceed: () => void): void;
}

export const MOVE_CONFIRM_TEXT = "이 침대로 옮길까요?";
export const MOVE_YES_TEXT = "옮길게요";
export const MOVE_NO_TEXT = "그대로 있을게요";
export const CLAIM_CONFIRM_TEXT = "이 침대를 쓰시겠어요?";
export const CLAIM_YES_TEXT = "이 침대 쓰기";
export const CLAIM_NO_TEXT = "다른 곳 볼게요";

/** 화면 아래 네 버튼이에요. 서버에 닿으면 다른 사람에게도 보이고, 아니면 내 화면에만 보여요. */
export function createActionBar(options: ActionBarOptions): ActionBar {
  const { root, toast, player, offerings, labels, sink, stillMotion, people, visiting, guestbookActive, morning, fiveLeafUsed } = options;

  const sheet = document.createElement("div");
  sheet.className = "ward-panel action-sheet";
  sheet.hidden = true;
  const buttons = document.createElement("div");
  buttons.className = "ward-row action-buttons";
  root.append(sheet, buttons);

  let sheetName: string | null = null;
  let toastLeft = 0;
  let lightDelay: { left: number; to: { x: number; y: number; z: number } } | null = null;

  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.hidden = false;
    toastLeft = TOAST_SECONDS;
  };

  const closeSheet = (): void => {
    sheet.hidden = true;
    sheet.replaceChildren();
    sheetName = null;
    player.setBedPicker(null);
  };

  // Esc로 열린 메뉴를 닫아요. 설정이 열려 있으면 설정이 먼저 닫혀요.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || sheet.hidden) return;
    if (document.querySelector(".settings-sheet:not([hidden])")) return;
    closeSheet();
    buttons.querySelector<HTMLButtonElement>("button")?.focus();
  });

  const openSheet = (name: string, title: string, children: HTMLElement[], cancelLabel = "그만두기"): void => {
    closeSheet();
    sheetName = name;
    sheet.append(createText("p", title), ...children, createButton(cancelLabel, closeSheet));
    sheet.hidden = false;
  };

  /** 처음 침대를 고를 때 물어요. [이 침대 쓰기]를 누르면 서버가 배정을 확정한 뒤에 가서 누워요. */
  const confirmClaim = (proceed: () => void): void => {
    const yes = createButton(CLAIM_YES_TEXT, () => {
      closeSheet();
      proceed();
    });
    openSheet("claim-bed", CLAIM_CONFIRM_TEXT, [yes], CLAIM_NO_TEXT);
    yes.focus();
  };

  /** 내 침대가 있는데 다른 빈 침대를 눌렀을 때 옮길지 물어요. Esc나 [그대로 있을게요]는 그대로예요. */
  const confirmMove = (proceed: () => void): void => {
    const yes = createButton(MOVE_YES_TEXT, () => {
      closeSheet();
      proceed();
    });
    openSheet("move-bed", MOVE_CONFIRM_TEXT, [yes], MOVE_NO_TEXT);
    yes.focus();
  };

  /** 다른 침대를 고르는 단계예요. 고르면 그 침대를 보고 동작해요. */
  const pickBed = (name: string, title: string, onBed: (bed: number) => void): void => {
    openSheet(name, title, []);
    player.setBedPicker((bed) => {
      if (bed === player.ownedBed) {
        showToast("다른 침대를 골라 주세요.");
        return;
      }
      closeSheet();
      player.whenUp(() => {
        const target = BEDS[bed];
        player.faceToward(target.x, target.z);
        onBed(bed);
      });
    });
  };

  /** 오늘 만난 사람 가운데 한 명을 고르는 단계예요. */
  const pickPerson = (name: string, title: string, onPerson: (person: PersonChoice) => void): void => {
    const list = people();
    const children: HTMLElement[] =
      list.length === 0
        ? [createText("p", "오늘 만난 분이 아직 없어요. 같은 병동에서 만난 분이 여기에 남아요.")]
        : [
            (() => {
              const box = document.createElement("div");
              box.className = "action-choices";
              for (const person of list) {
                box.append(
                  createButton(person.present ? `${person.nickname} (함께 있어요)` : person.nickname, () => {
                    closeSheet();
                    onPerson(person);
                  }),
                );
              }
              return box;
            })(),
          ];
    openSheet(name, title, children);
  };

  /** 침대와 사람 가운데 어디로 보낼지 고르는 단계예요. 서버에 닿지 않으면 바로 침대를 골라요. */
  const pickTarget = (
    name: string,
    bedTitle: string,
    personTitle: string,
    onBed: (bed: number) => void,
    onPerson: (person: PersonChoice) => void,
  ): void => {
    if (!sink.online() || visiting()) {
      pickBed(name, bedTitle, onBed);
      if (!sink.online()) showToast(SOLO_ONLY_TEXT);
      return;
    }
    openSheet(name, "어디로 보낼까요?", [
      (() => {
        const row = document.createElement("div");
        row.className = "ward-row";
        row.append(
          createButton("침대 고르기", () => pickBed(name, bedTitle, onBed)),
          createButton(LEAVE_FOR_LABEL, () => pickPerson(name, personTitle, onPerson)),
        );
        return row;
      })(),
    ]);
  };

  const choiceList = (labelsOf: readonly string[], onPick: (id: number) => void): HTMLElement => {
    const list = document.createElement("div");
    list.className = "action-choices";
    labelsOf.forEach((label, id) => {
      list.append(createButton(label, () => onPick(id)));
    });
    return list;
  };

  /** 선물 고르기 버튼이에요. 아이콘은 위, 이름은 아래예요. 아이콘은 aria-hidden이라 낭독기는 이름만 읽어요. */
  const giftChoices = (now: Date, onPick: (id: number) => void): HTMLElement => {
    const list = document.createElement("div");
    list.className = "action-choices gift-choices";
    const usedFiveLeaf = fiveLeafUsed();
    GIFTS.forEach((name, id) => {
      const button = createButton("", () => onPick(id));
      button.className = "gift-choice";
      const icon = giftIcon(id);
      if (icon) button.append(icon);
      const label = document.createElement("span");
      label.className = "gift-label";
      label.textContent = name;
      button.append(label);
      const used = id === FIVE_LEAF_ITEM && usedFiveLeaf;
      if (used) {
        const note = document.createElement("span");
        note.className = "gift-note";
        note.textContent = FIVE_LEAF_USED_NOTE;
        button.append(note);
      }
      // 겨울이 아니면 귤·홍시·호빵은 서버가 받지 않아서 흐리게 둬요.
      button.disabled = used || !giftAllowedNow(id, now);
      list.append(button);
    });
    return list;
  };

  const toggleable = (name: string, open: () => void) => (): void => {
    if (sheetName === name) closeSheet();
    else open();
  };

  /** 누운 상태를 유지한 채 옮길 침대를 골라요. */
  const renderBedMenu = (): void => {
    openSheet("bed", "내 침대", [createButton("침대 옮기기", () => {
      openSheet("move-picker", "옮길 침대를 눌러 주세요.", []);
      player.setBedPicker((bed) => {
        if (bed === player.ownedBed) {
          showToast("다른 침대를 골라 주세요.");
          return;
        }
        closeSheet();
        player.chooseBed(bed);
      });
    })]);
  };

  /** 퇴원을 한 번 더 묻는 단계예요. 방명록 링크를 같이 끌지는 고를 수 있고, 기본은 끄지 않아요. */
  const openDischarge = (): void => {
    if (!sink.online() || visiting()) {
      showToast("병동에 연결된 뒤 이용할 수 있어요.");
      return;
    }
    if (player.ownedBed === null) {
      showToast("내 침대를 고른 뒤 퇴원할 수 있어요.");
      return;
    }
    const children: HTMLElement[] = [];
    let closeLink = false;
    if (guestbookActive()) {
      const label = document.createElement("label");
      label.className = "action-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = false;
      box.addEventListener("change", () => {
        closeLink = box.checked;
      });
      const text = document.createElement("span");
      text.textContent = "방명록 링크도 함께 끌게요";
      label.append(box, text);
      children.push(label);
    }
    const row = document.createElement("div");
    row.className = "ward-row";
    row.append(
      createButton("퇴원할게요", () => {
        closeSheet();
        sink.discharge(closeLink);
      }),
    );
    children.push(row);
    openSheet("discharge", DISCHARGE_CONFIRM_TEXT, children);
  };

  /** 다른 동물 메뉴예요. 닉네임은 textContent로만 넣어요. */
  const openPerson = (person: { id: string; nickname: string; hug: HugMenuState }): void => {
    const name = `person-${person.id}`;
    const row = document.createElement("div");
    row.className = "action-choices";
    const hugButton = createButton("안아 주기", () => {
      closeSheet();
      sink.hug(person.id);
      showToast(`${person.nickname}님께 물어볼게요.`);
    });
    // 할 수 없을 때도 버튼은 보여 주고, 왜 안 되는지 바로 아래에 적어요.
    hugButton.disabled = !person.hug.enabled;
    row.append(hugButton);
    const hugNote = person.hug.enabled ? null : createText("p", person.hug.reason);
    if (hugNote) hugNote.className = "action-note";
    openSheet(name, `${person.nickname}님`, hugNote ? [row, hugNote] : [row]);
  };

  const bedButton = createButton(
    "내 침대",
    toggleable("bed", renderBedMenu),
  );
  bedButton.hidden = true;
  const lamp = lampButton();

  buttons.append(
    createEmojiButton(
      "🙏",
      "평안 빌기",
      toggleable("pray", () => {
        pickTarget(
          "pray",
          "평안을 보낼 침대를 눌러 주세요. 빈 침대에도 남길 수 있어요.",
          "누구에게 평안을 보낼까요?",
          (bed) => {
            player.playGesture("pray");
            lightDelay = { left: LIGHT_DELAY_SECONDS, to: bedHeadSpot(BEDS[bed]) };
            if (sink.online()) sink.bless(bed);
          },
          (person) => {
            player.whenUp(() => {
              player.playGesture("pray");
              if (person.present) {
                // 같은 병실에 있으면 그분 머리 위로 빛이 날아가요.
                player.faceToward(person.present.head.x, person.present.head.z);
                lightDelay = { left: LIGHT_DELAY_SECONDS, to: person.present.head };
                sink.blessPerson(person.present.id);
              } else {
                // 자리에 없으면 빛이 하늘로 올라가고, 다음에 들어오실 때 전해져요.
                const hand = player.handSpot();
                lightDelay = { left: LIGHT_DELAY_SECONDS, to: { x: hand.x, y: 3.2, z: hand.z } };
                sink.leaveFor(person.address, "bless");
              }
            });
          },
        );
      }),
    ),
    createEmojiButton(
      "🙇",
      "목례와 한마디",
      toggleable("blessing", () => {
        openSheet("blessing", "어떤 한마디를 건넬까요?", [
          // "좋은 아침이에요"는 아침에만 보여요.
          choiceList(morning() ? BLESSINGS : BLESSINGS.slice(0, MORNING_PHRASE), (id) => {
            closeSheet();
            player.whenUp(() => {
              player.playGesture("bow");
              const text = blessingText(id);
              if (text) labels.showBubble(text);
              if (sink.online()) sink.bow(id);
            });
          }),
        ]);
      }),
    ),
    createEmojiButton(
      "🍀",
      "머리맡 선물",
      toggleable("gift", () => {
        const now = new Date();
        const seasonal = GIFTS.some((_, id) => !giftAllowedNow(id, now));
        openSheet("gift", seasonal ? "어떤 선물을 놓을까요? 귤·홍시·호빵은 11월부터 2월까지 놓을 수 있어요." : "어떤 선물을 놓을까요?", [
          giftChoices(
            now,
            (gift) => {
              pickTarget(
                "gift",
                "선물을 놓을 침대를 눌러 주세요. 빈 침대에도 놓을 수 있어요.",
                "누구에게 선물을 남길까요?",
                (bed) => {
                  // 서버에 닿으면 서버가 칸을 정해 알려 줄 때 날아가요.
                  if (sink.online()) sink.gift(bed, gift);
                  else offerings.sendGift(player.handSpot(), bed, gift, stillMotion());
                },
                (person) => {
                  // 함께 있는 분이 누워 있으면 그 침대 머리맡에 놓고, 아니면 다음에 들어오실 때 전해요.
                  if (person.present?.bed != null) sink.gift(person.present.bed, gift);
                  else sink.leaveFor(person.address, "gift", gift);
                },
              );
            },
          ),
        ]);
      }),
    ),
    lamp,
    bedButton,
  );

  function lampButton(): HTMLButtonElement {
    return createEmojiButton("🕯️", "창가에 불빛", () => {
      closeSheet();
      if (sink.online()) {
        // 서버가 받아 주면 빛이 창틀로 날아가고 안내가 떠요. 받지 않으면 이유가 떠요.
        sink.lamp();
        return;
      }
      const room = roomAt(player.x, player.z);
      if (!room) {
        showToast("병실에 들어가면 놓을 수 있어요.");
      } else if (!offerings.addLamp(room)) {
        showToast("창가가 불빛으로 가득해요.");
      } else {
        showToast(SOLO_ONLY_TEXT);
      }
    });
  }
  root.hidden = false;

  return {
    openDischarge,
    showToast,
    confirmMove,
    confirmClaim,
    openPerson,
    setHidden(hidden) {
      if (hidden) closeSheet();
      buttons.hidden = hidden;
    },
    update(dt) {
      // 내 침대가 있으면 걸어 다닐 때도 내 침대 메뉴를 보여 줘요. 문병객은 불빛도 놓지 않아요.
      const showBed = sink.online() && !visiting() && player.ownedBed !== null;
      if (bedButton.hidden === showBed) {
        bedButton.hidden = !showBed;
        if (!showBed && sheetName === "bed") closeSheet();
      }
      const showLamp = !visiting();
      if (lamp.hidden === showLamp) lamp.hidden = !showLamp;
      if (toastLeft > 0) {
        toastLeft -= dt;
        if (toastLeft <= 0) toast.hidden = true;
      }
      if (lightDelay) {
        lightDelay.left -= dt;
        if (lightDelay.left <= 0) {
          offerings.sendLight(player.handSpot(), lightDelay.to, stillMotion());
          lightDelay = null;
        }
      }
    },
  };
}
