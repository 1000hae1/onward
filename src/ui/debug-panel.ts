import { PROTOCOL_VERSION } from "../../shared/protocol";

/** ?debug=1일 때만 화면 구석에 보이는 작은 연결 정보예요. 모두 textContent로만 넣어요. */
export interface DebugPanel {
  setPublicId(id: string | null): void;
  setPlace(ward: number, instance: number): void;
  setStatus(status: string): void;
  setLastMessage(kind: string): void;
  /** 그리기 품질과 처음 5초에 잰 프레임 속도예요. */
  setQuality(text: string): void;
}

export function createDebugPanel(): DebugPanel {
  const root = document.createElement("aside");
  root.id = "debug-panel";
  root.setAttribute("aria-hidden", "true");
  document.body.append(root);

  const state = {
    publicId: "-",
    place: "-",
    status: "-",
    last: "-",
    count: 0,
    quality: "-",
  };

  const render = (): void => {
    root.textContent = [
      `id ${state.publicId}`,
      `병실 ${state.place}`,
      `연결 ${state.status}`,
      `받음 ${state.last} (${state.count})`,
      `품질 ${state.quality}`,
      `v${PROTOCOL_VERSION}`,
    ].join("\n");
  };
  render();

  return {
    setPublicId(id) {
      state.publicId = id ?? "-";
      render();
    },
    setPlace(ward, instance) {
      state.place = `${ward}병동 ${instance}번`;
      render();
    },
    setStatus(status) {
      state.status = status;
      render();
    },
    setQuality(text) {
      state.quality = text;
      render();
    },
    setLastMessage(kind) {
      state.last = kind;
      state.count++;
      render();
    },
  };
}
