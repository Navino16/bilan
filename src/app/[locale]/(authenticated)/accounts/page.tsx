import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { listForUser } from "@/server/services/categories";
import { listGroupsForUser } from "@/server/services/groups";
import { flattenCategories } from "@/components/transactions/category-tree";
import { AccountList } from "@/components/accounts/account-list";
import { AccountForm } from "@/components/accounts/account-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("accounts");
  const accounts = await listVisibleForUser(user.id);
  const categories = flattenCategories(await listForUser(user.id));
  const groups = (await listGroupsForUser(user.id)).map((g) => ({ id: g.id, name: g.name }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <AccountForm
          mode="create"
          trigger={
            <Button>
              <Plus />
              {t("create")}
            </Button>
          }
        />
      </header>
      <AccountList accounts={accounts} groups={groups} categories={categories} />
    </div>
  );
}
