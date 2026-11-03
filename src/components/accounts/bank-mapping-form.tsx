"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FieldError } from "@/components/forms/field-error";
import { useActionForm, type ActionForm } from "@/components/forms/use-action-form";
import { ACCOUNT_NAME_MAX } from "@/lib/validation/account";
import type { MappingView } from "@/server/services/bank-sync/mapping";
import { saveBankMappingAction } from "@/server/transport/actions/bank-sync";

type BankRow = MappingView["accounts"][number];
type Target = MappingView["targets"][number];

// One select drives the action: "IGNORE", "CREATE" or "MAP:<account id>".
const mapValue = (accountId: string) => `MAP:${accountId}`;

export function BankMappingForm({ view }: { view: MappingView }) {
  const t = useTranslations("accounts.bankSync.mapping");
  const locale = useLocale();
  const router = useRouter();
  const form = useActionForm(saveBankMappingAction.bind(null, view.connectionId), {
    resetOnSuccess: false,
  });
  const { state, pending } = form;

  // A failed fetch may follow a saved mapping (e.g. a created account): rows re-read it.
  useEffect(() => {
    if (state && !state.ok && state.error !== "INVALID") router.refresh();
  }, [state, router]);

  if (view.accounts.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }
  if (state?.ok) {
    return (
      <Alert data-slot="bank-mapping-result">
        <AlertTitle>{t("done")}</AlertTitle>
        <AlertDescription className="space-y-3">
          <ul className="space-y-1">
            {state.accounts.map((a, i) => (
              <li key={i}>{t("imported", { name: a.name, count: a.imported })}</li>
            ))}
          </ul>
          <Link href={`/${locale}/accounts`} className={buttonVariants({ variant: "outline" })}>
            {t("back")}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form {...form.formProps} className="space-y-4">
      {view.accounts.map((row, i) => (
        <MappingRow
          key={`${row.id}:${row.accountId ?? ""}`}
          index={i}
          row={row}
          targets={view.targets}
          form={form}
        />
      ))}
      {form.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t.has(`error.${form.error}`) ? t(`error.${form.error}`) : t("error.FAILED")}
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

function MappingRow({
  index,
  row,
  targets,
  form,
}: {
  index: number;
  row: BankRow;
  targets: Target[];
  form: ActionForm;
}) {
  const t = useTranslations("accounts.bankSync.mapping");
  const field = (name: string) => `a.${index}.${name}`;
  const locked = row.syncedElsewhere || row.currency !== "EUR";
  const mappable = row.accountId && targets.some((x) => x.id === row.accountId);
  const [choice, setChoice] = useState(mappable ? mapValue(row.accountId!) : "IGNORE");
  const [syncFrom, setSyncFrom] = useState(row.defaultSyncFrom ?? "");
  const mappedTo = choice.startsWith("MAP:") ? choice.slice(4) : "";
  const action = locked ? "IGNORE" : mappedTo ? "MAP" : choice;
  const id = (name: string) => `bank-map-${index}-${name}`;

  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]" data-slot="bank-mapping-row">
      <input type="hidden" name={field("id")} value={row.id} />
      <input type="hidden" name={field("action")} value={action} />
      <input type="hidden" name={field("accountId")} value={locked ? "" : mappedTo} />
      <div className="min-w-0 space-y-0.5">
        <div id={id("bank")} className="truncate font-medium">
          {row.name}
        </div>
        <div className="text-muted-foreground text-xs">{row.currency}</div>
        {row.syncedElsewhere ? (
          <p className="text-muted-foreground text-sm">{t("syncedElsewhere")}</p>
        ) : row.currency !== "EUR" ? (
          <p className="text-muted-foreground text-sm">
            {t("unsupportedCurrency", { currency: row.currency })}
          </p>
        ) : null}
      </div>
      {!locked && (
        <>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={id("target")}>{t("target")}</Label>
            <NativeSelect
              id={id("target")}
              data-field={field("accountId")}
              value={choice}
              onChange={(e) => {
                const next = e.target.value;
                setChoice(next);
                const target = targets.find((x) => mapValue(x.id) === next);
                setSyncFrom(target?.defaultSyncFrom ?? "");
              }}
              {...form.fieldProps(field("accountId"), id("bank"))}
            >
              <option value="IGNORE">{t("ignore")}</option>
              {targets.map((x) => (
                <option key={x.id} value={mapValue(x.id)} disabled={x.syncedElsewhere}>
                  {x.syncedElsewhere ? t("syncedTarget", { name: x.name }) : x.name}
                </option>
              ))}
              <option value="CREATE">{t("create")}</option>
            </NativeSelect>
            <FieldError form={form} name={field("accountId")} />
            {action === "CREATE" && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor={id("name")}>{t("name")}</Label>
                <Input
                  id={id("name")}
                  name={field("name")}
                  defaultValue={row.name}
                  maxLength={ACCOUNT_NAME_MAX}
                  required
                  {...form.fieldProps(field("name"))}
                />
                <FieldError form={form} name={field("name")} />
              </div>
            )}
          </div>
          {action !== "IGNORE" && (
            <div className="space-y-1.5">
              <Label htmlFor={id("syncFrom")}>{t("syncFrom")}</Label>
              <Input
                id={id("syncFrom")}
                name={field("syncFrom")}
                type="date"
                value={syncFrom}
                onChange={(e) => setSyncFrom(e.target.value)}
                {...form.fieldProps(field("syncFrom"), id("syncFrom-hint"))}
              />
              <p id={id("syncFrom-hint")} className="text-muted-foreground max-w-56 text-xs">
                {t("syncFromHint")}
              </p>
              <FieldError form={form} name={field("syncFrom")} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
