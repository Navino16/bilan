import { notFound } from "next/navigation";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("notFound");

// Unmatched paths under a locale reach `[locale]/not-found` (localized) instead of the root one.
export default function CatchAllPage() {
  notFound();
}
