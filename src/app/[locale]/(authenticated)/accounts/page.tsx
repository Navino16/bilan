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
import { PageHeader } from "@/components/shell/page-header";
import { pageTitle } from "@/i18n/metadata";

export const dynamic = "force-dynamic";

export const generateMetadata = pageTitle("accounts");

export default async function AccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("accounts");
  const accounts = await listVisibleForUser(user.id, { includeArchived: true });
  const categories = flattenCategories(await listForUser(user.id));
  const groups = (await listGroupsForUser(user.id)).map((g) => ({ id: g.id, name: g.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        overline={t("overline")}
        title={t("title")}
        actions={
          <AccountForm
            mode="create"
            trigger={
              <Button>
                <Plus />
                {t("create")}
              </Button>
            }
          />
        }
      />
      <AccountList accounts={accounts} groups={groups} categories={categories} />
    </div>
  );
}
