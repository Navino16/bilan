"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RevertImportDialog } from "./revert-import-dialog";

export function ImportHistoryActions({ batchId }: { batchId: string }) {
  const t = useTranslations("import");
  const [reverting, setReverting] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("history.actions")}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-3"
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem variant="destructive" onClick={() => setReverting(true)}>
            {t("revert.action")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {reverting && <RevertImportDialog batchId={batchId} onClose={() => setReverting(false)} />}
    </>
  );
}
