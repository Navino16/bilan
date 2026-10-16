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
import {
  revokeAllTrustedDevicesAction,
  revokeTrustedDeviceAction,
  type TrustedDeviceActionState,
} from "@/server/transport/actions/two-factor";
import type { TrustedDeviceView } from "@/server/services/users/trusted-devices";

function TrustedDeviceRow({
  device,
  disabled,
  onRevoke,
}: {
  device: TrustedDeviceView;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const t = useTranslations("settings.security.trustedDevicesCard");
  const Icon = device.mobile ? Smartphone : Laptop;
  const name = [device.browser ?? t("unknownDevice"), device.os].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 border-t py-3" data-trusted-device-id={device.id}>
      <Icon className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {name}
          {device.current && <Badge variant="secondary">{t("thisDevice")}</Badge>}
        </div>
        <div className="text-muted-foreground text-xs">
          {t.rich("lastUsed", { time: () => <LocalDateTime value={device.lastUsedAt} /> })}
          {" · "}
          {t.rich("expires", { time: () => <LocalDateTime value={device.expiresAt} /> })}
        </div>
      </div>
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={disabled}
        aria-label={t("revokeDevice", { device: name })}
        onClick={onRevoke}
      >
        {t("revoke")}
      </Button>
    </li>
  );
}

export function TrustedDevicesControls({ devices }: { devices: TrustedDeviceView[] }) {
  const t = useTranslations("settings.security.trustedDevicesCard");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<TrustedDeviceActionState>) {
    setError(null);
    startTransition(async () => {
      const res = await action().catch(
        (): TrustedDeviceActionState => ({ ok: false, error: "FAILED" }),
      );
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2" data-slot="trusted-devices-controls">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className={overline}>{t("count", { count: devices.length })}</span>
        {devices.length > 0 && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => run(revokeAllTrustedDevicesAction)}
          >
            {t("revokeAll")}
          </Button>
        )}
      </div>
      {devices.length === 0 ? (
        <p className="text-muted-foreground border-t pt-3 text-sm">{t("none")}</p>
      ) : (
        <ul>
          {devices.map((d) => (
            <TrustedDeviceRow
              key={d.id}
              device={d}
              disabled={pending}
              onRevoke={() => run(() => revokeTrustedDeviceAction(d.id))}
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
