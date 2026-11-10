import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { maskSecrets } from "../worker/log.ts";

const WORKER_DIR = new URL("../worker/", import.meta.url);

test("서버 코드는 console을 직접 부르지 않고 worker/log.ts로만 로그를 남겨요", () => {
  const offenders = readdirSync(WORKER_DIR)
    .filter((file) => file.endsWith(".ts") && file !== "log.ts")
    .filter((file) => /\bconsole\s*\./.test(readFileSync(new URL(file, WORKER_DIR), "utf8")));
  assert.deepEqual(offenders, []);
});

test("로그에 남는 오류 문구에서 토큰, 해시, IP를 가려요", () => {
  assert.equal(maskSecrets("bad token Y0vK_VeEn32DcwQPiouU_g"), "bad token [masked]");
  assert.equal(maskSecrets("hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"), "hash [masked]");
  assert.equal(maskSecrets("from 203.0.113.7"), "from [ip]");
  assert.equal(maskSecrets("from 2001:db8::1"), "from [ip]");
  assert.equal(maskSecrets("UNIQUE constraint failed: visit_link.owner"), "UNIQUE constraint failed: visit_link.owner");
  assert.equal(maskSecrets("가 ".repeat(200)).length, 160);
});
