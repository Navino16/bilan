"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { LocalDateTime } from "@/components/shell/local-date-time";
import { SectionCard } from "@/components/shell/section-card";
import { revokeOAuthGrantAction } from "@/server/transport/actions/mcp";
import type { OAuthGrantView } from "@/server/mcp/oauth-grants";

export function AiOAuthClients({ grants }: { grants: OAuthGrantView[] }) {
  const t = useTranslations("settings.ai.clients");
  const router = useRouter();
  const [target, setTarget] = useState<{ clientId: string; name: string } | null>(null);
  const [error, setError] = useState<"NOT_FOUND" | "FAILED" | null>(null);
  const [pending, startTransition] = useTransition();

  function revoke(clientId: string) {
    setError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof revokeOAuthGrantAction>>;
      try {
        res = await revokeOAuthGrantAction(clientId);
      } catch {
        res = { ok: false, error: "FAILED" };
      }
      if (!res.ok) setError(res.error);
      setTarget(null);
      router.refresh();
    });
  }

  const displayName = (grant: OAuthGrantView) => grant.name?.trim() || t("unnamed");

  return (
    <SectionCard flush title={t("title")} hint={t("hint")}>
      {grants.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm sm:px-6" data-slot="mcp-clients-empty">
          {t("none")}
        </p>
      ) : (
        <ul data-slot="mcp-clients">
          {grants.map((grant) => (
            <ClientRow
              key={grant.clientId}
              grant={grant}
              name={displayName(grant)}
              disabled={pending}
              onRevoke={() => setTarget({ clientId: grant.clientId, name: displayName(grant) })}
            />
          ))}
        </ul>
      )}
      {error && !target && (
        <div className="px-4 pb-4 sm:px-6">
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t("confirmTitle", { name: target?.name ?? "" })}
        description={t("confirmBody", { name: target?.name ?? "" })}
        confirmLabel={t("revoke")}
        onConfirm={() => target && revoke(target.clientId)}
        pending={pending}
      />
    </SectionCard>
  );
}

function ClientRow({
  grant,
  name,
  disabled,
  onRevoke,
}: {
  grant: OAuthGrantView;
  name: string;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const t = useTranslations("settings.ai.clients");
  const time = (value: Date) => ({ time: () => <LocalDateTime value={value} dateOnly /> });
  return (
    <li
      className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:px-6"
      data-client-id={grant.clientId}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="wrap-anywhere">{name}</span>
          <Badge variant="secondary">
            {grant.access === "write" ? t("scope.write") : t("scope.read")}
          </Badge>
        </div>
        <div className="text-muted-foreground text-xs wrap-anywhere tabular-nums">
          {grant.redirectHost && (
            <>
              <span className="font-mono">{grant.redirectHost}</span>
              {" · "}
            </>
          )}
          {t.rich("authorized", time(grant.authorizedAt))}
          {" · "}
          {grant.lastUsedAt ? t.rich("lastUsed", time(grant.lastUsedAt)) : t("neverUsed")}
        </div>
      </div>
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={disabled}
        aria-label={t("revokeClient", { name })}
        onClick={onRevoke}
      >
        {t("revoke")}
      </Button>
    </li>
  );
}
