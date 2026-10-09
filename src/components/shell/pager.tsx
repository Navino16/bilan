import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Prev/next links for a server-paginated list; `query` is the current filter set.
export async function Pager({
  page,
  pageCount,
  pathname,
  query,
}: {
  page: number;
  pageCount: number;
  pathname: string;
  query: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;
  const t = await getTranslations("shell.pager");
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const link = (p: number, label: string, icon: React.ReactNode, disabled: boolean) =>
    disabled ? (
      <span
        aria-disabled="true"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "opacity-50")}
      >
        {icon}
        {label}
      </span>
    ) : (
      <Link href={href(p)} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {icon}
        {label}
      </Link>
    );

  return (
    <nav
      aria-label={t("label")}
      data-slot="pager"
      className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm sm:px-6"
    >
      {link(page - 1, t("previous"), <ChevronLeft />, page <= 1)}
      <span className="text-muted-foreground tabular-nums">{t("status", { page, pageCount })}</span>
      {link(page + 1, t("next"), <ChevronRight />, page >= pageCount)}
    </nav>
  );
}
