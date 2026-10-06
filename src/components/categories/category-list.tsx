"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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

function Row({
  node,
  parents,
  inheritedColor = null,
  child = false,
}: {
  node: Node;
  parents: ParentOption[];
  inheritedColor?: string | null;
  child?: boolean;
}) {
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
    <>
      <div
        className={cn(
          "flex items-center gap-3 border-t py-1.5 pr-2 first:border-t-0",
          child ? "border-border/50 pl-9" : "pl-3 font-medium",
        )}
        data-slot="category-row"
      >
        <span
          aria-hidden
          className="inline-block size-2.5 shrink-0 rounded-full"
          style={{ background: node.color ?? inheritedColor ?? "var(--muted-foreground)" }}
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {node.icon ? `${node.icon} ` : ""}
          {node.name}
        </span>
        {node.scope === "GROUP" && <Badge variant="secondary">{t("scopeGroup")}</Badge>}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={t("actionsFor", { name: node.name })}
                disabled={pending}
              />
            }
          >
            <MoreVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil />
              {t("edit")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              <Trash2 />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CategoryForm
          mode="edit"
          category={editable}
          parents={parents}
          groupId={node.groupId}
          open={editing}
          onOpenChange={setEditing}
        />
      </div>
      {node.children.map((c) => (
        <Row
          key={c.id}
          node={c}
          parents={parents}
          inheritedColor={node.color ?? inheritedColor}
          child
        />
      ))}
    </>
  );
}

export function CategoryList({ tree }: { tree: Node[] }) {
  const t = useTranslations("categories");
  const parents: ParentOption[] = tree.map((n) => ({ id: n.id, name: n.name }));
  if (tree.length === 0) return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      {tree.map((node) => (
        <Row key={node.id} node={node} parents={parents} />
      ))}
    </div>
  );
}
