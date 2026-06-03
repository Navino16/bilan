"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";

export function TransactionFilters({
  accounts,
  categories,
}: {
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; depth: number }[];
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Input
        type="search"
        placeholder={t("searchPlaceholder")}
        defaultValue={params.get("search") ?? ""}
        onChange={(e) => setParam("search", e.target.value)}
        aria-label={t("search")}
      />
      <select
        aria-label={t("account")}
        defaultValue={params.get("accountId") ?? ""}
        onChange={(e) => setParam("accountId", e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        <option value="">{t("allAccounts")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t("category")}
        defaultValue={params.get("categoryId") ?? ""}
        onChange={(e) => setParam("categoryId", e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        <option value="">{t("allCategories")}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {`${"  ".repeat(c.depth)}${c.name}`}
          </option>
        ))}
      </select>
      <select
        aria-label={t("type")}
        defaultValue={params.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        <option value="">{t("allTypes")}</option>
        {TRANSACTION_TYPES.map((ty) => (
          <option key={ty} value={ty}>
            {t(`types.${ty}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
