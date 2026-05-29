import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/server/db";
import { Stepper } from "@/components/setup/stepper";

export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Belt-and-braces: the proxy guard already 404s /setup once a user exists,
  // but if reached directly we redirect home.
  const userCount = await db.user.count();
  if (userCount > 0) redirect(`/${locale}`);

  const t = await getTranslations("setup");
  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-4xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>
      <Stepper locale={locale} />
    </main>
  );
}
