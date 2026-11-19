"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StepUpDialog, type StepUpFailure } from "@/components/auth/step-up-dialog";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { LocalDateTime } from "@/components/shell/local-date-time";
import { SectionCard } from "@/components/shell/section-card";
import {
  MCP_TOKEN_EXPIRY_CHOICES,
  MCP_TOKEN_NAME_MAX,
  MCP_TOKEN_PREFIX,
  MCP_TOKEN_SCOPES,
} from "@/lib/validation/mcp-token";
import {
  createMcpTokenAction,
  revokeMcpTokenAction,
  setMcpEnabledAction,
  type CreateMcpTokenState,
} from "@/server/transport/actions/mcp";
import { AiOAuthClients } from "@/components/settings/ai-oauth-clients";
import type { OAuthGrantView } from "@/server/mcp/oauth-grants";
import type { McpTokenView } from "@/server/mcp/tokens";
import type { StepUpMethod } from "@/server/services/users/step-up";

type TokenInput = { name: string; scope: string; expiresInDays: string };

export function AiAssistants({
  locale,
  enabled,
  endpoint,
  tokens,
  grants,
}: {
  locale: string;
  enabled: boolean;
  endpoint: string;
  tokens: McpTokenView[];
  grants: OAuthGrantView[];
}) {
  return (
    <>
      <AccessCard locale={locale} enabled={enabled} />
      <ConnectionCard enabled={enabled} endpoint={endpoint} />
      <AiOAuthClients grants={grants} />
      <TokensCard tokens={tokens} />
    </>
  );
}

function AccessCard({ locale, enabled }: { locale: string; enabled: boolean }) {
  const t = useTranslations("settings.ai.access");
  const router = useRouter();
  const [checked, setChecked] = useOptimistic(enabled);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<"INSTANCE_DISABLED" | "FAILED" | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: boolean) {
    setError(null);
    startTransition(async () => {
      setChecked(next);
      let res: Awaited<ReturnType<typeof setMcpEnabledAction>>;
      try {
        res = await setMcpEnabledAction(next, locale);
      } catch {
        res = { ok: false, error: "FAILED" };
      }
      if (!res.ok) {
        if (res.error === "INSTANCE_DISABLED") router.refresh();
        return setError(res.error);
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <SectionCard title={t("title")}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Label htmlFor="mcp-enabled">{t("switch")}</Label>
        <Switch
          id="mcp-enabled"
          checked={checked}
          disabled={pending}
          onCheckedChange={(next) => {
            if (!next) return save(false);
            setError(null);
            setConfirming(true);
          }}
        />
      </div>
      <Alert role="note">
        <AlertDescription>{t("privacy")}</AlertDescription>
      </Alert>
      {error && !confirming && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("confirmTitle")}
        description={t("privacy")}
        confirmLabel={pending ? t("enabling") : t("enable")}
        onConfirm={() => save(true)}
        pending={pending}
        destructive={false}
        error={error ? t(`error.${error}`) : undefined}
      />
    </SectionCard>
  );
}

function ConnectionCard({ enabled, endpoint }: { enabled: boolean; endpoint: string }) {
  const t = useTranslations("settings.ai.connection");
  return (
    <SectionCard title={t("title")} hint={enabled ? t("hint") : undefined}>
      {enabled ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Input
              readOnly
              value={endpoint}
              aria-label={t("endpoint")}
              aria-describedby="mcp-endpoint-header"
              className="font-mono text-xs"
              data-slot="mcp-endpoint"
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyLinkButton
              url={endpoint}
              icon={Copy}
              label={t("copy")}
              copiedLabel={t("copied")}
            />
          </div>
          <p id="mcp-endpoint-header" className="text-muted-foreground text-xs">
            {t.rich("header", {
              code: () => (
                <code className="font-mono">{`Authorization: Bearer ${MCP_TOKEN_PREFIX}…`}</code>
              ),
            })}
          </p>
          <p className="text-muted-foreground text-xs">{t("connector")}</p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("off")}</p>
      )}
    </SectionCard>
  );
}

function TokensCard({ tokens }: { tokens: McpTokenView[] }) {
  const t = useTranslations("settings.ai.tokens");
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<"NOT_FOUND" | "FAILED" | null>(null);
  const [pending, startTransition] = useTransition();

  function revoke(id: string) {
    setError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof revokeMcpTokenAction>>;
      try {
        res = await revokeMcpTokenAction(id);
      } catch {
        res = { ok: false, error: "FAILED" };
      }
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <SectionCard
      flush
      title={t("title")}
      hint={t("hint")}
      action={<Button onClick={() => setCreating(true)}>{t("create")}</Button>}
    >
      {tokens.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm sm:px-6" data-slot="mcp-tokens-empty">
          {t("none")}
        </p>
      ) : (
        <ul data-slot="mcp-tokens">
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              disabled={pending}
              onRevoke={() => revoke(token.id)}
            />
          ))}
        </ul>
      )}
      {error && (
        <div className="px-4 pb-4 sm:px-6">
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        </div>
      )}
      {creating && <CreateTokenDialog onClose={() => setCreating(false)} />}
    </SectionCard>
  );
}

function TokenRow({
  token,
  disabled,
  onRevoke,
}: {
  token: McpTokenView;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const t = useTranslations("settings.ai.tokens");
  const time = (value: Date) => ({ time: () => <LocalDateTime value={value} dateOnly /> });
  const expiry = token.expiresAt
    ? t.rich(token.expired ? "expired" : "expires", time(token.expiresAt))
    : t("noExpiry");
  return (
    <li
      className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:px-6"
      data-token-id={token.id}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="wrap-anywhere">{token.name}</span>
          <Badge variant="secondary">
            {token.scope === "write" ? t("scope.write") : t("scope.read")}
          </Badge>
        </div>
        <div className="text-muted-foreground text-xs wrap-anywhere tabular-nums">
          <span className="font-mono">{token.prefix}…</span>
          {" · "}
          {t.rich("created", time(token.createdAt))}
          {" · "}
          {token.lastUsedAt ? t.rich("lastUsed", time(token.lastUsedAt)) : t("neverUsed")}
          {" · "}
          {expiry}
        </div>
      </div>
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={disabled}
        aria-label={t("revokeToken", { name: token.name })}
        onClick={onRevoke}
      >
        {t("revoke")}
      </Button>
    </li>
  );
}

// Mounted only while open: the new token leaves memory with the dialog.
function CreateTokenDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("settings.ai.tokens");
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [reauth, setReauth] = useState<{ method: StepUpMethod; input: TokenInput } | null>(null);
  const form = useActionForm<CreateMcpTokenState | null>(
    async (_prev, formData) => {
      const input = {
        name: String(formData.get("name") ?? ""),
        scope: String(formData.get("scope") ?? ""),
        expiresInDays: String(formData.get("expiresInDays") ?? ""),
      };
      try {
        const res = await createMcpTokenAction(input);
        if (!res.ok && "method" in res) setReauth({ method: res.method, input });
        return res;
      } catch {
        return { ok: false, error: "FAILED" };
      }
    },
    {
      resetOnSuccess: false,
      summarizeFieldErrors: false,
      onSuccess: (state) => {
        setToken(state.token);
        router.refresh();
      },
    },
  );

  async function createWithPassword(password: string): Promise<{ ok: true } | StepUpFailure> {
    if (!reauth) return { ok: false, error: "FAILED" };
    const res = await createMcpTokenAction(reauth.input, password);
    if (!res.ok) return res;
    setToken(res.token);
    router.refresh();
    return { ok: true };
  }

  const formError =
    form.error && form.error !== "REAUTH_REQUIRED"
      ? t(form.error === "INVALID" ? "form.error.INVALID" : "form.error.FAILED")
      : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !form.pending && onClose()}>
      <DialogContent data-slot="mcp-token-dialog">
        {token ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("shown.title")}</DialogTitle>
              <DialogDescription>{t("shown.description")}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-1">
              <Input
                readOnly
                autoFocus
                value={token}
                aria-label={t("shown.label")}
                className="font-mono text-xs"
                data-slot="mcp-token-value"
                onFocus={(e) => e.currentTarget.select()}
              />
              <CopyLinkButton
                url={token}
                icon={Copy}
                label={t("shown.copy")}
                copiedLabel={t("shown.copied")}
              />
            </div>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                {t("shown.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form {...form.formProps} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("form.title")}</DialogTitle>
              <DialogDescription>{t("form.description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="mcp-token-name">{t("form.name")}</Label>
              <Input
                id="mcp-token-name"
                name="name"
                required
                maxLength={MCP_TOKEN_NAME_MAX}
                autoComplete="off"
                placeholder={t("form.namePlaceholder")}
                {...form.fieldProps("name")}
              />
              <FieldError form={form} name="name" />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("form.access")}</legend>
              <RadioGroup
                name="scope"
                defaultValue="read"
                aria-describedby="mcp-token-access-hint"
                className="grid-cols-1 sm:grid-cols-2"
              >
                {MCP_TOKEN_SCOPES.map((scope) => (
                  <Label
                    key={scope}
                    htmlFor={`mcp-token-scope-${scope}`}
                    className="gap-3 rounded-lg border p-3 font-normal"
                  >
                    <RadioGroupItem id={`mcp-token-scope-${scope}`} value={scope} />
                    {scope === "write" ? t("scope.write") : t("scope.read")}
                  </Label>
                ))}
              </RadioGroup>
              <p id="mcp-token-access-hint" className="text-muted-foreground text-xs">
                {t("form.accessHint")}
              </p>
              <FieldError form={form} name="scope" />
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="mcp-token-expiry">{t("form.expiry")}</Label>
              <NativeSelect
                id="mcp-token-expiry"
                name="expiresInDays"
                defaultValue="90"
                {...form.fieldProps("expiresInDays")}
              >
                {MCP_TOKEN_EXPIRY_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`form.expiryChoice.${choice}`)}
                  </option>
                ))}
              </NativeSelect>
              <FieldError form={form} name="expiresInDays" />
            </div>
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={form.pending}>
                {form.pending ? t("form.submitting") : t("form.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
        {reauth && (
          <StepUpDialog
            method={reauth.method}
            purpose="mcpToken"
            confirm={createWithPassword}
            onConfirmed={() => setReauth(null)}
            onClose={() => setReauth(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
