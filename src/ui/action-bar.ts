import { BLESSINGS, blessingText, GIFTS } from "../../shared/gestures";
import { giftAllowedNow } from "../../shared/ward-rules";
import { bedHeadSpot, BEDS, roomAt } from "../../shared/ward-layout";
import { gestureDuration } from "../avatar/pose";
import type { PlayerControls } from "../ward/controls";
import type { Offerings } from "../ward/offerings";
import type { HeadLabels } from "./head-labels";
import { createButton, createText } from "./widgets";

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
}

/** 오늘 같은 병실에서 만난 사람이에요. present는 지금 같은 병실에 있으면 그 사람의 머리 자리예요. */
export interface PersonChoice {
  address: string;
  nickname: string;
  present: { id: string; head: { x: number; y: number; z: number } } | null;
}

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
}

export interface ActionBar {
  update(dt: number): void;
  showToast(text: string): void;
}

/** 화면 아래 네 버튼이에요. 서버에 닿으면 다른 사람에게도 보이고, 아니면 내 화면에만 보여요. */
export function createActionBar(options: ActionBarOptions): ActionBar {
  const { root, toast, player, offerings, labels, sink, stillMotion, people } = options;

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

  const openSheet = (name: string, title: string, children: HTMLElement[]): void => {
    closeSheet();
    sheetName = name;
    sheet.append(createText("p", title), ...children, createButton("그만두기", closeSheet));
    sheet.hidden = false;
  };

  /** 다른 침대를 고르는 단계예요. 고르면 그 침대를 보고 동작해요. */
  const pickBed = (name: string, title: string, onBed: (bed: number) => void): void => {
    openSheet(name, title, []);
    player.setBedPicker((bed) => {
      if (bed === player.claimedBed) {
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
        ? [createText("p", "오늘 만난 분이 아직 없어요.")]
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
    if (!sink.online()) {
      pickBed(name, bedTitle, onBed);
      return;
    }
    openSheet(name, "어디로 보낼까요?", [
      (() => {
        const row = document.createElement("div");
        row.className = "ward-row";
        row.append(
          createButton("침대 고르기", () => pickBed(name, bedTitle, onBed)),
          createButton("오늘 만난 분께", () => pickPerson(name, personTitle, onPerson)),
        );
        return row;
      })(),
    ]);
  };

  const choiceList = (
    labelsOf: readonly string[],
    onPick: (id: number) => void,
    enabled: (id: number) => boolean = () => true,
  ): HTMLElement => {
    const list = document.createElement("div");
    list.className = "action-choices";
    labelsOf.forEach((label, id) => {
      const button = createButton(label, () => onPick(id));
      button.disabled = !enabled(id);
      list.append(button);
    });
    return list;
  };

  const toggleable = (name: string, open: () => void) => (): void => {
    if (sheetName === name) closeSheet();
    else open();
  };

  buttons.append(
    createButton(
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
    createButton(
      "목례와 한마디",
      toggleable("blessing", () => {
        openSheet("blessing", "어떤 한마디를 건넬까요?", [
          choiceList(BLESSINGS, (id) => {
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
    createButton(
      "머리맡 선물",
      toggleable("gift", () => {
        const now = new Date();
        const seasonal = GIFTS.some((_, id) => !giftAllowedNow(id, now));
        openSheet("gift", seasonal ? "어떤 선물을 놓을까요? 귤·홍시·호빵은 11월부터 2월까지 놓을 수 있어요." : "어떤 선물을 놓을까요?", [
          choiceList(
            GIFTS,
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
                (person) => sink.leaveFor(person.address, "gift", gift),
              );
            },
            (gift) => giftAllowedNow(gift, now),
          ),
        ]);
      }),
    ),
    createButton("창가에 불빛", () => {
      closeSheet();
      if (sink.online()) {
        sink.lamp();
        return;
      }
      const room = roomAt(player.x, player.z);
      if (!room) {
        showToast("병실에 들어가면 놓을 수 있어요.");
      } else if (!offerings.addLamp(room)) {
        showToast("창가가 불빛으로 가득해요.");
      }
    }),
  );
  root.hidden = false;

  return {
    showToast,
    update(dt) {
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
