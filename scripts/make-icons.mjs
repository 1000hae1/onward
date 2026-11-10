/**
 * public/favicon.svg(보름달)로 PNG 아이콘과 favicon.ico를 만들어요.
 * 그림을 바꾼 뒤 `npm run icons`로 다시 만들어 주세요.
 *
 * - favicon-16/32.png, favicon.ico: class="detail"(빛 테두리·무늬)을 빼서 작아도 달이 뭉개지지 않게 해요.
 * - apple-touch-icon.png: 아이폰은 투명한 곳을 검게 칠해서 바탕을 모서리까지 채워요.
 * - icon-maskable-512.png: 바탕을 끝까지 채우고, 달을 줄여 가운데 80% 안전 영역 안에 넣어요.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const svg = await readFile(`${publicDir}favicon.svg`, "utf8");

/** 빛 테두리와 무늬(class="detail")를 뺀 단순한 그림이에요. */
function simple(source) {
  return source
    .replace(/\s*<g class="detail"[^>]*>[\s\S]*?<\/g>/g, "")
    .replace(/\s*<[a-z]+ class="detail"[^>]*\/>/g, "");
}

/** 둥근 모서리를 없애 바탕을 끝까지 채워요. */
function fullBleed(source) {
  return source.replace(/(<rect [^>]*?)\s*rx="[^"]*"/, "$1");
}

/** 바탕은 그대로 두고 달만 가운데를 기준으로 줄여요. 0.78이면 달 지름이 한 변의 약 50%예요. */
function shrinkMoon(source, scale) {
  const bgEnd = source.indexOf("/>", source.indexOf("<rect ")) + 2;
  const end = source.lastIndexOf("</svg>");
  return (
    source.slice(0, bgEnd) +
    `\n  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">` +
    source.slice(bgEnd, end) +
    "</g>\n" +
    source.slice(end)
  );
}

function png(source, size) {
  return new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();
}

const outputs = [
  ["favicon-16.png", simple(svg), 16],
  ["favicon-32.png", simple(svg), 32],
  ["apple-touch-icon.png", fullBleed(svg), 180],
  ["icon-192.png", svg, 192],
  ["icon-512.png", svg, 512],
  ["icon-maskable-512.png", shrinkMoon(fullBleed(svg), 0.78), 512],
];

const made = {};
for (const [name, source, size] of outputs) {
  made[name] = png(source, size);
  await writeFile(`${publicDir}${name}`, made[name]);
}

// favicon.ico에는 16·32px 단순 버전을 담아요.
await writeFile(`${publicDir}favicon.ico`, await pngToIco([made["favicon-16.png"], made["favicon-32.png"]]));

console.log(`아이콘을 만들었어요: ${[...outputs.map(([name]) => name), "favicon.ico"].join(", ")}`);
