import localFont from "next/font/local";

// Self-hosted from @fontsource (latin subset) so builds never fetch Google Fonts (#332).
// next/font only accepts literal paths, relative to this file.
export const newsreader = localFont({
  variable: "--font-display",
  fallback: ["serif"],
  adjustFontFallback: "Times New Roman",
  src: [
    {
      path: "../../node_modules/@fontsource/newsreader/files/newsreader-latin-400-normal.woff2",
      weight: "400",
    },
    {
      path: "../../node_modules/@fontsource/newsreader/files/newsreader-latin-500-normal.woff2",
      weight: "500",
    },
    {
      path: "../../node_modules/@fontsource/newsreader/files/newsreader-latin-600-normal.woff2",
      weight: "600",
    },
  ],
});

export const ibmPlexSans = localFont({
  variable: "--font-sans",
  fallback: ["sans-serif"],
  src: [
    {
      path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2",
      weight: "400",
    },
    {
      path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2",
      weight: "500",
    },
    {
      path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
      weight: "600",
    },
  ],
});

export const ibmPlexMono = localFont({
  variable: "--font-mono",
  fallback: ["monospace"],
  adjustFontFallback: false,
  src: [
    {
      path: "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
      weight: "400",
    },
    {
      path: "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2",
      weight: "600",
    },
  ],
});
