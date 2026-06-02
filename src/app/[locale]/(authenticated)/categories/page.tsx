import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { CategoryList } from "@/components/categories/category-list";
import { CategoryForm } from "@/components/categories/category-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("categories");
  const tree = await listForUser(user.id);
  const parents = tree.map((n) => ({ id: n.id, name: n.name }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <CategoryForm
          mode="create"
          parents={parents}
          trigger={
            <Button>
              <Plus />
              {t("create")}
            </Button>
          }
        />
      </header>
      <CategoryList tree={tree} />
    </div>
  );
}
