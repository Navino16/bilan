"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { type FlatCategory } from "./category-picker";
import { CategoryCombobox } from "./category-combobox";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";
import {
  createTransactionAction,
  type TxActionState,
} from "@/server/transport/actions/transactions";

export function TransactionForm({
  accounts,
  categories,
  defaultAccountId,
  trigger,
}: {
  accounts: { id: string; name: string }[];
  categories: FlatCategory[];
  defaultAccountId?: string;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAction(formData: FormData) {
    startTransition(async () => {
      const result: TxActionState = await createTransactionAction(null, formData);
      if (result?.ok) {
        setError(null);
        setOpen(false);
        router.refresh();
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(n) => {
        setOpen(n);
        if (!n) setError(null);
      }}
    >
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
          <DialogTitle className="font-display text-2xl">{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form action={handleAction} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="tx-account">{t("account")}</Label>
              <select
                id="tx-account"
                name="accountId"
                defaultValue={defaultAccountId ?? accounts[0]?.id ?? ""}
                required
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tx-date">{t("date")}</Label>
                <Input id="tx-date" name="date" type="date" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-amount">{t("amount")}</Label>
                <Input
                  id="tx-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="-12,34"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-label">{t("label")}</Label>
              <Input id="tx-label" name="label" placeholder={t("labelPlaceholder")} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tx-type">{t("type")}</Label>
                <select
                  id="tx-type"
                  name="type"
                  defaultValue="CARD"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  {TRANSACTION_TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`types.${ty}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-category">{t("category")}</Label>
                <CategoryCombobox name="categoryId" categories={categories} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-note">{t("note")}</Label>
              <Input id="tx-note" name="note" maxLength={1000} />
            </div>
            {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
          </div>
          <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              <Check />
              {pending ? t("saving") : t("createCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
