// Mirrors the Prisma SmtpSecurity enum, importable from client components.
export const SMTP_SECURITY_MODES = ["STARTTLS", "TLS", "NONE"] as const;
export type SmtpSecurityMode = (typeof SMTP_SECURITY_MODES)[number];
export const DEFAULT_SMTP_SECURITY: SmtpSecurityMode = "STARTTLS";

export const SMTP_DEFAULT_PORTS: Record<SmtpSecurityMode, number> = {
  STARTTLS: 587,
  TLS: 465,
  NONE: 25,
};

// A port the admin typed is kept; only a mode default follows the mode.
export function portAfterSecurityChange(port: string, next: SmtpSecurityMode): string {
  const isModeDefault = Object.values(SMTP_DEFAULT_PORTS).some((p) => String(p) === port.trim());
  return isModeDefault ? String(SMTP_DEFAULT_PORTS[next]) : port;
}
