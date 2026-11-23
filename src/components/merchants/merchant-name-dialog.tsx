"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
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
import { MERCHANT_NAME_MAX } from "@/lib/validation/merchant";
import {
  resetMerchantNameAction,
  saveMerchantNameAction,
  type MerchantActionState,
} from "@/server/transport/actions/merchants";

// `alias` set = an existing alias group (renamed as a whole); otherwise `key` is the
// single merchant to name. `keys` are the bank merchant keys, shown for context.
export type MerchantTarget = {
  key: string | null;
  alias: string | null;
  keys: string[];
  label: string;
};

const MAX_SUGGESTIONS = 8;

// Either self-triggered (`trigger`) or controlled (`open`/`onOpenChange`).
export function MerchantNameDialog({
  target,
  names,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  target: MerchantTarget;
  names: string[];
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("merchants");
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [name, setName] = useState(target.alias ?? target.label);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const liveMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(liveMobile);
  const isMobile = open ? openMobile : liveMobile;

  const typed = name.trim().toLocaleLowerCase();
  const suggestions = names
    .filter((n) => n !== target.alias && n.toLocaleLowerCase().includes(typed))
    .slice(0, MAX_SUGGESTIONS);

  function run(action: () => Promise<MerchantActionState>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  // Reset on every opening, whoever opens it; the layout is frozen while open since
  // swapping Sheet↔Dialog would remount and wipe the input.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOpenMobile(liveMobile);
      setName(target.alias ?? target.label);
      setError(null);
    }
  }

  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
        <DialogTitle className="font-display text-2xl">{t("title")}</DialogTitle>
        <DialogDescription>
          {t(target.keys.length > 1 ? "bankLabels" : "bankLabel", {
            labels: target.keys.join(" · "),
          })}
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === (target.alias ?? target.label)) return setOpen(false);
          run(() => saveMerchantNameAction({ key: target.key, from: target.alias, name }));
        }}
      >
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="merchant-name">{t("name")}</Label>
            <Input
              id="merchant-name"
              value={name}
              maxLength={MERCHANT_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">{t("existing")}</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setName(n)}
                    aria-pressed={name === n}
                    className="border-border hover:bg-muted aria-pressed:bg-muted rounded-full border px-2.5 py-1 text-xs"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-muted-foreground text-xs">{t("hint")}</p>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{t(`error.${error}`)}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="bg-muted/40 border-border shrink-0 flex-row items-center justify-end border-t px-6 py-3">
          {target.alias && (
            <Button
              type="button"
              variant="link"
              className="text-muted-foreground mr-auto px-0"
              disabled={pending}
              onClick={() => run(() => resetMerchantNameAction(target.alias!))}
            >
              {t("reset")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            <Check />
            {pending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );

  return isMobile ? (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger && <SheetTrigger render={trigger} />}
      <SheetContent
        side="bottom"
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {body}
      </DialogContent>
    </Dialog>
  );
}
