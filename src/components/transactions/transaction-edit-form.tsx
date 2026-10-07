"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { TRANSACTION_LABEL_MAX, TRANSACTION_TYPES } from "@/lib/validation/transaction";
import { updateTransactionAction } from "@/server/transport/actions/transactions";

export type EditableItem = {
  id: string;
  date: string; // ISO
  amount: number;
  type: string;
  label: string;
  note: string | null;
  linked: boolean;
};

// "-8.5" → "-8,50" where the locale writes decimals with a comma (readAmount takes both).
function amountInputValue(amount: number, locale: string): string {
  const decimal = new Intl.NumberFormat(locale)
    .formatToParts(1.5)
    .find((p) => p.type === "decimal");
  const s = amount.toFixed(2);
  return decimal?.value === "," ? s.replace(".", ",") : s;
}

export function TransactionEditForm({
  item,
  limitedBy,
  onSaved,
  onCancel,
}: {
  item: EditableItem;
  // Why only label/note are offered (see `editScope`); null = every field.
  limitedBy: "imported" | "archived" | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    formData.set("id", item.id);
    startTransition(async () => {
      const result = await updateTransactionAction(formData);
      if (result?.ok) {
        setError(null);
        onSaved();
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  return (
    // onSubmit, not action=: React resets an action form's fields even on a server error.
    <form
      data-slot="transaction-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-4"
    >
      {limitedBy && (
        <p className="text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 text-xs">
          {t(`editLimited.${limitedBy}`)}
        </p>
      )}
      {!limitedBy && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tx-edit-date">{t("date")}</Label>
              <Input
                id="tx-edit-date"
                name="date"
                type="date"
                required
                defaultValue={item.date.slice(0, 10)}
                aria-invalid={error === "DATE_INVALID" || undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-edit-amount">{t("amount")}</Label>
              <Input
                id="tx-edit-amount"
                name="amount"
                inputMode="decimal"
                required
                defaultValue={amountInputValue(item.amount, locale)}
                aria-invalid={error?.startsWith("AMOUNT_") || undefined}
                aria-describedby={
                  [error && "tx-edit-error", item.linked && "tx-edit-linked"]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              />
            </div>
          </div>
          {item.linked && (
            <p
              id="tx-edit-linked"
              data-slot="linked-amount-warning"
              className="-mt-2 rounded-lg px-3 py-2 text-xs"
              style={{ color: "var(--warning)", background: "var(--warning-bg)" }}
            >
              {t("editLinkedWarning")}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="tx-edit-type">{t("type")}</Label>
            <NativeSelect id="tx-edit-type" name="type" defaultValue={item.type}>
              {TRANSACTION_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`types.${ty}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor="tx-edit-label">{t("label")}</Label>
        <Input
          id="tx-edit-label"
          name="label"
          required
          maxLength={TRANSACTION_LABEL_MAX}
          defaultValue={item.label}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tx-edit-note">{t("note")}</Label>
        <Input id="tx-edit-note" name="note" maxLength={1000} defaultValue={item.note ?? ""} />
      </div>
      {error && (
        <p id="tx-edit-error" role="alert" className="text-destructive text-sm">
          {t(`error.${error}`)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          <Check />
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
