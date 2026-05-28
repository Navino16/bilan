import "./globals.css";

// Root layout is intentionally a pass-through.
// `<html>` / `<body>` live in `[locale]/layout.tsx` so the lang attribute is
// driven by the active locale.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
