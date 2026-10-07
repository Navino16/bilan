"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Copies `${origin}${path}`. navigator.clipboard only exists in secure contexts, so a
// self-hosted instance on plain HTTP falls back to a selectable field.
export function CopyLinkButton({
  path,
  label,
  copiedLabel,
}: {
  path: string;
  label: string;
  copiedLabel: string;
}) {
  const t = useTranslations("shell.copyLink");
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFallbackUrl(url);
    }
  }

  const current = copied ? copiedLabel : label;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label={current}
        title={current}
      >
        {copied ? <Check /> : <Link2 />}
      </Button>
      <Dialog open={fallbackUrl !== null} onOpenChange={(open) => !open && setFallbackUrl(null)}>
        <DialogContent data-slot="copy-link-fallback">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{t("manual")}</DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            autoFocus
            value={fallbackUrl ?? ""}
            aria-label={label}
            onFocus={(e) => e.currentTarget.select()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
