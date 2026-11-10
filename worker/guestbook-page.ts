/**
 * 방명록 링크(/guestbook/{토큰})로 온 GET이에요. 정적 index.html의 <head> meta만 미리보기용으로 바꿔서 돌려줘요.
 * 몸통(화면)은 그대로라 브라우저에서는 지금과 똑같이 방명록이 열려요.
 * 같은 주소의 답은 10분 들고 있어요. 그동안은 Directory를 깨우지 않아요.
 */
import { guestbookPreviewMeta, guestbookPreviewToken } from "../shared/guestbook-preview.ts";
import type { GuestbookPreviewMeta } from "../shared/guestbook-preview.ts";

const PREVIEW_CACHE_SECONDS = 600;
/** Worker 메모리에 들고 있는 주소 수의 상한이에요. 넘으면 가장 오래된 것부터 버려요. */
const MEMO_LIMIT = 500;

/** 방명록 API와 같은 원칙이에요. 브라우저·중간 서버는 저장하지 않고, 검색에 걸리지 않고, 주소를 다른 사이트에 넘기지 않아요. */
const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Cache API가 동작하지 않는 곳(*.workers.dev)을 위한 보조예요. 이 Worker 인스턴스 안에서만 10분 들고 있어요.
 * 값은 이미 바꾼 HTML이에요. 담긴 정보는 링크를 아는 사람이면 누구나 보는 제목뿐이에요.
 */
const memo = new Map<string, { html: string; until: number }>();

function remember(key: string, html: string, now: number): void {
  memo.delete(key);
  // Map은 넣은 순서를 지켜요. 맨 앞이 가장 오래된 것이에요.
  while (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
  memo.set(key, { html, until: now + PREVIEW_CACHE_SECONDS * 1000 });
}

/** /guestbook 아래 주소면 미리보기 답을, 아니면 null이에요. */
export async function guestbookPage(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const token = guestbookPreviewToken(url.pathname);
  if (token === null) return null;

  const pageUrl = `${url.origin}${url.pathname}`;
  const reply = (html: string): Response =>
    new Response(request.method === "HEAD" ? null : html, { headers: PAGE_HEADERS });

  const now = Date.now();
  const kept = memo.get(pageUrl);
  if (kept && kept.until > now) return reply(kept.html);

  // 캐시 열쇠는 쿼리 없는 주소예요. 저장은 Cache-Control을 바꾼 사본으로 해요(답 자체는 no-store).
  const cache = caches.default;
  const cacheKey = new Request(pageUrl, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const html = await cached.text();
    remember(pageUrl, html, now);
    return reply(html);
  }

  const nickname = token ? await env.DIRECTORY.getByName("directory").guestbookPreviewName(token) : null;
  const meta = guestbookPreviewMeta(nickname, pageUrl);
  // /index.html은 정적 에셋이 /로 돌려보낼 수 있어서 /로 가져와요.
  const shell = await env.ASSETS.fetch(new Request(`${url.origin}/`, { method: "GET" }));
  if (!shell.ok) return null;
  const html = await rewriteMeta(shell, meta).text();

  remember(pageUrl, html, now);
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(html, { headers: { "Content-Type": PAGE_HEADERS["Content-Type"], "Cache-Control": `public, max-age=${PREVIEW_CACHE_SECONDS}` } }),
    ),
  );
  return reply(html);
}

/**
 * <head>의 meta 가운데 이름이 맞는 것의 content만 바꿔요.
 * setAttribute는 큰따옴표(")만 &quot;로 바꿔서 속성 밖으로 나가지 못하게 해요. &는 그대로 두므로
 * 닉네임의 "&lt;" 같은 글자가 미리보기에서 <로 읽히지 않게 &만 여기서 먼저 바꿔요.
 */
function rewriteMeta(shell: Response, meta: GuestbookPreviewMeta): Response {
  return new HTMLRewriter()
    .on("head meta", {
      element(element) {
        const key = element.getAttribute("property") ?? element.getAttribute("name");
        if (key !== null && Object.hasOwn(meta, key)) element.setAttribute("content", meta[key].replaceAll("&", "&amp;"));
      },
    })
    .transform(shell);
}
