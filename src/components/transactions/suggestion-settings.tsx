"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import { updateLinkSettingsAction } from "@/server/transport/actions/links";
import { LINK_WINDOW_DAYS_RANGE } from "@/lib/validation/link-settings";
import type { LinkSettings } from "@/lib/schemas/link-settings";
import { readAmount } from "@/lib/amount";
import { formatAmountInput } from "@/lib/format";

export function SuggestionSettings({ settings }: { settings: LinkSettings }) {
  const t = useTranslations("transactions.suggestions.settings");
  const [open, setOpen] = useState(false);
  const isMobile = useFrozenWhileOpen(open, useIsMobile());

  const trigger = (
    <Button variant="outline">
      <SlidersHorizontal />
      {t("open")}
    </Button>
  );
  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left max-md:px-5">
        <DialogTitle className="font-display text-2xl">{t("title")}</DialogTitle>
        <DialogDescription>{t("subtitle")}</DialogDescription>
      </DialogHeader>
      <SettingsForm settings={settings} onDone={() => setOpen(false)} />
    </>
  );

  return isMobile ? (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {body}
      </DialogContent>
    </Dialog>
  );
}

// Mounted with the dialog content, so a cancelled edit is gone on the next opening.
function SettingsForm({ settings, onDone }: { settings: LinkSettings; onDone: () => void }) {
  const t = useTranslations("transactions.suggestions.settings");
  const locale = useLocale();
  const router = useRouter();
  const [minAmount, setMinAmount] = useState(formatAmountInput(settings.minAmount, locale));
  const form = useActionForm(updateLinkSettingsAction, {
    summarizeFieldErrors: false,
    resetOnSuccess: false,
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });

  return (
    <form {...form.formProps} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 max-md:px-5">
        <input type="hidden" name="locale" value={locale} />
        <div className="space-y-2">
          <Label htmlFor="link-window-days">{t("windowDays")}</Label>
          <Input
            id="link-window-days"
            name="windowDays"
            type="number"
            inputMode="numeric"
            min={LINK_WINDOW_DAYS_RANGE.min}
            max={LINK_WINDOW_DAYS_RANGE.max}
            step={1}
            defaultValue={settings.windowDays}
            required
            {...form.fieldProps("windowDays", "link-window-days-hint")}
          />
          <p id="link-window-days-hint" className="text-muted-foreground text-xs">
            {t("windowDaysHint")}
          </p>
          <FieldError form={form} name="windowDays" values={LINK_WINDOW_DAYS_RANGE} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="link-min-amount">{t("minAmount")}</Label>
          <Input
            id="link-min-amount"
            name="minAmount"
            type="text"
            inputMode="decimal"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            onBlur={(e) => {
              const r = readAmount(e.target.value);
              if (r.ok) setMinAmount(formatAmountInput(r.value, locale));
            }}
            required
            {...form.fieldProps("minAmount", "link-min-amount-hint")}
          />
          <p id="link-min-amount-hint" className="text-muted-foreground text-xs">
            {t("minAmountHint")}
          </p>
          <FieldError form={form} name="minAmount" />
        </div>
        {form.error && (
          <Alert variant="destructive">
            <AlertDescription>{t("failed")}</AlertDescription>
          </Alert>
        )}
      </div>
      <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3 max-md:px-5">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={form.pending}>
          <Check />
          {form.pending ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
