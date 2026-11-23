"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MailCheck, MoreVertical, Trash2, TriangleAlert, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import {
  adminDeleteUserAction,
  adminMarkEmailVerifiedAction,
  getUserDeletionImpactAction,
  setUserDisabledAction,
  type UserLifecycleState,
} from "@/server/transport/actions/admin";
import type { UserDeletionImpact } from "@/server/services/users/lifecycle";

export function UserActions({
  userId,
  email,
  label,
  disabled,
  canDisable,
  canDelete,
  canVerifyEmail,
}: {
  userId: string;
  email: string;
  label: string;
  disabled: boolean;
  canDisable: boolean;
  canDelete: boolean;
  canVerifyEmail: boolean;
}) {
  const t = useTranslations("admin.users");
  const router = useRouter();
  const [dialog, setDialog] = useState<"toggle" | "verify" | "delete" | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<Exclude<UserLifecycleState, { ok: true } | null> | null>(null);
  const [impact, setImpact] = useState<UserDeletionImpact | null>(null);
  const [pending, startTransition] = useTransition();

  function open(kind: "toggle" | "verify" | "delete") {
    setError(null);
    setTyped("");
    setImpact(null);
    setDialog(kind);
    if (kind !== "delete") return;
    getUserDeletionImpactAction(userId)
      .then((res) => (res.ok ? setImpact(res.impact) : setError(res)))
      .catch(() => setError({ ok: false, error: "FAILED" }));
  }

  function run(action: () => Promise<UserLifecycleState>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res?.ok) return setError(res ?? { ok: false, error: "FAILED" });
      setDialog(null);
      router.refresh();
    });
  }

  function toggle() {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("disabled", String(!disabled));
    run(() => setUserDisabledAction(null, fd));
  }

  function verifyEmail() {
    const fd = new FormData();
    fd.set("userId", userId);
    run(() => adminMarkEmailVerifiedAction(null, fd));
  }

  function remove() {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("confirmEmail", typed);
    run(() => adminDeleteUserAction(null, fd));
  }

  const errorText = error ? t(`lifecycleError.${error.error}`) : undefined;
  const warnings = impact
    ? [
        ...(impact.accounts > 0
          ? [t("deleteAccounts", { count: impact.accounts, shared: impact.sharedAccounts })]
          : []),
        ...impact.transfers.map((tr) => t("deleteTransfer", tr)),
        ...impact.deletedGroups.map((group) => t("deleteGroup", { group })),
        ...(impact.budgetLines > 0 ? [t("deleteBudgetLines")] : []),
      ]
    : [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("actionsFor", { user: label })}
              disabled={pending}
            />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canDisable && (
            <DropdownMenuItem onClick={() => open("toggle")}>
              {disabled ? <UserCheck /> : <UserX />}
              {disabled ? t("enable") : t("disable")}
            </DropdownMenuItem>
          )}
          {canVerifyEmail && (
            <DropdownMenuItem onClick={() => open("verify")}>
              <MailCheck />
              {t("verifyEmail")}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onClick={() => open("delete")}>
              <Trash2 />
              {t("delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={dialog === "toggle"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={disabled ? t("enableTitle", { user: label }) : t("disableTitle", { user: label })}
        description={disabled ? t("enableBody") : t("disableBody")}
        confirmLabel={disabled ? t("enable") : t("disable")}
        destructive={!disabled}
        onConfirm={toggle}
        pending={pending}
        error={dialog === "toggle" ? errorText : undefined}
      />

      <ConfirmDialog
        open={dialog === "verify"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("verifyEmailTitle", { user: label })}
        description={t("verifyEmailBody", { email })}
        confirmLabel={t("verifyEmailConfirm")}
        destructive={false}
        onConfirm={verifyEmail}
        pending={pending}
        error={dialog === "verify" ? errorText : undefined}
      />

      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("deleteTitle", { user: label })}
        description={t("deleteBody")}
        confirmLabel={t("delete")}
        onConfirm={remove}
        confirmDisabled={!impact || typed.trim().toLowerCase() !== email.toLowerCase()}
        pending={pending}
        error={dialog === "delete" ? errorText : undefined}
      >
        {impact
          ? warnings.length > 0 && (
              <ul data-slot="user-deletion-impact" className="space-y-1.5 text-sm">
                {warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2">
                    <TriangleAlert className="text-destructive mt-0.5 size-3.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )
          : !error && <p className="text-muted-foreground text-sm">{t("deleteLoading")}</p>}
        <div className="space-y-2">
          <Label htmlFor={`delete-confirm-${userId}`} className="block leading-snug wrap-anywhere">
            {t("deleteType", { email })}
          </Label>
          <Input
            id={`delete-confirm-${userId}`}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
