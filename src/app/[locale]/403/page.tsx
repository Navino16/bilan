import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function ForbiddenPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("forbidden");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-4xl">403</h1>
      <p className="text-muted-foreground">{t("message")}</p>
      <Link href={`/${locale}/dashboard`} className="text-foreground text-sm hover:underline">
        {t("back")}
      </Link>
    </main>
  );
}
