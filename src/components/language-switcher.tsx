"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const other = locale === "fr" ? "en" : "fr";

  function switchTo() {
    // Swap only the leading locale segment; read the query at click time so no
    // useSearchParams() Suspense boundary is needed on static pages.
    const next = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), `/${other}`);
    router.push(`${next}${window.location.search}${window.location.hash}`);
  }

  return (
    <Button variant="ghost" size="sm" onClick={switchTo} aria-label={`Switch language to ${other}`}>
      {other.toUpperCase()}
    </Button>
  );
}
