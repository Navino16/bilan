"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { syncLocaleAction } from "@/server/transport/actions/preferences";

// `syncPreference`: signed-in shells also save the choice, so emails follow it (#214).
export function LanguageSwitcher({ syncPreference = false }: { syncPreference?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("shell");
  const other = locale === "fr" ? "en" : "fr";

  async function switchTo() {
    // Swap only the leading locale segment; read the query at click time so no
    // useSearchParams() Suspense boundary is needed on static pages.
    const next = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), `/${other}`);
    const target = `${next}${window.location.search}${window.location.hash}`;
    if (syncPreference) await syncLocaleAction(other).catch(() => {});
    router.push(target);
  }

  return (
    <Button variant="ghost" size="sm" onClick={switchTo} aria-label={t("switchLanguage")}>
      {other.toUpperCase()}
    </Button>
  );
}
