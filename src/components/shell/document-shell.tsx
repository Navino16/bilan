import { mono, sans, serif } from "@/lib/fonts";
import { currentTheme } from "@/server/theme";

export async function DocumentShell({
  lang,
  children,
}: {
  lang: string;
  children: React.ReactNode;
}) {
  const theme = await currentTheme();
  return (
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${mono.variable} h-full antialiased ${
        theme === "system" ? "" : theme
      }`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
