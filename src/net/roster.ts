/**
 * 받은 event로 다른 사람 명단을 어떻게 바꿀지예요. 화면(Three.js)과 상관없는 순수 함수예요.
 * join을 놓쳤어도 update가 오면 그 사람을 새로 그려서, 새로고침하지 않아도 보이게 해요.
 */
import type { WardEvent } from "../../shared/protocol";

export type RosterAction = "add" | "update" | "remove" | "apply" | "ignore";

export function rosterAction(event: WardEvent, known: (id: string) => boolean, me: string | null): RosterAction {
  if (event.kind === "join" || event.kind === "update") {
    if (event.guest.id === me) return "ignore";
    if (event.kind === "join") return "add";
    return known(event.guest.id) ? "update" : "add";
  }
  if (event.kind === "leave") return known(event.id) ? "remove" : "ignore";
  if (
    event.kind === "walk" ||
    event.kind === "lie" ||
    event.kind === "get-up" ||
    event.kind === "bow" ||
    event.kind === "bless"
  ) {
    return known(event.id) ? "apply" : "ignore";
  }
  // 선물·불빛·창문·화분·안아 주기·퇴원 안내·고양이·집계는 화면이 따로 다뤄요.
  return "ignore";
}
