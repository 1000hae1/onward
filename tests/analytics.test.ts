import assert from "node:assert/strict";
import { test } from "vitest";
import { cleanParams, isLocalHost, shouldSend, THROTTLE_MS, throttleKey, track } from "../src/analytics";
import { googleAnalytics } from "../vite.config";

test("정해 둔 키와 값만 남기고 나머지는 버려요", () => {
  assert.deepEqual(cleanParams({ animal: "bear" }), { animal: "bear" });
  assert.deepEqual(cleanParams({ kind: "cat_play" }), { kind: "cat_play" });
  // 목록에 없는 단어, 모르는 키(닉네임·아이디 같은)는 보내지 않아요.
  assert.deepEqual(cleanParams({ animal: "따뜻한 곰" }), {});
  assert.deepEqual(cleanParams({ nickname: "따뜻한 곰", guestId: "abc", publicId: "x", text: "안녕" }), {});
  assert.deepEqual(cleanParams({ kind: "bless", bedId: 3 }), { kind: "bless" });
});

test("boolean과 숫자 파라미터는 그 모양일 때만 받아요", () => {
  assert.deepEqual(cleanParams({ edited: true, returning: false }), { edited: true, returning: false });
  assert.deepEqual(cleanParams({ edited: "true" }), {});
  assert.deepEqual(cleanParams({ load_ms: 1234.6 }), { load_ms: 1235 });
  assert.deepEqual(cleanParams({ load_ms: Number.NaN }), {});
  assert.deepEqual(cleanParams({ load_ms: "1000" }), {});
  assert.deepEqual(cleanParams({ load_ms: -1 }), {});
});

test("같은 이벤트는 1초에 1번까지만 보내요", () => {
  const last = new Map<string, number>();
  const key = throttleKey("action", { kind: "bless" });
  assert.equal(shouldSend(last, key, 1000), true);
  assert.equal(shouldSend(last, key, 1000 + THROTTLE_MS - 1), false);
  assert.equal(shouldSend(last, key, 1000 + THROTTLE_MS), true);
  // 파라미터가 다르면 다른 이벤트예요.
  assert.equal(shouldSend(last, throttleKey("action", { kind: "bow" }), 1000 + THROTTLE_MS), true);
});

test("로컬 개발 주소에서는 보내지 않아요", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "onward.localhost", "my-mac.local", "LOCALHOST"]) {
    assert.equal(isLocalHost(host), true, host);
  }
  assert.equal(isLocalHost("onward.wunee.workers.dev"), false);
});

test("브라우저가 아니어도 track은 멈추지 않아요", () => {
  assert.doesNotThrow(() => track("loading_start"));
  assert.doesNotThrow(() => track("action", { kind: "lamp" }));
});

type HtmlTag = { tag: string; children: string; injectTo: string };
const injected = (id: string | undefined): HtmlTag[] => {
  const plugin = googleAnalytics(id);
  const transform = plugin.transformIndexHtml as () => HtmlTag[];
  return transform();
};

test("측정 ID가 자리 표시나 빈 값이면 gtag.js를 넣지 않아요", () => {
  assert.deepEqual(injected(undefined), []);
  assert.deepEqual(injected("G-여기에ID"), []);
  assert.deepEqual(injected("UA-1234-1"), []);
});

test("gtag 코드는 방명록 토큰·쿼리·제목을 GA로 보내지 않아요", () => {
  const [tag] = injected("G-ABC123XYZ");
  assert.equal(tag.injectTo, "head");
  const code = tag.children;
  assert.match(code, /send_page_view: true/);
  assert.match(code, /"G-ABC123XYZ"/);
  // 경로만 쓰고(/guestbook/{토큰} → /guestbook), location.href·search·hash는 쓰지 않아요.
  assert.match(code, /page_location: location\.origin \+ path/);
  assert.match(code, /"\/guestbook" : location\.pathname/);
  assert.doesNotMatch(code, /location\.(href|search|hash)/);
  // 방명록 링크의 <title>에는 주인 닉네임이 들어갈 수 있어서 제목을 고정해요.
  assert.match(code, /page_title:/);
  assert.doesNotMatch(code, /document\.title/);
  // localhost에서는 스크립트를 받지 않아요.
  assert.match(code, /localhost/);
});

test("소개 카드 이벤트는 어디서 열었는지(first/settings)만 받아요", () => {
  assert.deepEqual(cleanParams({ from: "first" }), { from: "first" });
  assert.deepEqual(cleanParams({ from: "settings" }), { from: "settings" });
  assert.deepEqual(cleanParams({ from: "guestbook" }), {});
});
