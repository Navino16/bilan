"use client";

import { useLocale, useTranslations } from "next-intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { type FlatCategory } from "./category-picker";
import { CategoryCombobox } from "./category-combobox";
import { Pill, overline } from "./bits";

export type DetailItem = {
  id: string;
  date: string;
  amount: number;
  type: string;
  label: string;
  rawLabel: string;
  note: string | null;
  accountId: string;
  categoryId: string | null;
};

export type AccountMeta = { name: string; color: string | null; bankName: string | null };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className={overline}>{label}</div>
      {children}
    </div>
  );
}

export function TransactionDetail({
  item,
  accounts,
  categories,
  side,
  onClose,
  onRecategorize,
}: {
  item: DetailItem | null;
  accounts: Record<string, AccountMeta>;
  categories: FlatCategory[];
  side: "right" | "bottom";
  onClose: () => void;
  onRecategorize: (categoryId: string) => void;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();

  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const df = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const acc = item ? accounts[item.accountId] : undefined;

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={side}
        className="w-full gap-0 p-0 data-[side=bottom]:max-h-[85dvh] data-[side=bottom]:rounded-t-2xl sm:max-w-[380px]"
      >
        {item && (
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="border-border bg-card-2 space-y-1 border-b px-6 pt-6 pb-5">
              <div className={overline}>{t("detailOverline")}</div>
              <div
                className="font-display text-4xl leading-none tabular-nums"
                style={item.amount > 0 ? { color: "var(--income)" } : undefined}
              >
                {nf.format(item.amount)}
              </div>
              <div className="text-sm">{item.label}</div>
              <div className="text-muted-foreground text-xs capitalize">
                {df.format(new Date(item.date))}
              </div>
            </div>

            <div className="flex flex-col gap-5 px-6 py-6">
              <Field label={t("category")}>
                <CategoryCombobox
                  key={item.id}
                  name={`detail-cat-${item.id}`}
                  categories={categories}
                  defaultValue={item.categoryId}
                  onChange={(id) => id && onRecategorize(id)}
                />
              </Field>

              <Field label={t("account")}>
                <div className="border-border bg-card flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: acc?.color ?? "var(--ink-3)" }}
                  />
                  <span>{acc?.name}</span>
                  <span className="flex-1" />
                  {acc?.bankName && (
                    <span className="text-muted-foreground text-xs">{acc.bankName}</span>
                  )}
                </div>
              </Field>

              <Field label={t("type")}>
                <Pill>{t(`types.${item.type}`)}</Pill>
              </Field>

              <Field label={t("originalLabel")}>
                <div className="border-border bg-muted rounded-lg border px-3 py-2.5 font-mono text-xs break-words">
                  {item.rawLabel}
                </div>
              </Field>

              <Field label={t("note")}>
                <div className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-2.5 text-sm">
                  {item.note || t("notePlaceholder")}
                </div>
              </Field>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
