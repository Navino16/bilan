"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import { CategoryForm, type EditableCategory, type ScopeGroup } from "./category-form";
import { CategoryDeleteDialog } from "./category-delete-dialog";
import { categoryOptions, pickableCategories, type CategoryOption } from "./category-options";

type Node = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  scope: "USER" | "GROUP";
  groupId: string | null;
  children: Node[];
};

function Row({
  node,
  all,
  groups,
  inheritedColor = null,
  depth = 0,
}: {
  node: Node;
  all: CategoryOption[];
  groups: ScopeGroup[];
  inheritedColor?: string | null;
  depth?: number;
}) {
  const t = useTranslations("categories");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pickable = pickableCategories(all, node.groupId, node.id);

  const editable: EditableCategory = {
    id: node.id,
    name: node.name,
    color: node.color,
    icon: node.icon,
    parentId: node.parentId,
    groupId: node.groupId,
  };

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 border-t py-1.5 pr-2 first:border-t-0",
          depth > 0 ? "border-border/50" : "font-medium",
        )}
        style={{ paddingLeft: 12 + depth * 24 }}
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
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
              <Trash2 />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CategoryForm
          mode="edit"
          category={editable}
          options={all}
          groups={groups}
          open={editing}
          onOpenChange={setEditing}
        />
        {deleting && (
          <CategoryDeleteDialog
            category={node}
            targets={pickable}
            onClose={() => setDeleting(false)}
          />
        )}
      </div>
      {node.children.map((c) => (
        <Row
          key={c.id}
          node={c}
          all={all}
          groups={groups}
          inheritedColor={node.color ?? inheritedColor}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function CategoryList({ tree, groups }: { tree: Node[]; groups: ScopeGroup[] }) {
  const t = useTranslations("categories");
  const all = categoryOptions(tree);
  if (tree.length === 0) return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      {tree.map((node) => (
        <Row key={node.id} node={node} all={all} groups={groups} />
      ))}
    </div>
  );
}
