"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CSV_FIELDS } from "@/lib/validation/import";

type PreviewRow = {
  date: string;
  amount: number;
  rawLabel: string;
  suggestedCategoryId: string | null;
};
type Preview = {
  batchId: string;
  headers: string[];
  mapping: Record<string, string | undefined>;
  totalRows: number;
  preview: PreviewRow[];
};
type Summary = { importedRows: number; skippedRows: number };

export function CsvImporter({ accounts }: { accounts: { id: string; name: string }[] }) {
  const t = useTranslations("import");
  const locale = useLocale();
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("accountId", accountId);
    const res = await fetch("/api/import/csv", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "PARSE_FAILED");
    setPreview(data);
    setMapping(
      Object.fromEntries(Object.entries(data.mapping).filter(([, v]) => v)) as Record<
        string,
        string
      >,
    );
  }

  function commit() {
    if (!preview) return;
    startTransition(async () => {
      const res = await fetch(`/api/import/csv/${preview.batchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "COMMIT_FAILED");
      setSummary(data);
      router.refresh();
    });
  }

  if (summary) {
    return (
      <div className="border-border space-y-3 rounded-xl border p-6">
        <p className="text-sm">
          {t("summary", { imported: summary.importedRows, skipped: summary.skippedRows })}
        </p>
        <Button render={<Link href={`/${locale}/transactions`} />}>{t("viewTransactions")}</Button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="space-y-4">
        <label className="flex items-center gap-3">
          <span className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
            {t("account")}
          </span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="border-input bg-background h-9 w-auto min-w-48 max-w-sm rounded-md border px-3 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="border-border hover:bg-muted/40 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <Upload className="text-muted-foreground size-6" />
          <span className="text-muted-foreground text-sm">{t("drop")}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
        {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
          {t("mapping")}
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
          {CSV_FIELDS.map((field) => (
            <label key={field} className="space-y-1 text-sm">
              <span className="text-muted-foreground text-xs">
                {t(`col${field[0].toUpperCase()}${field.slice(1)}`)}
              </span>
              <select
                value={mapping[field] ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              >
                <option value="">{t("none")}</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
          {t("preview")} · {t("rowsDetected", { count: preview.totalRows })}
        </h2>
        <div className="border-border mt-2 overflow-hidden rounded-xl border">
          {preview.preview.slice(0, 20).map((r, i) => (
            <div
              key={i}
              data-slot="import-preview-row"
              className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-b-0"
            >
              <span className="text-muted-foreground w-24 text-xs tabular-nums">
                {r.date.slice(0, 10)}
              </span>
              <span className="flex-1 truncate">{r.rawLabel}</span>
              <span
                className="tabular-nums"
                style={r.amount > 0 ? { color: "var(--income)" } : undefined}
              >
                {r.amount.toFixed(2)} €
              </span>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
      <Button onClick={commit} disabled={pending}>
        {pending ? t("importing") : t("commit")}
      </Button>
    </div>
  );
}
