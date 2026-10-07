"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Replaces window.confirm. The caller owns `open` and closes it once `onConfirm`
// succeeds; an alert dialog ignores outside clicks, so only Cancel/Escape dismiss it.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
  confirmDisabled = false,
  error,
  destructive = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: React.ReactNode;
  onConfirm: () => void;
  pending?: boolean;
  confirmDisabled?: boolean;
  error?: React.ReactNode;
  destructive?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("shell.confirm");
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs" />
        <AlertDialog.Popup
          data-slot="confirm-dialog"
          className="bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-clip-padding p-6 text-sm shadow-lg transition duration-200 ease-in-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:max-w-lg"
        >
          <div className="flex flex-col gap-0.5 text-center sm:text-left">
            <AlertDialog.Title className="font-heading text-foreground text-base font-medium">
              {title}
            </AlertDialog.Title>
            {description && (
              <AlertDialog.Description className="text-muted-foreground text-sm">
                {description}
              </AlertDialog.Description>
            )}
          </div>
          {children}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button variant="ghost" type="button" disabled={pending} />}>
              {t("cancel")}
            </AlertDialog.Close>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={onConfirm}
              disabled={pending || confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
