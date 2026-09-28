import { cookies } from "next/headers";
import { mono, sans, serif } from "@/lib/fonts";
import { THEME_COOKIE } from "@/lib/theme";

export async function DocumentShell({
  lang,
  children,
}: {
  lang: string;
  children: React.ReactNode;
}) {
  const isDark = (await cookies()).get(THEME_COOKIE)?.value === "dark";
  return (
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${mono.variable} h-full antialiased ${
        isDark ? "dark" : ""
      }`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
