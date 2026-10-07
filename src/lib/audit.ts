// Action families offered by the audit viewer's filter; `?action=` matches as a prefix.
export const AUDIT_FAMILIES = [
  "auth",
  "user",
  "settings",
  "signup_token",
  "group",
  "account",
  "transaction",
  "import",
  "category",
  "rule",
  "budget",
  "link",
  "mail",
  "audit",
] as const;

export const AUDIT_ENTITIES = [
  "User",
  "Session",
  "Passkey",
  "AppSetting",
  "AuthProvider",
  "SmtpConfig",
  "AdminSignupToken",
  "Group",
  "GroupInvitation",
  "BankAccount",
  "AccountShare",
  "Transaction",
  "TransactionLink",
  "IgnoredLinkSuggestion",
  "ImportBatch",
  "Category",
  "CategorizationRule",
  "Budget",
  "BudgetAssignment",
] as const;

// i18n key (under `admin.audit.actions`) for an action code. App settings are
// audited as `settings.<key>.update` for any key, so they share one label.
export function auditActionMessage(code: string): {
  key: string;
  values?: Record<string, string>;
} {
  const setting = /^settings\.(.+)\.update$/.exec(code);
  if (setting && setting[1] !== "smtp" && setting[1] !== "auth_provider") {
    return { key: "settingUpdated", values: { key: setting[1] } };
  }
  return { key: code };
}
