"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createCategoryAction,
  updateCategoryAction,
  type CategoryActionState,
} from "@/server/transport/actions/categories";
import { NativeSelect } from "@/components/ui/native-select";
import { indentedName } from "@/components/transactions/category-tree";
import type { CategoryOption } from "./category-options";

const DEFAULT_COLOR = "#2563eb";
export type EditableCategory = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  groupId: string | null;
};

export function CategoryForm({
  mode,
  category,
  parents,
  groupId,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  category?: EditableCategory;
  parents: CategoryOption[];
  groupId?: string | null;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("categories");
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAction(formData: FormData) {
    startTransition(async () => {
      const act = mode === "create" ? createCategoryAction : updateCategoryAction;
      const result: CategoryActionState = await act(null, formData);
      if (result?.ok) {
        setError(null);
        setOpen(false);
        router.refresh();
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
          <DialogTitle className="font-display text-2xl">
            {mode === "create" ? t("createTitle") : t("editTitle")}
          </DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <form action={handleAction} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            {mode === "edit" && <input type="hidden" name="id" value={category!.id} />}
            {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}

            <div className="space-y-2">
              <Label htmlFor="cat-name">{t("name")}</Label>
              <Input
                id="cat-name"
                name="name"
                defaultValue={category?.name}
                placeholder={t("namePlaceholder")}
                required
              />
            </div>

            <ParentAndColorFields category={category} parents={parents} />

            {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
          </div>

          <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              <Check />
              {pending ? t("saving") : mode === "create" ? t("createCta") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Mounted with the dialog content, so unsaved choices reset on each opening.
// A sub-category without its own colour inherits its parent's: the colour is
// only submitted once the user picks one.
function ParentAndColorFields({
  category,
  parents,
}: {
  category?: EditableCategory;
  parents: CategoryOption[];
}) {
  const t = useTranslations("categories");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [color, setColor] = useState<string | null>(category?.color ?? null);
  const parent = parents.find((p) => p.id === parentId);
  const shownColor = color ?? parent?.color ?? DEFAULT_COLOR;

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cat-icon">{t("icon")}</Label>
          <Input id="cat-icon" name="icon" defaultValue={category?.icon ?? ""} maxLength={50} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cat-color">{t("color")}</Label>
          <Input
            id="cat-color"
            type="color"
            value={shownColor}
            onChange={(e) => setColor(e.target.value)}
          />
          <input type="hidden" name="color" value={color ?? (parent ? "" : DEFAULT_COLOR)} />
          {parent &&
            (color === null ? (
              <p className="text-muted-foreground text-xs">{t("colorInherited")}</p>
            ) : (
              <button
                type="button"
                className="text-primary text-xs underline-offset-2 hover:underline"
                onClick={() => setColor(null)}
              >
                {t("inheritColor")}
              </button>
            ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cat-parent">{t("parent")}</Label>
        <NativeSelect
          id="cat-parent"
          name="parentId"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">{t("noParent")}</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {indentedName(p.name, p.depth)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </>
  );
}
