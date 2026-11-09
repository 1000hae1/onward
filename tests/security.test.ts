import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkAdminKey,
  constantTimeEqual,
  hashIp,
  issueGuest,
  MissingSecretError,
  requireSecret,
  signGuest,
  verifyGuest,
} from "../worker/security.ts";

const SECRET = "s".repeat(48);
const OTHER = "o".repeat(48);
const ADMIN = "a-very-long-admin-key-for-tests-0123456789";

test("서버가 만든 토큰은 같은 비밀값으로 검증되고 guestId를 돌려줘요", async () => {
  const { guestId, token } = await issueGuest(SECRET);
  assert.match(token, /^1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyGuest(SECRET, token), guestId);
  // 토큰은 매번 새 guestId로 만들어요.
  const second = await issueGuest(SECRET);
  assert.notEqual(second.guestId, guestId);
});

test("서명이 틀리거나 다른 비밀값이면 새 게스트로 봐요", async () => {
  const { guestId, token } = await issueGuest(SECRET);
  assert.equal(await verifyGuest(OTHER, token), null);
  // 서명의 한 글자만 바꿔도 받지 않아요.
  const last = token.at(-1) === "A" ? "B" : "A";
  assert.equal(await verifyGuest(SECRET, token.slice(0, -1) + last), null);
  // 다른 사람의 guestId에 내 서명을 붙여도 받지 않아요.
  const { token: mine } = await issueGuest(SECRET);
  const forged = `1.${guestId}.${mine.split(".")[2]}`;
  assert.equal(await verifyGuest(SECRET, forged), null);
  // 예전처럼 브라우저가 만든 guestId만 보내도 받지 않아요.
  assert.equal(await verifyGuest(SECRET, crypto.randomUUID()), null);
  for (const bad of [undefined, null, 42, "", "1..", `2.${token.slice(2)}`, `${token}x`, token.slice(0, -1)]) {
    assert.equal(await verifyGuest(SECRET, bad), null);
  }
});

test("직접 서명한 guestId도 같은 방법으로 검증돼요", async () => {
  const guestId = "AAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(await verifyGuest(SECRET, await signGuest(SECRET, guestId)), guestId);
});

test("상수 시간 비교는 길이와 내용이 모두 같을 때만 같다고 해요", () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  assert.equal(constantTimeEqual(a, new Uint8Array([1, 2, 3, 4])), true);
  assert.equal(constantTimeEqual(a, new Uint8Array([1, 2, 3, 5])), false);
  assert.equal(constantTimeEqual(a, new Uint8Array([1, 2, 3])), false);
  assert.equal(constantTimeEqual(a, new Uint8Array([1, 2, 3, 4, 0])), false);
  assert.equal(constantTimeEqual(new Uint8Array(), new Uint8Array()), true);
});

test("운영자 키는 Bearer로 정확히 같을 때만 받아요", async () => {
  assert.equal(await checkAdminKey(`Bearer ${ADMIN}`, ADMIN), true);
  assert.equal(await checkAdminKey(`Bearer ${ADMIN}x`, ADMIN), false);
  assert.equal(await checkAdminKey(`Bearer ${ADMIN.slice(0, -1)}`, ADMIN), false);
  assert.equal(await checkAdminKey(ADMIN, ADMIN), false);
  assert.equal(await checkAdminKey(`Basic ${ADMIN}`, ADMIN), false);
  assert.equal(await checkAdminKey(`bearer ${ADMIN}`, ADMIN), false);
  assert.equal(await checkAdminKey(null, ADMIN), false);
  assert.equal(await checkAdminKey("", ADMIN), false);
});

test("운영자 키가 없거나 짧으면 무엇을 보내도 거절해요", async () => {
  assert.equal(await checkAdminKey("Bearer ", undefined), false);
  assert.equal(await checkAdminKey("Bearer ", ""), false);
  assert.equal(await checkAdminKey("Bearer short", "short"), false);
});

test("비밀값이 없으면 이름만 알리고 값은 담지 않은 채 멈춰요", () => {
  assert.throws(() => requireSecret(undefined, "TOKEN_SECRET"), MissingSecretError);
  const short = "too-short-secret";
  try {
    requireSecret(short, "IP_SALT");
    assert.fail("멈춰야 해요");
  } catch (error) {
    assert.ok(error instanceof MissingSecretError);
    assert.match(error.message, /IP_SALT/);
    assert.equal(error.message.includes(short), false);
  }
  assert.equal(requireSecret(SECRET, "TOKEN_SECRET"), SECRET);
});

test("IP 해시는 소금마다 다르고 원본 IP가 드러나지 않아요", async () => {
  const ip = "203.0.113.7";
  const one = await hashIp(SECRET, ip);
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(await hashIp(SECRET, ip), one);
  assert.notEqual(await hashIp(OTHER, ip), one);
  assert.notEqual(await hashIp(SECRET, "203.0.113.8"), one);
  assert.equal(one.includes("203"), false);
});
