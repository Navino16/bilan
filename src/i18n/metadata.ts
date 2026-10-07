import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type fr from "../../messages/fr.json";

export type PageTitleKey = keyof (typeof fr)["meta"]["titles"];

// The "· <app name>" suffix comes from the title template in [locale]/layout.tsx.
export function pageTitle(key: PageTitleKey) {
  return async function generateMetadata({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }): Promise<Metadata> {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: "meta.titles" });
    return { title: t(key) };
  };
}
