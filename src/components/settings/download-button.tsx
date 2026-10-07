"use client";

import { useState, type ReactNode } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { filenameFromDisposition } from "@/lib/download";

// Fetches the export before saving it so the button can show progress: a plain
// `<a download>` gives no feedback while the server builds a large file (#171).
export function DownloadButton({
  href,
  fallbackFilename,
  pendingLabel,
  onError,
  children,
}: {
  href: string;
  fallbackFilename: string;
  pendingLabel: string;
  onError: (failed: boolean) => void;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);

  async function download() {
    setPending(true);
    onError(false);
    try {
      const res = await fetch(href, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
        fallbackFilename,
      );
      document.body.append(a);
      a.click();
      a.remove();
      // iOS Safari and Firefox read the blob asynchronously after click() (FileSaver.js delay).
      setTimeout(() => URL.revokeObjectURL(url), 40_000);
    } catch {
      onError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" onClick={download} disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle className="animate-spin" /> : <Download />}
      {pending ? pendingLabel : children}
    </Button>
  );
}
