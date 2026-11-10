/**
 * 방명록 링크의 화면 쪽이에요. 링크로 온 사람의 API 호출, 이 브라우저의 사과 열쇠, 내 링크 저장과 공유를 맡아요.
 */
import { applePostResultSchema, guestbookViewSchema, PROTOCOL_VERSION } from "../../shared/protocol";
import type { ApplePostResult, GuestbookView } from "../../shared/protocol";
import { GUESTBOOK_SHARE_TEXT, GUESTBOOK_TOKEN_PATTERN, WRITER_KEY_PATTERN } from "../../shared/guestbook-rules";
import { encodeAddress } from "../../shared/left-blessings";
import { read, remove, VISITING_KEY, write } from "./guestbook-path";

/** 내가 만든 방명록 링크예요. 토큰 원본은 서버에 없어서 다시 보여 주려면 이 기기에 둬야 해요. */
const MY_LINK_KEY = "onward.myGuestbookLink";
/** 예전 문병 링크예요. 더는 쓰지 않아서 보이면 지워요. */
const LEGACY_LINK_KEY = "onward.myVisitLink";
/** 이 브라우저가 단 사과를 알아보는 열쇠예요. 사람을 알 수 있는 값은 없어요. */
const WRITER_KEY = "onward.appleWriter";

/* ───────────── 문병 가기 ───────────── */

/** [병실에 문병 가기]를 누르고 병동으로 넘어왔으면 그 토큰이에요. */
export function takeVisitToken(): string | null {
  const saved = read(VISITING_KEY);
  return saved && GUESTBOOK_TOKEN_PATTERN.test(saved) ? saved : null;
}

/** 링크가 열리지 않으면 이 탭에서도 잊어요. */
export function forgetVisitToken(): void {
  remove(VISITING_KEY);
}

/** 방명록에서 병동으로 넘어가요. 토큰은 주소가 아니라 이 탭에만 담아 가요. */
export function goVisit(token: string): void {
  write(VISITING_KEY, token);
  window.location.assign("/");
}

/* ───────────── 링크로 온 사람의 API ───────────── */

/** 저장소를 쓸 수 없을 때 이번 화면에서만 쓰는 열쇠예요. */
let memoWriter: string | null = null;

export function writerKey(): string {
  try {
    const saved = window.localStorage.getItem(WRITER_KEY);
    if (saved && WRITER_KEY_PATTERN.test(saved)) return saved;
    const fresh = encodeAddress(crypto.getRandomValues(new Uint8Array(16)));
    window.localStorage.setItem(WRITER_KEY, fresh);
    return fresh;
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에서만 쓰는 열쇠예요. 새로고침하면 내 사과를 다시 알아보지 못해요.
    return (memoWriter ??= encodeAddress(crypto.getRandomValues(new Uint8Array(16))));
  }
}

/** 방명록을 읽어요. 서버에 닿지 않으면 null이에요. */
export async function fetchGuestbook(token: string): Promise<GuestbookView | null> {
  try {
    const response = await fetch(`/api/guestbook/${token}`, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "X-Apple-Writer": writerKey() },
    });
    if (!response.ok) return response.status === 404 ? { v: PROTOCOL_VERSION, open: false } : null;
    const parsed = guestbookViewSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.v !== PROTOCOL_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** 사과를 달아요. 서버에 닿지 않으면 null이에요. */
export async function postApple(token: string, draft: { name: string; phrase: number; note: string | null }): Promise<ApplePostResult | null> {
  try {
    const response = await fetch(`/api/guestbook/${token}/apples`, {
      method: "POST",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: PROTOCOL_VERSION, writer: writerKey(), ...draft }),
    });
    const parsed = applePostResultSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/* ───────────── 주인의 링크 ───────────── */

export function loadMyLink(): string | null {
  try {
    window.localStorage.removeItem(LEGACY_LINK_KEY);
    const saved = window.localStorage.getItem(MY_LINK_KEY);
    return saved && GUESTBOOK_TOKEN_PATTERN.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveMyLink(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(MY_LINK_KEY, token);
    else window.localStorage.removeItem(MY_LINK_KEY);
  } catch {
    // 저장하지 못하면 이 기기에서는 링크 주소를 다시 보여 주지 못해요.
  }
}

/** 링크 주소예요. 닉네임이나 병실 번호는 넣지 않아요. */
export function guestbookUrl(token: string): string {
  return `${window.location.origin}/guestbook/${token}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 휴대폰 공유 창으로 보내요. 공유 창이 없으면 복사해요. */
export async function shareLink(url: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text: GUESTBOOK_SHARE_TEXT, url });
      return "shared";
    } catch (error) {
      // 사용자가 닫았으면 복사하지 않아요.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}
