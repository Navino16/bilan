"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { regenerateBackupCodesAction } from "@/server/transport/actions/two-factor";

export type TwoFactorFailure = { error: string; retryAfter?: number };

export function useTwoFactorErrorText() {
  const t = useTranslations("settings.security");
  return (failure: TwoFactorFailure | null) =>
    !failure
      ? null
      : failure.error === "RATE_LIMITED" && failure.retryAfter
        ? t("error.rateLimitedFor", { minutes: Math.ceil(failure.retryAfter / 60) })
        : t(`error.${failure.error}`);
}

// Shown once, at enrolment or after a regeneration: the server never shows them again.
export function BackupCodeList({ codes }: { codes: string[] }) {
  const t = useTranslations("settings.security");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  // navigator.clipboard only exists in secure contexts; the codes stay readable and downloadable.
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopy("copied");
      setTimeout(() => setCopy("idle"), 2000);
    } catch {
      setCopy("failed");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`${codes.join("\n")}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "bilan-backup-codes.txt";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 40_000);
  }

  return (
    <div className="space-y-2">
      <ul
        aria-label={t("backupCodes")}
        className="bg-muted grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-xs sm:grid-cols-4"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyAll}>
          {copy === "copied" ? <Check /> : <Copy />}
          {copy === "copied" ? t("codesCopied") : t("copyCodes")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download />
          {t("downloadCodes")}
        </Button>
        <span aria-live="polite" className="text-muted-foreground text-xs">
          {copy === "failed" && t("copyCodesFailed")}
        </span>
      </div>
    </div>
  );
}

// Decision S1: a new set takes the password and a current TOTP or backup code.
export function BackupCodesControls({ remaining }: { remaining: number | null }) {
  const t = useTranslations("settings.security");
  const router = useRouter();
  const errorText = useTwoFactorErrorText();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<TwoFactorFailure | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setOpen(false);
    setPassword("");
    setCode("");
    setFailure(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    setPending(true);
    try {
      const res = await regenerateBackupCodesAction(password, code);
      if (!res.ok) return setFailure(res);
      close();
      setCodes(res.data.backupCodes);
      router.refresh();
    } catch {
      setFailure({ error: "FAILED" });
    } finally {
      setPending(false);
    }
  }

  const heading = <h3 className="text-sm font-medium">{t("backupCodes")}</h3>;

  if (codes) {
    return (
      <div className="space-y-3" data-slot="backup-codes-controls">
        {heading}
        <Alert>
          <AlertDescription>{t("codesRegenerated")}</AlertDescription>
        </Alert>
        <BackupCodeList codes={codes} />
        <Button type="button" variant="ghost" onClick={() => setCodes(null)}>
          {t("codesSaved")}
        </Button>
      </div>
    );
  }

  if (open) {
    return (
      <form onSubmit={submit} className="space-y-4" data-slot="backup-codes-controls">
        {heading}
        <p className="text-muted-foreground text-sm">{t("regenerateWarning")}</p>
        <div className="space-y-2 sm:w-1/2">
          <Label htmlFor="tfa-pw-codes">{t("password")}</Label>
          <Input
            id="tfa-pw-codes"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="space-y-2 sm:w-1/2">
          <Label htmlFor="tfa-code-codes">{t("disableCode")}</Label>
          <Input
            id="tfa-code-codes"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            aria-describedby="tfa-code-codes-hint"
            className="font-mono"
          />
          <p id="tfa-code-codes-hint" className="text-muted-foreground text-xs">
            {t("disableCodeHint")}
          </p>
        </div>
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{errorText(failure)}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !password || !code.trim()}>
            {pending ? t("working") : t("regenerate")}
          </Button>
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      data-slot="backup-codes-controls"
    >
      <div className="space-y-0.5">
        {heading}
        {remaining !== null && (
          <p className={`text-sm ${remaining <= 3 ? "text-destructive" : "text-muted-foreground"}`}>
            {t("codesLeft", { count: remaining })}
          </p>
        )}
      </div>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t("regenerate")}
      </Button>
    </div>
  );
}
