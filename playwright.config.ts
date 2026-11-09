import { defineConfig } from "@playwright/test";

/**
 * 로컬에서만 돌리는 E2E 테스트예요. `npm run e2e`가 개발 서버(Vite + Cloudflare 플러그인, wrangler와 같은
 * workerd 런타임)를 따로 띄워요. 배포 주소로는 돌지 않게 localhost만 받아요.
 */
const PORT = 5199;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 700 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
