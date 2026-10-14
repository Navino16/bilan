"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Info, Lock, Plus } from "lucide-react";
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
import { useOpenFromQuery } from "@/hooks/use-open-from-query";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_BANK_NAME_MAX,
  ACCOUNT_IBAN_MAX,
  ACCOUNT_NAME_MAX,
  ACCOUNT_TYPES,
  type AccountType,
} from "@/lib/validation/account";
import { createAccountAction, updateAccountAction } from "@/server/transport/actions/accounts";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

// Light-mode hex values of the design's `--cat-*` palette. Stored as plain hex
// (schema validates `#rrggbb`) so the chosen accent is theme-independent.
const COLOR_PALETTE = [
  "#2f6b8f",
  "#6e5b8c",
  "#5e8c5a",
  "#c9763e",
  "#a86b9c",
  "#b68f36",
  "#8c5a3e",
  "#4a6675",
] as const;
const DEFAULT_COLOR = COLOR_PALETTE[0];

type EditableAccount = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  color: string | null;
  initialBalance: number;
  ibanMasked: string | null;
};

export function AccountForm({
  mode,
  account,
  trigger,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: {
  mode: "create" | "edit";
  account?: EditableAccount;
  /** Omit to drive the dialog from `open`/`onOpenChange` (e.g. a menu item). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("accounts");
  const locale = useLocale();
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpenRaw = onOpenChange ?? setUncontrolledOpen;
  const liveMobile = useIsMobile();
  // Freeze the mobile/desktop choice while the form is open: swapping the root
  // element (Sheet↔Dialog) mid-edit would remount the subtree and wipe typed
  // fields. Re-sync only when closed. `isMobile` is captured on open below.
  const [openMobile, setOpenMobile] = useState(liveMobile);
  const isMobile = open ? openMobile : liveMobile;

  useOpenFromQuery(defaultOpen, (mobile) => {
    setOpenMobile(mobile);
    setUncontrolledOpen(true);
  });

  const [type, setType] = useState<AccountType>((account?.type as AccountType) ?? "CHECKING");
  const [color, setColor] = useState<string>(account?.color ?? DEFAULT_COLOR);
  const [removeIban, setRemoveIban] = useState(false);

  // Each opening starts from the account (or blank) values, not the last submission.
  function setOpen(next: boolean) {
    if (next) {
      setType((account?.type as AccountType) ?? "CHECKING");
      setColor(account?.color ?? DEFAULT_COLOR);
      setRemoveIban(false);
      form.reset();
    }
    setOpenRaw(next);
  }
  const colorPickerRef = useRef<HTMLInputElement>(null);
  const isCustomColor = !COLOR_PALETTE.includes(color as (typeof COLOR_PALETTE)[number]);

  const form = useActionForm(
    (prev: Awaited<ReturnType<typeof createAccountAction>>, formData: FormData) => {
      formData.set("type", type);
      formData.set("color", color);
      if (removeIban) formData.set("removeIban", "1");
      return (mode === "create" ? createAccountAction : updateAccountAction)(prev, formData);
    },
    {
      onSuccess: (_, { stale }) => {
        if (!stale) {
          setRemoveIban(false);
          setOpen(false);
        }
        router.refresh();
      },
    },
  );

  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
        <span className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
          {mode === "create" ? t("new") : t("edit")}
        </span>
        <DialogTitle className="font-display text-2xl">
          {mode === "create" ? t("createTitle") : t("editTitle")}
        </DialogTitle>
        <DialogDescription>
          {mode === "create" ? t("createSubtitle") : t("editSubtitle")}
        </DialogDescription>
      </DialogHeader>

      <form {...form.formProps} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {mode === "edit" && account && <input type="hidden" name="id" value={account.id} />}

          <div className="space-y-2">
            <Label>{t("type")}</Label>
            <div className="bg-muted border-border inline-flex w-full gap-1 rounded-lg border p-[3px]">
              {ACCOUNT_TYPES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  aria-pressed={type === value}
                  className={cn(
                    "h-7 flex-1 rounded-md text-xs font-medium transition-all",
                    type === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`types.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="acc-name">{t("name")}</Label>
              <Input
                id="acc-name"
                name="name"
                defaultValue={account?.name}
                placeholder={t("namePlaceholder")}
                required
                maxLength={ACCOUNT_NAME_MAX}
                {...form.fieldProps("name")}
              />
              <FieldError form={form} name="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-bankName">{t("bankName")}</Label>
              <Input
                id="acc-bankName"
                name="bankName"
                defaultValue={account?.bankName ?? ""}
                placeholder={t("bankPlaceholder")}
                maxLength={ACCOUNT_BANK_NAME_MAX}
                {...form.fieldProps("bankName")}
              />
              <FieldError form={form} name="bankName" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="acc-balance">{t("initialBalance")}</Label>
            <div className="bg-muted/40 border-input flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5">
              <input
                id="acc-balance"
                name="initialBalance"
                inputMode="decimal"
                defaultValue={
                  account
                    ? account.initialBalance.toLocaleString(locale, {
                        minimumFractionDigits: 2,
                        useGrouping: false,
                      })
                    : ""
                }
                placeholder="0,00"
                className="font-display text-foreground placeholder:text-muted-foreground w-full border-0 bg-transparent text-lg outline-none"
                {...form.fieldProps("initialBalance")}
              />
              <span className="text-muted-foreground text-sm">€</span>
            </div>
            <FieldError form={form} name="initialBalance" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="acc-iban">{t("ibanEncrypted")}</Label>
            <div className="relative">
              <Lock className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                id="acc-iban"
                name="iban"
                autoComplete="off"
                disabled={removeIban}
                placeholder={
                  account?.ibanMasked
                    ? t("ibanKeep", { iban: account.ibanMasked })
                    : t("ibanPlaceholder")
                }
                className="pl-8"
                maxLength={ACCOUNT_IBAN_MAX}
                {...form.fieldProps("iban")}
              />
            </div>
            <FieldError form={form} name="iban" />
            {account?.ibanMasked && (
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={removeIban}
                  onChange={(e) => setRemoveIban(e.target.checked)}
                  className="border-input size-4 rounded border"
                />
                {t("ibanRemove")}
              </label>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("color")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "size-7 rounded-md border-2 transition-transform",
                    color === c ? "border-foreground" : "border-transparent hover:scale-105",
                  )}
                />
              ))}
              <button
                type="button"
                aria-label={t("customColor")}
                onClick={() => colorPickerRef.current?.click()}
                style={isCustomColor ? { backgroundColor: color } : undefined}
                className={cn(
                  "text-muted-foreground flex size-7 items-center justify-center rounded-md border-2 border-dashed",
                  isCustomColor ? "border-foreground" : "border-border hover:text-foreground",
                )}
              >
                {!isCustomColor && <Plus className="size-3.5" />}
              </button>
              <input
                ref={colorPickerRef}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
              />
            </div>
          </div>

          {mode === "create" && (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--info-bg)] p-3 text-xs text-[var(--info)]">
              <Info className="mt-px size-3.5 shrink-0" />
              <span>{t("privacyNote")}</span>
            </div>
          )}

          {form.error && (
            <Alert variant="destructive">
              <AlertDescription>{t(`error.${form.error}`)}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={form.pending}>
            <Check />
            {form.pending ? t("saving") : mode === "create" ? t("createCta") : t("save")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );

  const handleOpenChange = (next: boolean) => {
    if (next) setOpenMobile(liveMobile); // freeze the layout for this open session
    setOpen(next);
    if (!next) form.reset();
  };

  // Swap the whole root: a centered Dialog on desktop, a bottom Sheet on mobile.
  // (A Sheet popup under a Dialog root doesn't open — the root and its content
  // must come from the same primitive family.)
  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {trigger && <SheetTrigger render={trigger as React.ReactElement} />}
      <SheetContent
        side="bottom"
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        {body}
      </DialogContent>
    </Dialog>
  );
}
