"use client";

import { useState, type ReactNode } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepUpDialog, type StepUpFailure } from "@/components/auth/step-up-dialog";
import { filenameFromDisposition } from "@/lib/download";
import type { StepUpMethod } from "@/server/services/users/step-up";

async function reauthMethod(res: Response): Promise<StepUpMethod | null> {
  if (res.status !== 403) return null;
  const body = (await res.json().catch(() => null)) as { error?: string; method?: string } | null;
  if (body?.error !== "REAUTH_REQUIRED") return null;
  return body.method === "SIGN_IN" ? "SIGN_IN" : "PASSWORD";
}

// Fetches the export before saving it so the button can show progress: a plain
// `<a download>` gives no feedback while the server builds a large file (#171).
// With `stepUp`, a 403 REAUTH_REQUIRED opens the re-auth dialog, then retries (#257).
export function DownloadButton({
  href,
  fallbackFilename,
  pendingLabel,
  onError,
  stepUp,
  children,
}: {
  href: string;
  fallbackFilename: string;
  pendingLabel: string;
  onError: (failed: boolean) => void;
  stepUp?: (password: string) => Promise<{ ok: true } | StepUpFailure>;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [reauth, setReauth] = useState<StepUpMethod | null>(null);

  async function download() {
    setPending(true);
    onError(false);
    try {
      const res = await fetch(href, { cache: "no-store" });
      const method = stepUp ? await reauthMethod(res) : null;
      if (method) return setReauth(method);
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
    <>
      <Button variant="outline" onClick={download} disabled={pending} aria-busy={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Download />}
        {pending ? pendingLabel : children}
      </Button>
      {reauth && stepUp && (
        <StepUpDialog
          method={reauth}
          purpose="export"
          confirm={stepUp}
          onConfirmed={() => {
            setReauth(null);
            void download();
          }}
          onClose={() => setReauth(null)}
        />
      )}
    </>
  );
}
