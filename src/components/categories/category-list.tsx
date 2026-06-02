"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CategoryForm, type EditableCategory, type ParentOption } from "./category-form";
import { deleteCategoryAction } from "@/server/transport/actions/categories";

type Node = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  scope: "USER" | "GROUP";
  groupId: string | null;
  isDefault: boolean;
  children: Node[];
};

function Row({ node, parents }: { node: Node; parents: ParentOption[] }) {
  const t = useTranslations("categories");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const editable: EditableCategory = {
    id: node.id,
    name: node.name,
    color: node.color,
    icon: node.icon,
    parentId: node.parentId,
    groupId: node.groupId,
  };

  function handleDelete() {
    if (!confirm(t("deleteConfirm"))) return;
    const fd = new FormData();
    fd.set("id", node.id);
    startTransition(async () => {
      const r = await deleteCategoryAction(null, fd);
      if (r?.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div
        className="border-border flex items-center gap-3 rounded-md border px-3 py-2"
        data-slot="category-row"
      >
        <span
          aria-hidden
          className="inline-block size-3 rounded-full"
          style={{ background: node.color ?? "var(--muted-foreground)" }}
        />
        <span className="flex-1 text-sm">
          {node.icon ? `${node.icon} ` : ""}
          {node.name}
        </span>
        {node.scope === "GROUP" && <Badge variant="secondary">{t("scopeGroup")}</Badge>}
        {node.isDefault && <Badge variant="outline">{t("default")}</Badge>}
        <Button variant="ghost" size="icon" aria-label={t("edit")} onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("delete")}
          disabled={pending}
          onClick={handleDelete}
        >
          <Trash2 className="size-4" />
        </Button>
        <CategoryForm
          mode="edit"
          category={editable}
          parents={parents}
          groupId={node.groupId}
          open={editing}
          onOpenChange={setEditing}
        />
      </div>
      {node.children.length > 0 && (
        <div className="ml-6 space-y-1">
          {node.children.map((c) => (
            <Row key={c.id} node={c} parents={parents} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryList({ tree }: { tree: Node[] }) {
  const t = useTranslations("categories");
  const parents: ParentOption[] = tree.map((n) => ({ id: n.id, name: n.name }));
  if (tree.length === 0) return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  return (
    <div className="space-y-2">
      {tree.map((node) => (
        <Row key={node.id} node={node} parents={parents} />
      ))}
    </div>
  );
}
