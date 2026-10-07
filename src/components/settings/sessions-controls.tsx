"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Laptop, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { overline } from "@/components/transactions/bits";
import { LocalDateTime } from "@/components/shell/local-date-time";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/server/transport/actions/auth";
import type { SessionView } from "@/server/services/users/sessions";

function useDeviceName(session: SessionView): string {
  const t = useTranslations("settings.security.sessionsCard");
  return [session.browser ?? t("unknownBrowser"), session.os].filter(Boolean).join(" · ");
}

function SessionRow({
  session,
  action,
  className,
}: {
  session: SessionView;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("settings.security.sessionsCard");
  const Icon = session.mobile ? Smartphone : Laptop;
  const name = useDeviceName(session);
  const activity = session.current ? t("activeNow") : t("active", { days: session.idleDays });
  return (
    <li className={`flex items-center gap-3 py-3 ${className ?? ""}`} data-session-id={session.id}>
      <Icon className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {name}
          {session.current && <Badge variant="secondary">{t("thisDevice")}</Badge>}
        </div>
        <div className="text-muted-foreground text-xs">
          {session.ipAddress && `${session.ipAddress} · `}
          {t.rich("signedIn", { time: () => <LocalDateTime value={session.signedInAt} /> })}
          {` · ${activity}`}
        </div>
      </div>
      {action}
    </li>
  );
}

function RevokeButton({
  session,
  disabled,
  onRevoke,
}: {
  session: SessionView;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const t = useTranslations("settings.security.sessionsCard");
  const device = useDeviceName(session);
  return (
    <Button
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={disabled}
      aria-label={t("revokeDevice", { device })}
      onClick={onRevoke}
    >
      {t("revoke")}
    </Button>
  );
}

export function SessionsControls({ sessions }: { sessions: SessionView[] }) {
  const t = useTranslations("settings.security.sessionsCard");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = sessions.find((s) => s.current);
  const others = sessions.filter((s) => !s.current);

  function run(action: () => ReturnType<typeof revokeOtherSessionsAction>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res && !res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2" data-slot="sessions-controls">
      {current && (
        <ul>
          <SessionRow session={current} />
        </ul>
      )}
      <div className="flex min-h-8 items-center justify-between gap-3 pt-2">
        <span className={overline}>{t("others", { count: others.length })}</span>
        {others.length > 0 && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => run(revokeOtherSessionsAction)}
          >
            {t("revokeAll")}
          </Button>
        )}
      </div>
      {others.length === 0 ? (
        <p className="text-muted-foreground border-t pt-3 text-sm">{t("none")}</p>
      ) : (
        <ul>
          {others.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              className="border-t"
              action={
                <RevokeButton
                  session={s}
                  disabled={pending}
                  onRevoke={() => run(() => revokeSessionAction(s.id))}
                />
              }
            />
          ))}
        </ul>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
