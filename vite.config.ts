import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";

/** Cloudflare Web Analytics 토큰은 32자리 16진수예요. 자리 표시나 빈 값이면 스크립트를 넣지 않아요. */
const ANALYTICS_TOKEN = /^[0-9a-f]{32}$/i;

/**
 * 쿠키를 쓰지 않는 Cloudflare Web Analytics 비콘을 production 빌드에만 넣어요.
 * 토큰은 .env.production의 VITE_CF_ANALYTICS_TOKEN이에요. preview와 개발 서버에는 넣지 않아요.
 * 비콘은 화면 스크립트(main.ts)보다 뒤에 실행돼서, 그 전에 주소창의 문병 토큰이 지워져요.
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [cloudflare(), webAnalytics(mode === "production" ? env.VITE_CF_ANALYTICS_TOKEN : undefined)],
  };
});
