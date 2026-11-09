/**
 * public/favicon.svg로 PNG 아이콘과 favicon.ico를 만들어요.
 * 그림을 바꾼 뒤 `node scripts/make-icons.mjs`로 다시 만들어 주세요. Playwright의 Chromium으로 그려요.
 *
 * PNG는 바탕을 가장자리까지 채워요. iOS와 안드로이드가 모서리를 알아서 둥글게 깎아요.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const svg = await readFile(`${publicDir}favicon.svg`, "utf8");
const BACKGROUND = "#1b2433";

const browser = await chromium.launch();
const page = await browser.newPage();

/** fullBleed면 둥근 모서리 바깥까지 바탕색으로 채워요. */
async function render(size, fullBleed) {
  await page.setViewportSize({ width: size, height: size });
  const background = fullBleed ? BACKGROUND : "transparent";
  await page.setContent(
    `<html><body style="margin:0;background:${background}">` +
      `<div style="width:${size}px;height:${size}px">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</div>` +
      `</body></html>`,
  );
  return page.screenshot({ omitBackground: !fullBleed, clip: { x: 0, y: 0, width: size, height: size } });
}

for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]) {
  await writeFile(`${publicDir}${name}`, await render(size, true));
}

// favicon.ico는 16·32·48px PNG를 그대로 담아요. 요즘 브라우저는 모두 PNG가 든 ICO를 읽어요.
const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push(await render(size, false));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
await writeFile(`${publicDir}favicon.ico`, Buffer.concat([header, ...images]));

await browser.close();
console.log("아이콘을 만들었어요.");
