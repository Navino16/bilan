"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { overline } from "@/components/transactions/bits";
import { DownloadButton } from "@/components/settings/download-button";
import type { ScopeGroup } from "./category-form";

export const RULES_EXPORT_FILENAME = "bilan-rules.json";

export function rulesExportHref(groupId: string | null): string {
  return groupId ? `/api/export/rules?groupId=${encodeURIComponent(groupId)}` : "/api/export/rules";
}

export function RulesExportDialog({
  groups,
  open,
  onOpenChange,
}: {
  groups: ScopeGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useFrozenWhileOpen(open, useIsMobile());
  const form = <RulesExportForm groups={groups} onClose={() => onOpenChange(false)} />;
  return isMobile ? (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-y-auto rounded-t-2xl p-0"
      >
        {form}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">{form}</DialogContent>
    </Dialog>
  );
}

function RulesExportForm({ groups, onClose }: { groups: ScopeGroup[]; onClose: () => void }) {
  const t = useTranslations("rules.transfer");
  const [groupId, setGroupId] = useState("");
  const [failed, setFailed] = useState(false);

  return (
    <>
      <DialogHeader className="space-y-2 px-6 pt-5 pb-3 text-left max-md:px-5">
        <span className={overline}>{t("exportOverline")}</span>
        <DialogTitle className="font-display text-2xl leading-tight">
          {t("exportTitle")}
        </DialogTitle>
        <p className="text-muted-foreground text-sm leading-relaxed">{t("exportIntro")}</p>
      </DialogHeader>
      <div className="flex flex-col gap-3 px-6 pb-4 max-md:px-5">
        <div className="space-y-1.5">
          <Label htmlFor="rules-export-scope">{t("exportScope")}</Label>
          <NativeSelect
            id="rules-export-scope"
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              setFailed(false);
            }}
          >
            <option value="">{t("personal")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {failed && (
          <p role="alert" className="text-destructive text-sm">
            {t("exportFailed")}
          </p>
        )}
      </div>
      <DialogFooter className="bg-muted/40 border-border border-t px-6 py-3 max-md:px-5">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <DownloadButton
          href={rulesExportHref(groupId || null)}
          fallbackFilename={RULES_EXPORT_FILENAME}
          pendingLabel={t("exporting")}
          onError={setFailed}
        >
          {t("download")}
        </DownloadButton>
      </DialogFooter>
    </>
  );
}
