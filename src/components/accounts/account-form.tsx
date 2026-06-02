"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/validation/account";
import { createAccountAction, updateAccountAction } from "@/server/transport/actions/accounts";

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
  balance: number;
};

export function AccountForm({
  mode,
  account,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  account?: EditableAccount;
  /** Omit to drive the dialog from `open`/`onOpenChange` (e.g. a menu item). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [type, setType] = useState<AccountType>((account?.type as AccountType) ?? "CHECKING");
  const [color, setColor] = useState<string>(account?.color ?? DEFAULT_COLOR);
  const colorPickerRef = useRef<HTMLInputElement>(null);
  const isCustomColor = !COLOR_PALETTE.includes(color as (typeof COLOR_PALETTE)[number]);

  // Drive the action manually so the dialog closes on success without a
  // setState-in-effect (banned by react-hooks/set-state-in-effect).
  function handleAction(formData: FormData) {
    formData.set("type", type);
    formData.set("color", color);
    startTransition(async () => {
      const act = mode === "create" ? createAccountAction : updateAccountAction;
      const result = await act(null, formData);
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
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
          <span className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
            {t("new")}
          </span>
          <DialogTitle className="font-display text-2xl">
            {mode === "create" ? t("createTitle") : t("editTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("createSubtitle") : t("editSubtitle")}
          </DialogDescription>
        </DialogHeader>

        <form action={handleAction} className="flex min-h-0 flex-1 flex-col">
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-bankName">{t("bankName")}</Label>
                <Input
                  id="acc-bankName"
                  name="bankName"
                  defaultValue={account?.bankName ?? ""}
                  placeholder={t("bankPlaceholder")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="acc-balance">{t("initialBalance")}</Label>
              <div className="bg-muted/40 border-input flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5">
                <input
                  id="acc-balance"
                  name="initialBalance"
                  inputMode="decimal"
                  defaultValue={account ? String(account.balance) : ""}
                  placeholder="0,00"
                  className="font-display text-foreground placeholder:text-muted-foreground w-full border-0 bg-transparent text-lg outline-none"
                />
                <span className="text-muted-foreground text-sm">€</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="acc-iban">{t("ibanEncrypted")}</Label>
              <div className="relative">
                <Lock className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  id="acc-iban"
                  name="iban"
                  autoComplete="off"
                  placeholder={t("ibanPlaceholder")}
                  className="pl-8"
                />
              </div>
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

            <div className="flex items-start gap-2 rounded-lg bg-[var(--info-bg)] p-3 text-xs text-[var(--info)]">
              <Info className="mt-px size-3.5 shrink-0" />
              <span>{t("privacyNote")}</span>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{t(`error.${error}`)}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              <Check />
              {pending ? t("saving") : mode === "create" ? t("createCta") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
