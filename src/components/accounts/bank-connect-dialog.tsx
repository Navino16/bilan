"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Landmark } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useActionForm } from "@/components/forms/use-action-form";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { BANK_COUNTRIES } from "@/lib/bank-sync";
import { normalizeText } from "@/lib/text";
import { listBanksAction, startBankAuthAction } from "@/server/transport/actions/bank-sync";

type Bank = { name: string; country: string; maxConsentDays: number };
type BankList = { country: string; banks: Bank[] | null; error: string | null };

export function BankConnectDialog() {
  const t = useTranslations("accounts.bankSync");
  const [open, setOpen] = useState(false);
  const isMobile = useFrozenWhileOpen(open, useIsMobile());
  const trigger = (
    <Button variant="outline" onClick={() => setOpen(true)}>
      <Landmark />
      {t("connect")}
    </Button>
  );
  const form = open && <ConnectForm onClose={() => setOpen(false)} />;
  return (
    <>
      {trigger}
      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="flex max-h-[92dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0"
          >
            {form}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">{form}</DialogContent>
        </Dialog>
      )}
    </>
  );
}

function ConnectForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("accounts.bankSync");
  const locale = useLocale();
  const [country, setCountry] = useState("FR");
  const [list, setList] = useState<BankList>({ country: "", banks: null, error: null });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const form = useActionForm(startBankAuthAction);

  useEffect(() => {
    let active = true;
    listBanksAction(country).then(
      (res) => {
        if (!active) return;
        setList(
          Array.isArray(res)
            ? { country, banks: res, error: null }
            : { country, banks: [], error: res.error },
        );
      },
      () => active && setList({ country, banks: [], error: "FAILED" }),
    );
    return () => {
      active = false;
    };
  }, [country]);

  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const loading = list.country !== country;
  const shown = useMemo(() => {
    const q = normalizeText(query);
    return (list.banks ?? []).filter((b) => !q || normalizeText(b.name).includes(q));
  }, [list.banks, query]);
  const error = form.error ?? (loading ? null : list.error);

  return (
    <form {...form.formProps} className="flex min-h-0 flex-col">
      <DialogHeader className="space-y-2 px-6 pt-5 pb-3 text-left max-md:px-5">
        <DialogTitle className="font-display text-2xl leading-tight">
          {t("dialog.title")}
        </DialogTitle>
        <p className="text-muted-foreground text-sm leading-relaxed">{t("dialog.intro")}</p>
      </DialogHeader>
      <div className="flex min-h-0 flex-col gap-3 px-6 pb-4 max-md:px-5">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="bank-country">{t("dialog.country")}</Label>
            <NativeSelect
              id="bank-country"
              name="country"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setPicked("");
              }}
            >
              {BANK_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {regionNames.of(c) ?? c}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-search">{t("dialog.search")}</Label>
            <Input
              id="bank-search"
              type="search"
              value={query}
              placeholder={t("dialog.searchPlaceholder")}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <fieldset className="min-h-0 space-y-1.5">
          <legend className="text-sm font-medium">{t("dialog.banks")}</legend>
          <div
            className="border-border max-h-72 overflow-y-auto rounded-lg border"
            aria-busy={loading}
          >
            {loading ? (
              <p className="text-muted-foreground p-3 text-sm">{t("dialog.loading")}</p>
            ) : shown.length === 0 ? (
              <p className="text-muted-foreground p-3 text-sm">{t("dialog.empty")}</p>
            ) : (
              shown.map((b) => (
                <label
                  key={b.name}
                  className="hover:bg-muted/50 has-checked:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="aspspName"
                    value={b.name}
                    checked={picked === b.name}
                    onChange={() => setPicked(b.name)}
                    className="size-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{b.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {t("dialog.consent", { days: b.maxConsentDays })}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </fieldset>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {t.has(`error.${error}`) ? t(`error.${error}`) : t("error.FAILED")}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3 max-md:px-5">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("dialog.cancel")}
        </Button>
        <Button type="submit" disabled={!picked || form.pending}>
          {form.pending ? t("dialog.submitting") : t("dialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
