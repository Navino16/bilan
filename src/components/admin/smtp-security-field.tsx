"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SMTP_SECURITY_MODES, type SmtpSecurityMode } from "@/lib/smtp-security";

// Shared by the admin SMTP form and the setup wizard.
export function SmtpSecurityField({
  id,
  name,
  value,
  onChange,
}: {
  id: string;
  name?: string;
  value: SmtpSecurityMode;
  onChange: (mode: SmtpSecurityMode) => void;
}) {
  const t = useTranslations("admin.smtp.security");
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("label")}</Label>
      <NativeSelect
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value as SmtpSecurityMode)}
        aria-describedby={hintId}
      >
        {SMTP_SECURITY_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {t(mode)}
          </option>
        ))}
      </NativeSelect>
      <p id={hintId} className="text-muted-foreground text-xs">
        {t(`hint.${value}`)}
      </p>
    </div>
  );
}
