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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { createGroupAction, updateGroupAction } from "@/server/transport/actions/groups";
import { NAME_MAX } from "@/lib/validation/name";
import { GROUP_DESCRIPTION_MAX } from "@/lib/validation/group";

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
  const liveMobile = useIsMobile();
  // Freeze the mobile/desktop root choice while the form is open (see account-form).
  const [openMobile, setOpenMobile] = useState(liveMobile);
  const isMobile = open ? openMobile : liveMobile;

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
          {mode === "create" ? t("new") : t("edit")}
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
              maxLength={NAME_MAX}
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
              maxLength={GROUP_DESCRIPTION_MAX}
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

  const handleOpenChange = (next: boolean) => {
    if (next) setOpenMobile(liveMobile); // freeze the layout for this open session
    setOpen(next);
    if (!next) setError(null);
  };

  // Swap the whole root: a centered Dialog on desktop, a bottom Sheet on mobile.
  // (A Sheet popup under a Dialog root doesn't open — the root and its content
  // must come from the same primitive family.)
  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {trigger && <SheetTrigger render={trigger as React.ReactElement} />}
      <SheetContent
        side="bottom"
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        {body}
      </DialogContent>
    </Dialog>
  );
}
