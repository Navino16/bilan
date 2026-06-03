import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { ImportWizard } from "@/components/import/import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const accounts = (await listVisibleForUser(user.id))
    .filter((a) => a.access === "OWNER" || a.access === "WRITE")
    .map((a) => ({ id: a.id, name: a.name, bankName: a.bankName }));
  const categories = flattenCategories(await listForUser(user.id));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ImportWizard accounts={accounts} categories={categories} />
    </div>
  );
}
