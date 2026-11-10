import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GUESTBOOK_PREVIEW_DESCRIPTION,
  GUESTBOOK_PREVIEW_FALLBACK_TITLE,
  GUESTBOOK_PREVIEW_IMAGE,
  guestbookPreviewMeta,
  guestbookPreviewTitle,
  guestbookPreviewToken,
} from "../shared/guestbook-preview.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";
const PAGE = `https://onward.wunee.workers.dev/guestbook/${TOKEN}`;

test("주인 닉네임이 있으면 ○○님의 사과나무예요", () => {
  assert.equal(guestbookPreviewTitle("졸린토끼"), "졸린토끼님의 사과나무");
});

test("토큰이 없거나 꺼진 링크(null)면 닉네임 없이 기본 제목이에요", () => {
  assert.equal(guestbookPreviewTitle(null), GUESTBOOK_PREVIEW_FALLBACK_TITLE);
  assert.equal(GUESTBOOK_PREVIEW_FALLBACK_TITLE, "사과나무 방명록");
});

test("닉네임 규칙에 맞지 않는 값은 넣지 않아요", () => {
  for (const bad of ["", "가", "아주아주아주아주긴닉네임", "a.com", "토끼12345", " 토끼 "]) {
    assert.equal(guestbookPreviewTitle(bad), GUESTBOOK_PREVIEW_FALLBACK_TITLE, bad);
  }
});

test("특수문자는 미리 이스케이프하지 않고 날 글자로 둬요(setAttribute가 한 번만 이스케이프해요)", () => {
  const title = guestbookPreviewTitle('<토"끼&>');
  assert.equal(title, '<토"끼&>님의 사과나무');
  assert.ok(!title.includes("&amp;") && !title.includes("&lt;"));
});

test("meta 값 묶음: 이미지·크기·설명·카드 모양", () => {
  const meta = guestbookPreviewMeta("졸린토끼", PAGE);
  assert.deepEqual(meta, {
    description: GUESTBOOK_PREVIEW_DESCRIPTION,
    "og:type": "website",
    "og:url": PAGE,
    "og:title": "졸린토끼님의 사과나무",
    "og:description": "사과 한 알에 마음을 담아 주세요",
    "og:image": "https://onward.wunee.workers.dev/og-guestbook.png",
    "og:image:width": "1200",
    "og:image:height": "630",
    "twitter:card": "summary_large_image",
  });
  assert.equal(GUESTBOOK_PREVIEW_IMAGE, "https://onward.wunee.workers.dev/og-guestbook.png");
});

test("og:url은 지금 주소이고 쿼리와 # 뒤는 버려요", () => {
  assert.equal(guestbookPreviewMeta(null, `${PAGE}?utm=kakao#x`)["og:url"], PAGE);
});

test("닉네임 말고 다른 정보는 들어가지 않아요", () => {
  const values = Object.values(guestbookPreviewMeta(null, PAGE)).join(" ");
  assert.ok(!values.includes("님의"));
  assert.ok(!/병동|침대|\d+개/.test(values));
});

test("미리보기를 만들 주소인지 가려요", () => {
  assert.equal(guestbookPreviewToken(`/guestbook/${TOKEN}`), TOKEN);
  assert.equal(guestbookPreviewToken(`/guestbook/${TOKEN}/`), TOKEN);
  assert.equal(guestbookPreviewToken("/guestbook"), "");
  assert.equal(guestbookPreviewToken("/guestbook/"), "");
  assert.equal(guestbookPreviewToken("/guestbook/짧은토큰"), "");
  assert.equal(guestbookPreviewToken("/"), null);
  assert.equal(guestbookPreviewToken("/guestbookx"), null);
  assert.equal(guestbookPreviewToken("/api/guestbook/x"), null);
});
