"use client";

import { useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  deleteSmtpConfigAction,
  sendSmtpTestAction,
  upsertSmtpAction,
  type SmtpTestState,
} from "@/server/transport/actions/settings";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

export type SmtpDefaults = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromAddress: string;
  fromName: string | null;
  enabled: boolean;
} | null;

export function SmtpForm({ defaults }: { defaults: SmtpDefaults }) {
  const t = useTranslations("admin.smtp");
  const router = useRouter();
  const form = useActionForm(upsertSmtpAction, {
    resetOnSuccess: false,
    onSuccess: () => router.refresh(),
  });
  const { state, pending } = form;

  return (
    <div className="space-y-6">
      <form {...form.formProps} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-host">{t("host")}</Label>
            <Input
              id="smtp-host"
              name="host"
              defaultValue={defaults?.host ?? ""}
              required
              {...form.fieldProps("host")}
            />
            <FieldError form={form} name="host" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-port">{t("port")}</Label>
            <Input
              id="smtp-port"
              name="port"
              type="number"
              defaultValue={defaults?.port ?? 587}
              required
              {...form.fieldProps("port")}
            />
            <FieldError form={form} name="port" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-username">{t("username")}</Label>
            <Input
              id="smtp-username"
              name="username"
              defaultValue={defaults?.username ?? ""}
              required
              {...form.fieldProps("username")}
            />
            <FieldError form={form} name="username" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-password">{t("password")}</Label>
            <Input
              id="smtp-password"
              name="password"
              type="password"
              placeholder={defaults ? t("passwordKept") : ""}
              required={!defaults}
              {...form.fieldProps("password")}
            />
            <FieldError form={form} name="password" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-from">{t("fromAddress")}</Label>
            <Input
              id="smtp-from"
              name="fromAddress"
              type="email"
              defaultValue={defaults?.fromAddress ?? ""}
              required
              {...form.fieldProps("fromAddress")}
            />
            <FieldError form={form} name="fromAddress" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-fromName">{t("fromName")}</Label>
            <Input id="smtp-fromName" name="fromName" defaultValue={defaults?.fromName ?? ""} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-secure">{t("secure")}</Label>
            <NativeSelect
              id="smtp-secure"
              name="secure"
              defaultValue={String(defaults?.secure ?? true)}
            >
              <option value="true">{t("secureTls")}</option>
              <option value="false">{t("securePlain")}</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-enabled">{t("enabled")}</Label>
            <NativeSelect
              id="smtp-enabled"
              name="enabled"
              defaultValue={String(defaults?.enabled ?? true)}
            >
              <option value="true">{t("on")}</option>
              <option value="false">{t("off")}</option>
            </NativeSelect>
          </div>
        </div>
        {state?.ok && (
          <Alert>
            <AlertDescription>{t("saved")}</AlertDescription>
          </Alert>
        )}
        {state && !state.ok && (
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </form>
      {defaults && <SmtpTools />}
    </div>
  );
}

function SmtpTools() {
  const t = useTranslations("admin.smtp");
  const locale = useLocale();
  const router = useRouter();
  const [test, testAction, testing] = useActionState<SmtpTestState, FormData>(
    sendSmtpTestAction,
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [deleting, startDelete] = useTransition();

  function remove() {
    setDeleteError(false);
    startDelete(async () => {
      const res = await deleteSmtpConfigAction();
      if (!res?.ok) return setDeleteError(true);
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 border-t pt-5">
      <p className="text-muted-foreground text-sm">{t("testHint")}</p>
      <div className="flex flex-wrap gap-2">
        <form action={testAction}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="outline" disabled={testing}>
            <Send />
            {testing ? t("testing") : t("test")}
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
      {test?.ok && (
        <Alert>
          <AlertDescription>{t("testSent", { to: test.to })}</AlertDescription>
        </Alert>
      )}
      {test && !test.ok && (
        <Alert variant="destructive">
          <AlertDescription>
            {test.error === "FAILED" ? t(`testError.${test.reason}`) : t(`testError.${test.error}`)}
          </AlertDescription>
        </Alert>
      )}
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
