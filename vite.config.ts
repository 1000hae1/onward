import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import { GA_MEASUREMENT_ID } from "./src/config";

/** Cloudflare Web Analytics 토큰은 32자리 16진수예요. 자리 표시나 빈 값이면 스크립트를 넣지 않아요. */
const ANALYTICS_TOKEN = /^[0-9a-f]{32}$/i;

/**
 * 쿠키를 쓰지 않는 Cloudflare Web Analytics 비콘을 production 빌드에만 넣어요.
 * 토큰은 .env.production의 VITE_CF_ANALYTICS_TOKEN이에요. preview와 개발 서버에는 넣지 않아요.
 * 비콘은 화면 스크립트(main.ts)보다 뒤에 실행돼서, 그 전에 주소창의 방명록 토큰이 지워져요.
 */
function webAnalytics(token: string | undefined): Plugin {
  return {
    name: "onward-web-analytics",
    apply: "build",
    transformIndexHtml() {
      if (!token || !ANALYTICS_TOKEN.test(token)) return [];
      return [
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "https://static.cloudflareinsights.com/beacon.min.js",
            "data-cf-beacon": JSON.stringify({ token, spa: false }),
          },
          injectTo: "body",
        },
      ];
    },
  };
}

/** GA4 측정 ID는 "G-" 뒤에 영문 대문자와 숫자예요. 자리 표시나 빈 값이면 gtag.js를 넣지 않아요. */
const GA_ID = /^G-[A-Z0-9]{4,20}$/;

/**
 * 구글 애널리틱스(GA4) gtag.js 기본 코드를 production 빌드의 <head>에만 넣어요. 측정 ID는 src/config.ts에 있어요.
 * - localhost에서는 gtag.js를 받지도 않아요.
 * - 방명록 링크(/guestbook/{토큰})의 토큰, 쿼리, 해시가 GA로 가지 않게 page_location을 경로만으로 정리해요.
 *   이 코드는 main.ts가 토큰을 지우기 전에 실행돼서, 여기서 직접 정리해야 해요.
 * - 방명록 링크의 <title>에는 주인 닉네임이 들어갈 수 있어서 page_title도 고정해요.
 * - 들어온 곳(page_referrer)은 사이트 주소(origin)만 남겨요.
 * - 스크립트가 막혀도(광고 차단, 인앱 브라우저) 화면은 그대로예요.
 */
export function googleAnalytics(id: string | undefined): Plugin {
  return {
    name: "onward-google-analytics",
    apply: "build",
    transformIndexHtml() {
      if (!id || !GA_ID.test(id)) return [];
      const idJson = JSON.stringify(id);
      const code = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
(function () {
  try {
    var host = location.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /\.(localhost|local)$/.test(host)) return;
    var path = location.pathname.indexOf("/guestbook") === 0 ? "/guestbook" : location.pathname;
    var referrer = "";
    try { referrer = document.referrer ? new URL(document.referrer).origin + "/" : ""; } catch (e) {}
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(${idJson});
    document.head.appendChild(s);
    gtag("js", new Date());
    gtag("config", ${idJson}, {
      send_page_view: true,
      page_location: location.origin + path,
      page_referrer: referrer,
      page_title: path === "/guestbook" ? "온기병동 방명록" : "온기병동"
    });
  } catch (e) {}
})();
`;
      return [{ tag: "script", children: code, injectTo: "head" }];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      cloudflare(),
      webAnalytics(mode === "production" ? env.VITE_CF_ANALYTICS_TOKEN : undefined),
      googleAnalytics(mode === "production" ? GA_MEASUREMENT_ID : undefined),
    ],
  };
});
