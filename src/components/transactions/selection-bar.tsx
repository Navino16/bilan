"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Floats above the mobile bottom nav (~4.5rem) so the actions stay in reach while scrolling.
export function SelectionBar({
  count,
  hiddenAnchor,
  linkPending,
  error,
  onExit,
  onLink,
  onDelete,
}: {
  count: number;
  hiddenAnchor?: string | null;
  linkPending: boolean;
  error?: string | null;
  onExit: () => void;
  onLink: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("transactions");
  return (
    <div
      data-slot="selection-bar"
      className="bg-card fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[480px] flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-lg lg:bottom-6"
    >
      {hiddenAnchor && (
        <p
          data-slot="selection-anchor"
          className="text-muted-foreground w-full truncate px-1.5 text-xs"
        >
          {t("selection.with", { label: hiddenAnchor })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive w-full px-1.5 text-sm">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("selection.exit")}
        onClick={onExit}
      >
        <X />
      </Button>
      <span className="flex-1 text-sm font-medium">{t("selection.selected", { count })}</span>
      <Button type="button" disabled={count < 2 || linkPending} onClick={onLink}>
        {t("link.create")}
      </Button>
      <Button type="button" variant="destructive" disabled={count === 0} onClick={onDelete}>
        {t("delete.action")}
      </Button>
    </div>
  );
}
