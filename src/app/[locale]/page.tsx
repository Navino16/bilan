import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAppName } from "@/server/services/settings/app-settings";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tApp = await getTranslations("app");
  const appName = await getAppName();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
            {tApp("tagline")}
          </p>
          <h1 className="font-display text-5xl font-medium tracking-tight text-balance md:text-6xl">
            {appName}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base">{t("intro")}</p>
        </div>
        <ThemeToggle label={t("themeToggleLabel")} />
      </header>

      <section className="space-y-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
          {t("previewHeading")}
        </h2>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>{t("balanceLabel")}</CardDescription>
              <CardTitle className="font-mono text-3xl tracking-tight tabular-nums">
                12&nbsp;480,32&nbsp;€
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">USER</Badge>
            </CardContent>
          </Card>

          <Card style={{ backgroundColor: "var(--income-bg)" }}>
            <CardHeader>
              <CardDescription>{t("incomeLabel")}</CardDescription>
              <CardTitle
                className="font-mono text-3xl tracking-tight tabular-nums"
                style={{ color: "var(--income)" }}
              >
                +&nbsp;3&nbsp;420,00&nbsp;€
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge
                style={{ backgroundColor: "var(--income)", color: "var(--bilan-primary-ink)" }}
              >
                {t("demoBadgeIncome")}
              </Badge>
            </CardContent>
          </Card>

          <Card style={{ backgroundColor: "var(--expense-bg)" }}>
            <CardHeader>
              <CardDescription>{t("expenseLabel")}</CardDescription>
              <CardTitle
                className="font-mono text-3xl tracking-tight tabular-nums"
                style={{ color: "var(--expense)" }}
              >
                −&nbsp;1&nbsp;217,68&nbsp;€
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge
                style={{ backgroundColor: "var(--expense)", color: "var(--bilan-primary-ink)" }}
              >
                {t("demoBadgeExpense")}
              </Badge>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button>{t("demoButton")}</Button>
          <Button variant="secondary">{t("demoButtonSecondary")}</Button>
        </div>
      </section>

      <footer className="text-muted-foreground border-t pt-6 text-sm">{t("languageHint")}</footer>
    </main>
  );
}
