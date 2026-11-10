/** 문병 링크의 화면 쪽이에요. 주소에서 토큰을 읽고, 주인을 미리 확인하고, 링크를 공유해요. */
import { PROTOCOL_VERSION, visitPreviewSchema } from "../../shared/protocol";
import type { VisitPreview } from "../../shared/protocol";
import { VISIT_SHARE_TEXT, VISIT_TOKEN_PATTERN } from "../../shared/visit-rules";
import { stashVisitPath, VISITING_KEY } from "./visit-path";

/** 내가 만든 링크예요. 토큰 원본은 서버에 없어서 다시 공유하려면 이 기기에 둬야 해요. */
const MY_LINK_KEY = "onward.myVisitLink";

/**
 * 주소가 /visit/{토큰}이면 토큰을 이 탭에 옮겨 두고 주소창에서 지워요.
 * 어깨 너머로 보이거나 다른 곳으로 퍼지지 않게요. 새로고침하면 탭에 둔 토큰을 써요.
 */
export function takeVisitToken(): string | null {
  // 보통은 main.ts가 이미 옮겨 뒀어요. 그래도 주소에 남아 있으면 여기서 옮겨요.
  const fromPath = stashVisitPath();
  if (fromPath) return fromPath;
  const saved = read(() => sessionStorage, VISITING_KEY);
  return saved && VISIT_TOKEN_PATTERN.test(saved) ? saved : null;
}

/** 링크가 열리지 않으면 이 탭에서도 잊어요. */
export function forgetVisitToken(): void {
  remove(() => sessionStorage, VISITING_KEY);
}

/** 링크를 미리 확인해요. 서버에 닿지 않으면 null이에요. */
export async function previewVisit(token: string): Promise<VisitPreview | null> {
  try {
    const response = await fetch(`/api/visit/${token}`, { cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) return null;
    const parsed = visitPreviewSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.v !== PROTOCOL_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function loadMyLink(): string | null {
  const saved = read(() => localStorage, MY_LINK_KEY);
  return saved && VISIT_TOKEN_PATTERN.test(saved) ? saved : null;
}

export function saveMyLink(token: string | null): void {
  if (token) write(() => localStorage, MY_LINK_KEY, token);
  else remove(() => localStorage, MY_LINK_KEY);
}

/** 링크 주소예요. 닉네임이나 병실 번호는 넣지 않아요. */
export function visitUrl(token: string): string {
  return `${window.location.origin}/visit/${token}`;
}

/**
 * 휴대폰 공유 창으로 보내요. 공유 창이 없으면 복사해요.
 * shared는 공유 창을 열었을 때, copied는 복사했을 때, failed는 둘 다 안 됐을 때예요.
 */
export async function shareVisit(token: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = visitUrl(token);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text: VISIT_SHARE_TEXT, url });
      return "shared";
    } catch (error) {
      // 사용자가 닫았으면 복사하지 않아요.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(`${VISIT_SHARE_TEXT} ${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // 저장하지 못해도 이번에는 그대로 써요.
  }
}

function remove(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key);
  } catch {
    // 지우지 못해도 괜찮아요.
  }
}
