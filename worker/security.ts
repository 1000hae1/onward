/**
 * 비밀값을 다루는 곳이에요. Cloudflare에만 있는 기능을 쓰지 않아서 Node 테스트에서도 그대로 돌아요.
 * 이 파일의 어떤 함수도 비밀값이나 토큰, IP 원문을 로그에 남기거나 오류 문구에 담지 않아요.
 */

/** 비밀값은 이보다 짧으면 쓰지 않아요. */
export const MIN_SECRET_LENGTH = 32;
const TOKEN_VERSION = "1";
const GUEST_ID_BYTES = 16;
const TOKEN_PATTERN = /^1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const encoder = new TextEncoder();

export class MissingSecretError extends Error {
  constructor(name: string) {
    // 이름만 알려요. 값은 담지 않아요.
    super(`secret ${name} is missing or too short`);
    this.name = "MissingSecretError";
  }
}

/** 비밀값이 있고 충분히 긴지 확인해요. 없으면 안전한 쪽으로 멈춰요. */
export function requireSecret(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) throw new MissingSecretError(name);
  return value;
}

/** 길이가 같으면 내용과 상관없이 같은 시간이 걸리는 비교예요. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // 길이가 다르면 다르다고 하지만, 그래도 끝까지 돌아서 어디서 달라졌는지 알 수 없게 해요.
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

const signingInput = (guestId: string): string => `onward-guest:${TOKEN_VERSION}:${guestId}`;

/** 새 게스트를 만들고 서명한 토큰을 줘요. guestId는 서버만 알아요. 토큰은 주인 브라우저에만 보내요. */
export async function issueGuest(secret: string): Promise<{ guestId: string; token: string }> {
  const guestId = toBase64Url(crypto.getRandomValues(new Uint8Array(GUEST_ID_BYTES)));
  return { guestId, token: await signGuest(secret, guestId) };
}

export async function signGuest(secret: string, guestId: string): Promise<string> {
  const signature = toBase64Url(await hmac(secret, signingInput(guestId)));
  return `${TOKEN_VERSION}.${guestId}.${signature}`;
}

/** 토큰의 서명이 맞으면 guestId를, 형식이나 서명이 틀리면 null을 돌려줘요. */
export async function verifyGuest(secret: string, token: unknown): Promise<string | null> {
  if (typeof token !== "string") return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const [, guestId, signature] = match;
  const given = fromBase64Url(signature);
  if (!given) return null;
  const expected = await hmac(secret, signingInput(guestId));
  return constantTimeEqual(given, expected) ? guestId : null;
}

/** IP를 소금(IP_SALT)과 섞은 해시예요. 원본 IP는 이 함수 밖으로 나가지 않아요. */
export async function hashIp(salt: string, ip: string): Promise<string> {
  return hex(await hmac(salt, `onward-ip:${ip}`));
}

export const IP_HASH_PATTERN = /^[0-9a-f]{64}$/;
export const GUEST_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** guestId 해시예요. 서버 안에서 사람을 가리킬 때는 이것만 써요. */
export async function hashGuest(guestId: string): Promise<string> {
  return hex(await sha256(`onward:${guestId}`));
}

/**
 * Authorization 헤더가 운영자 키와 같은지예요. 양쪽을 SHA-256으로 길이를 맞춘 뒤 상수 시간으로 비교해요.
 * 운영자 키가 없거나 짧으면 무엇을 보내도 거절해요.
 */
export async function checkAdminKey(header: string | null, adminKey: string | undefined): Promise<boolean> {
  if (typeof adminKey !== "string" || adminKey.length < MIN_SECRET_LENGTH) return false;
  const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(header ?? "");
  const given = await sha256(match ? match[1] : "");
  const expected = await sha256(adminKey);
  // 형식이 틀려도 비교는 똑같이 해요.
  return constantTimeEqual(given, expected) && match !== null;
}
