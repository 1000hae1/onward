import { defineConfig } from "vitest/config";

/** 순수 함수만 테스트해요. Cloudflare 플러그인 없이 Node에서 돌려요. */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
