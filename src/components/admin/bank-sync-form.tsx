"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { PlugZap, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import {
  deleteBankSyncConfigAction,
  saveBankSyncConfigAction,
  testBankSyncConfigAction,
  type BankSyncTestState,
} from "@/server/transport/actions/bank-sync";

export type BankSyncDefaults = { applicationId: string; enabled: boolean; hasKey: true } | null;

export function BankSyncForm({
  defaults,
  redirectUrl,
}: {
  defaults: BankSyncDefaults;
  redirectUrl: string;
}) {
  const t = useTranslations("admin.bankSync");
  // Remounts the fields once a removal reaches the props: inputs keep their mount-time value.
  const configured = defaults !== null;
  const [shown, setShown] = useState({ configured, generation: 0 });
  if (shown.configured !== configured) {
    setShown({ configured, generation: shown.generation + (configured ? 0 : 1) });
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      <div className="space-y-2">
        <Label htmlFor="bs-redirectUrl">{t("redirectUrl")}</Label>
        <div className="flex items-center gap-1">
          <Input
            id="bs-redirectUrl"
            data-slot="bank-sync-redirect"
            readOnly
            value={redirectUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-describedby="bs-redirectUrl-hint"
            className="font-mono text-xs"
          />
          <CopyLinkButton
            url={redirectUrl}
            label={t("copyRedirect")}
            copiedLabel={t("copiedRedirect")}
          />
        </div>
        <p id="bs-redirectUrl-hint" className="text-muted-foreground text-xs">
          {t("redirectUrlHint")}
        </p>
      </div>
      <ConfigForm key={shown.generation} defaults={defaults} />
      {defaults && <BankSyncTools />}
    </div>
  );
}

function ConfigForm({ defaults }: { defaults: BankSyncDefaults }) {
  const t = useTranslations("admin.bankSync");
  const router = useRouter();
  const keyRef = useRef<HTMLTextAreaElement>(null);
  const form = useActionForm(saveBankSyncConfigAction, {
    resetOnSuccess: false,
    onSuccess: () => {
      if (keyRef.current) keyRef.current.value = "";
      router.refresh();
    },
  });
  const { state, pending } = form;

  return (
    <form {...form.formProps} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="bs-applicationId">{t("applicationId")}</Label>
        <Input
          id="bs-applicationId"
          name="applicationId"
          defaultValue={defaults?.applicationId ?? ""}
          autoComplete="off"
          spellCheck={false}
          required
          {...form.fieldProps("applicationId")}
        />
        <FieldError form={form} name="applicationId" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bs-privateKey">{t("privateKey")}</Label>
        <textarea
          ref={keyRef}
          id="bs-privateKey"
          name="privateKey"
          rows={6}
          autoComplete="off"
          spellCheck={false}
          placeholder={defaults?.hasKey ? t("privateKeyKept") : "-----BEGIN PRIVATE KEY-----"}
          {...form.fieldProps("privateKey", "bs-privateKey-hint")}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive w-full rounded-lg border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:ring-3"
        />
        <p id="bs-privateKey-hint" className="text-muted-foreground text-xs">
          {t("privateKeyHint")}
        </p>
        <FieldError form={form} name="privateKey" />
      </div>
      <div className="flex items-start gap-2">
        <input
          id="bs-enabled"
          name="enabled"
          type="checkbox"
          value="true"
          defaultChecked={defaults?.enabled ?? false}
          aria-describedby="bs-enabled-hint"
          className="mt-0.5 size-4"
        />
        <div className="space-y-1">
          <Label htmlFor="bs-enabled">{t("enabled")}</Label>
          <p id="bs-enabled-hint" className="text-muted-foreground text-xs">
            {t("enabledHint")}
          </p>
        </div>
      </div>
      {state?.ok && (
        <Alert>
          <AlertDescription>{t("saved")}</AlertDescription>
        </Alert>
      )}
      {form.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t.has(`error.${form.error}`) ? t(`error.${form.error}`) : t("error.FAILED")}
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}

function TestResult({ result }: { result: NonNullable<BankSyncTestState> }) {
  const t = useTranslations("admin.bankSync.test");
  if (result.ok) {
    return (
      <Alert>
        <AlertDescription>
          {t("ok", {
            name: result.application.name,
            environment: result.application.environment ?? "—",
            active: String(result.application.active),
            count: result.aspspCount,
          })}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {result.error === "APP_INACTIVE" ? t("inactive") : t(`error.${result.error}`)}
      </AlertDescription>
    </Alert>
  );
}

function BankSyncTools() {
  const t = useTranslations("admin.bankSync");
  const router = useRouter();
  const [test, testAction, testing] = useActionState<BankSyncTestState>(
    testBankSyncConfigAction,
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [deleting, startDelete] = useTransition();

  function remove() {
    setDeleteError(false);
    startDelete(async () => {
      const res = await deleteBankSyncConfigAction();
      if (!res.ok) return setDeleteError(true);
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 border-t pt-5">
      <p className="text-muted-foreground text-sm">{t("test.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <form action={testAction}>
          <Button type="submit" variant="outline" disabled={testing}>
            <PlugZap />
            {testing ? t("test.running") : t("test.run")}
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            setDeleteError(false);
            setConfirmOpen(true);
          }}
        >
          <Trash2 />
          {t("remove")}
        </Button>
      </div>
      {test && <TestResult result={test} />}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("removeTitle")}
        description={t("removeBody")}
        confirmLabel={t("remove")}
        onConfirm={remove}
        pending={deleting}
        error={deleteError ? t("error.FAILED") : undefined}
      />
    </div>
  );
}
