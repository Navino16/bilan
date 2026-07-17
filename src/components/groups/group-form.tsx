"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { createGroupAction, updateGroupAction } from "@/server/transport/actions/groups";

type EditableGroup = { id: string; name: string; description: string | null };

export function GroupForm({
  mode,
  group,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  group?: EditableGroup;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("groups");
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isMobile = useIsMobile();

  function handleAction(formData: FormData) {
    startTransition(async () => {
      const act = mode === "create" ? createGroupAction : updateGroupAction;
      const result = await act(null, formData);
      if (result?.ok) {
        setError(null);
        setOpen(false);
        router.refresh();
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
        <span className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
          {t("new")}
        </span>
        <DialogTitle className="font-display text-2xl">
          {mode === "create" ? t("createTitle") : t("editTitle")}
        </DialogTitle>
        {mode === "create" && <DialogDescription>{t("createSubtitle")}</DialogDescription>}
      </DialogHeader>

      <form action={handleAction} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {mode === "edit" && group && <input type="hidden" name="id" value={group.id} />}
          <div className="space-y-2">
            <Label htmlFor="grp-name">{t("name")}</Label>
            <Input
              id="grp-name"
              name="name"
              defaultValue={group?.name}
              placeholder={t("namePlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="grp-description">{t("description")}</Label>
            <textarea
              id="grp-description"
              name="description"
              defaultValue={group?.description ?? ""}
              placeholder={t("descriptionPlaceholder")}
              rows={3}
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3"
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{t(`error.${error}`)}</AlertDescription>
            </Alert>
          )}
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
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      {isMobile ? (
        <SheetContent
          side="bottom"
          className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
        >
          {body}
        </SheetContent>
      ) : (
        <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
          {body}
        </DialogContent>
      )}
    </Dialog>
  );
}
