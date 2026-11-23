import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { MARK_GLYPH, MARK_STROKE, MARK_TILE, MARK_VIEWBOX } from "@/lib/brand";

// Regenerates every favicon / PWA icon and the README logo from src/lib/brand.ts: `npm run icons`.
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

// "Bilan" in Newsreader (wght 400, opsz 72), outlined with fontTools so the README logo
// renders without the web font. Font units: 2000/em, baseline at y=0, 4457 wide.
const WORDMARK =
  "M265 -1378 363 -1430H685Q840 -1430 936.5 -1388.0Q1033 -1346 1077.5 -1272.5Q1122 -1199 1122 -1104Q1122 -957 1015.5 -870.5Q909 -784 745 -767L777 -783Q992 -766 1113.0 -659.5Q1234 -553 1234 -403Q1234 -292 1177.5 -200.5Q1121 -109 993.5 -54.5Q866 0 652 0H364L293 -52H634Q754 -52 840.0 -89.0Q926 -126 972.5 -203.0Q1019 -280 1019 -401Q1019 -499 981.0 -574.5Q943 -650 864.0 -692.5Q785 -735 661 -735H292L265 -787H647Q773 -787 848.0 -861.5Q923 -936 923 -1087Q923 -1175 886.0 -1240.5Q849 -1306 770.5 -1342.0Q692 -1378 566 -1378ZM68 0V-29L247 -71V-1360L68 -1401V-1430H453V0Z M1542.0 -1202Q1479.0 -1202 1442.5 -1245.0Q1406.0 -1288 1406.0 -1341Q1406.0 -1394 1442.5 -1432.5Q1479.0 -1471 1542.0 -1471Q1605.0 -1471 1639.5 -1432.5Q1674.0 -1394 1674.0 -1341Q1674.0 -1288 1639.5 -1245.0Q1605.0 -1202 1542.0 -1202ZM1650.0 -1055V-860V-57L1793.0 -27V0H1323.0V-27L1466.0 -57V-856Q1455.0 -863 1433.0 -877.0Q1411.0 -891 1382.5 -909.0Q1354.0 -927 1323.0 -946V-964L1646.0 -1055Z M2149.0 -57 2292.0 -27V0H1822.0V-27L1965.0 -57V-1315Q1952.0 -1321 1928.5 -1331.5Q1905.0 -1342 1873.0 -1356.5Q1841.0 -1371 1802.0 -1389V-1407L2145.0 -1484H2149.0V-1310Z M2992.0 -666 3003.0 -624Q2862.0 -580 2774.5 -540.0Q2687.0 -500 2641.0 -460.0Q2595.0 -420 2578.0 -376.0Q2561.0 -332 2561.0 -279Q2561.0 -193 2611.0 -149.5Q2661.0 -106 2733.0 -106Q2791.0 -106 2834.0 -128.5Q2877.0 -151 2901.5 -194.5Q2926.0 -238 2926.0 -301V-760Q2926.0 -863 2875.5 -916.0Q2825.0 -969 2722.0 -969Q2673.0 -969 2623.5 -961.5Q2574.0 -954 2546.0 -940L2599.0 -980Q2596.0 -943 2589.5 -903.5Q2583.0 -864 2573.5 -832.0Q2564.0 -800 2551.0 -784Q2538.0 -768 2511.5 -759.0Q2485.0 -750 2457.0 -750Q2421.0 -750 2399.5 -764.5Q2378.0 -779 2378.0 -810Q2378.0 -852 2418.0 -893.5Q2458.0 -935 2521.5 -969.0Q2585.0 -1003 2658.5 -1023.5Q2732.0 -1044 2799.0 -1044Q2912.0 -1044 2980.0 -1011.0Q3048.0 -978 3079.0 -918.5Q3110.0 -859 3110.0 -779V-186Q3110.0 -153 3120.5 -133.0Q3131.0 -113 3150.0 -104.0Q3169.0 -95 3193.0 -95Q3227.0 -95 3260.5 -106.0Q3294.0 -117 3330.0 -142V-115Q3256.0 -27 3199.0 -3.5Q3142.0 20 3082.0 20Q3023.0 20 2989.0 -6.5Q2955.0 -33 2940.5 -83.0Q2926.0 -133 2923.0 -203H2926.0Q2909.0 -139 2871.0 -88.5Q2833.0 -38 2779.0 -9.0Q2725.0 20 2660.0 20Q2536.0 20 2453.0 -46.0Q2370.0 -112 2370.0 -238Q2370.0 -304 2392.5 -354.5Q2415.0 -405 2479.5 -451.0Q2544.0 -497 2667.5 -548.0Q2791.0 -599 2992.0 -666Z M3638.0 -860V-57L3781.0 -27V0H3311.0V-27L3454.0 -57V-856Q3438.0 -866 3408.5 -884.5Q3379.0 -903 3311.0 -946V-964L3634.0 -1055H3638.0ZM3958.0 -27 4102.0 -57V-700Q4102.0 -767 4078.5 -812.0Q4055.0 -857 4007.0 -879.5Q3959.0 -902 3883.0 -902Q3804.0 -902 3732.5 -880.5Q3661.0 -859 3614.0 -836L3601.0 -857Q3679.0 -915 3736.5 -952.0Q3794.0 -989 3839.0 -1009.0Q3884.0 -1029 3924.0 -1036.5Q3964.0 -1044 4009.0 -1044Q4156.0 -1044 4221.0 -965.5Q4286.0 -887 4286.0 -717V-57L4429.0 -27V0H3958.0Z";

// Mark + wordmark lockup, as in the sidebar. Colors follow the light / dark theme tokens.
function logoSvg(colors: { tile: string; glyph: string; text: string }): string {
  const scale = 3;
  const mark = MARK_VIEWBOX * scale;
  const em = 0.048;
  const textX = mark + 28;
  const baseline = Math.round(mark / 2 + (1340 * em) / 2);
  const width = Math.ceil(textX + 4457 * em);
  const { inset, radius } = MARK_TILE;
  const tile = MARK_VIEWBOX - 2 * inset;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${mark}" width="${width}" height="${mark}" role="img" aria-label="Bilan">`,
    `<g transform="scale(${scale})"><rect x="${inset}" y="${inset}" width="${tile}" height="${tile}" rx="${radius}" fill="${colors.tile}"/>`,
    `<path d="${MARK_GLYPH}" fill="none" stroke="${colors.glyph}" stroke-width="${MARK_STROKE}" stroke-linejoin="round" stroke-linecap="round"/></g>`,
    `<path transform="translate(${textX} ${baseline}) scale(${em})" d="${WORDMARK}" fill="${colors.text}"/>`,
    `</svg>\n`,
  ].join("");
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
    [
      "docs/images/logo.svg",
      Buffer.from(logoSvg({ tile: PRIMARY, glyph: PRIMARY_INK, text: "#15130f" })),
    ],
    [
      "docs/images/logo-dark.svg",
      Buffer.from(logoSvg({ tile: "#6fbf95", glyph: "#0f1114", text: "#f3efe6" })),
    ],
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
