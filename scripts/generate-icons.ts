import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { MARK_GLYPH, MARK_STROKE, MARK_TILE, MARK_VIEWBOX } from "@/lib/brand";

// Regenerates every favicon / PWA icon from src/lib/brand.ts: `npm run icons`.
const PRIMARY = "#1f4d3a";
const PRIMARY_INK = "#ffffff";

const glyph = `<path d="${MARK_GLYPH}" fill="none" stroke="${PRIMARY_INK}" stroke-width="${MARK_STROKE}" stroke-linejoin="round" stroke-linecap="round"/>`;

// "tile" keeps the rounded square on a transparent canvas; "bleed" fills the canvas for
// platforms that apply their own mask (iOS, Android maskable).
function markSvg(shape: "tile" | "bleed"): string {
  const v = MARK_VIEWBOX;
  const { inset, radius } = MARK_TILE;
  const background =
    shape === "tile"
      ? `<rect x="${inset}" y="${inset}" width="${v - 2 * inset}" height="${v - 2 * inset}" rx="${radius}" fill="${PRIMARY}"/>`
      : `<rect width="${v}" height="${v}" fill="${PRIMARY}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}">${background}${glyph}</svg>`;
}

// Hand-hinted 16px favicon: the vector B blurs into a grey smudge at tab size.
const PIXEL_GLYPH =
  "M4 3h6v2h-6z M10 4h2v3h-2z M4 5h2v8h-2z M6 7h5v2h-5z M11 8h2v3h-2z M6 11h5v2h-5z";
const PIXEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${PRIMARY}"/><path d="${PIXEL_GLYPH}" fill="${PRIMARY_INK}" shape-rendering="crispEdges"/></svg>`;

function png(shape: "tile" | "bleed", size: number): Promise<Buffer> {
  return sharp(Buffer.from(markSvg(shape)), { density: (72 * size) / MARK_VIEWBOX })
    .resize(size, size)
    .png()
    .toBuffer();
}

// ICO container with PNG-encoded entries (supported by every current browser).
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

async function main() {
  const favicon = [
    { size: 16, data: await sharp(Buffer.from(PIXEL_SVG), { density: 72 }).png().toBuffer() },
    { size: 32, data: await png("tile", 32) },
    { size: 48, data: await png("tile", 48) },
  ];
  const outputs: [string, Buffer][] = [
    ["src/app/favicon.ico", ico(favicon)],
    ["src/app/icon.png", await png("tile", 512)],
    ["src/app/apple-icon.png", await png("bleed", 180)],
    ["public/icons/icon-192.png", await png("tile", 192)],
    ["public/icons/icon-512.png", await png("tile", 512)],
    ["public/icons/maskable-512.png", await png("bleed", 512)],
  ];
  for (const [path, data] of outputs) {
    await writeFile(path, data);
    console.log(`${path} (${data.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
