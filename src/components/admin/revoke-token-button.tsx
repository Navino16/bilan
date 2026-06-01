"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { revokeSignupTokenAction } from "@/server/transport/actions/admin";

export function RevokeTokenButton({ id }: { id: string }) {
  const t = useTranslations("admin.signupTokens");
  const router = useRouter();
  const [state, action, pending] = useActionState(revokeSignupTokenAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("revoke")}
      </Button>
    </form>
  );
}
