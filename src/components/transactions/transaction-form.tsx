"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useOpenFromQuery } from "@/hooks/use-open-from-query";
import { type FlatCategory } from "./category-tree";
import { CategoryCombobox } from "./category-combobox";
import { TRANSACTION_LABEL_MAX, TRANSACTION_TYPES } from "@/lib/validation/transaction";
import {
  createTransactionAction,
  type TxActionState,
} from "@/server/transport/actions/transactions";
import { NativeSelect } from "@/components/ui/native-select";
import { formatAmountInput } from "@/lib/format";

export function TransactionForm({
  accounts,
  categories,
  defaultAccountId,
  defaultOpen = false,
  trigger,
}: {
  accounts: { id: string; name: string }[];
  categories: FlatCategory[];
  defaultAccountId?: string;
  defaultOpen?: boolean;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const liveMobile = useIsMobile();
  // Frozen while open: swapping Sheet↔Dialog mid-entry would remount and wipe the fields.
  const [openMobile, setOpenMobile] = useState(liveMobile);
  const isMobile = open ? openMobile : liveMobile;

  useOpenFromQuery(defaultOpen, (mobile) => {
    setOpenMobile(mobile);
    setOpen(true);
  });

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

  function handleOpenChange(next: boolean) {
    if (next) setOpenMobile(liveMobile);
    setOpen(next);
    if (!next) setError(null);
  }

  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
        <DialogTitle className="font-display text-2xl">{t("createTitle")}</DialogTitle>
        <DialogDescription>{t("subtitle")}</DialogDescription>
      </DialogHeader>
      {/* onSubmit, not action=: React resets an action form's fields even on a server error. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAction(new FormData(e.currentTarget));
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="tx-account">{t("account")}</Label>
            <NativeSelect
              id="tx-account"
              name="accountId"
              defaultValue={defaultAccountId ?? accounts[0]?.id ?? ""}
              required
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
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
                placeholder={formatAmountInput(-12.34, locale)}
                required
                aria-invalid={error?.startsWith("AMOUNT_") || undefined}
                aria-describedby={error ? "tx-error" : undefined}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tx-label">{t("label")}</Label>
            <Input
              id="tx-label"
              name="label"
              placeholder={t("labelPlaceholder")}
              maxLength={TRANSACTION_LABEL_MAX}
              required
              aria-invalid={error?.startsWith("LABEL_") || undefined}
              aria-describedby={error?.startsWith("LABEL_") ? "tx-error" : undefined}
            />
          </div>
          <div className="grid gap-4 min-[24rem]:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tx-type">{t("type")}</Label>
              <NativeSelect id="tx-type" name="type" defaultValue="CARD">
                {TRANSACTION_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`types.${ty}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-category">{t("category")}</Label>
              <CategoryCombobox id="tx-category" name="categoryId" categories={categories} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tx-note">{t("note")}</Label>
            <Input id="tx-note" name="note" maxLength={1000} />
          </div>
          {error && (
            <p id="tx-error" role="alert" className="text-destructive text-sm">
              {t(`error.${error}`)}
            </p>
          )}
        </div>
        <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            <Check />
            {pending ? t("saving") : t("createCta")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );

  // Swap the whole root: a Sheet popup under a Dialog root never opens.
  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger render={trigger as React.ReactElement} />
      <SheetContent
        side="bottom"
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        {body}
      </DialogContent>
    </Dialog>
  );
}
