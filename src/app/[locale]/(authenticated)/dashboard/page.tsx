import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/server/auth/permissions";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("dashboard");
  const name = user.name?.trim() || user.email;

  const placeholders = ["balance", "expenses", "income"] as const;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl">{t("greeting", { name })}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {placeholders.map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardDescription>{t(`cards.${key}.label`)}</CardDescription>
              <CardTitle className="font-display text-2xl">—</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">{t("comingSoon")}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
