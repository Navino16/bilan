"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { signOut } from "@/lib/auth-client";

export function useSignOut() {
  const router = useRouter();
  const locale = useLocale();
  return async function handleSignOut() {
    await signOut();
    router.push(`/${locale}/login`);
    router.refresh();
  };
}
