// Message namespaces each <ClientMessages> scope sends to the browser, checked against the
// client components of its routes by tests/unit/bundle/client-bundle.test.ts.
export const CLIENT_SCOPES = {
  root: [],
  auth: [
    "auth.login",
    "auth.passwordVisibility",
    "auth.register",
    "auth.reset",
    "auth.resetConfirm",
    "auth.sso",
    "auth.twoFactor",
    "forms.fieldError",
    "shell",
  ],
  setup: [
    "admin.smtp.security",
    "forms.fieldError",
    "setup.account",
    "setup.oidc",
    "setup.registration",
    "setup.smtp",
    "setup.steps",
  ],
  shell: ["errors", "shell"],
  accounts: [
    "accounts",
    "categories.colors",
    "forms.fieldError",
    "onboarding",
    "shell",
    "stepUp",
    "transactions",
  ],
  admin: ["admin", "forms.fieldError", "shell"],
  budgets: ["budgets", "forms.fieldError", "onboarding", "shell", "transactions.assignedMonth"],
  categories: [
    "categories",
    "forms.fieldError",
    "merchants",
    "rules",
    "shell",
    "stepUp",
    "transactions",
  ],
  dashboard: ["dashboard", "shell.period"],
  groups: ["forms.fieldError", "groups", "invitations", "shell"],
  import: ["import", "onboarding", "rules", "shell", "transactions"],
  insights: ["dashboard", "insights", "merchants", "shell"],
  settings: ["forms.fieldError", "settings.data", "settings.security", "shell", "stepUp"],
  transactions: ["budgets", "dashboard", "forms.fieldError", "rules", "shell", "transactions"],
} as const satisfies Record<string, readonly string[]>;

export type ClientScope = keyof typeof CLIENT_SCOPES;
