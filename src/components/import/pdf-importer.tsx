"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORTED_BANKS } from "@/server/services/imports/pdf/detect";

type PreviewRow = {
  date: string;
  amount: number;
  rawLabel: string;
  suggestedCategoryId: string | null;
};
type Product = { key: string; totalRows: number; preview: PreviewRow[] };
type Preview = { batchId: string; bank: string | null; products: Product[] };
type Summary = { importedRows: number; skippedRows: number };

export function PdfImporter({ accounts }: { accounts: { id: string; name: string }[] }) {
  const t = useTranslations("import");
  const locale = useLocale();
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const supported = SUPPORTED_BANKS.map((b) => t(`banks.${b}`)).join(", ");
  const productLabel = (key: string) =>
    key === "default" ? t("products.default") : t(`products.${key}`);

  async function onFile(file: File) {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("accountId", accountId);
    const res = await fetch("/api/import/pdf", { method: "POST", body: fd });
    const data = (await res.json()) as Preview & { error?: string };
    if (!res.ok) return setError(data.error ?? "PARSE_FAILED");
    setPreview(data);
    // Default: first product → the upload account, others → ignored.
    setMapping(Object.fromEntries(data.products.map((p, i) => [p.key, i === 0 ? accountId : ""])));
  }

  function commit() {
    if (!preview) return;
    const picked = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    startTransition(async () => {
      const res = await fetch(`/api/import/pdf/${preview.batchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping: picked }),
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
            className="border-input bg-background h-9 w-auto max-w-sm min-w-48 rounded-md border px-3 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground text-xs">{t("supportedBanks", { list: supported })}</p>
        <label className="border-border hover:bg-muted/40 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <Upload className="text-muted-foreground size-6" />
          <span className="text-muted-foreground text-sm">{t("pdfDrop")}</span>
          <input
            type="file"
            accept=".pdf,application/pdf"
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
      <p className="text-sm">
        {preview.bank ? t("bankDetected", { bank: t(`banks.${preview.bank}`) }) : t("bankUnknown")}
      </p>
      {preview.products.map((product) => (
        <div
          key={product.key}
          data-slot="pdf-product"
          className="border-border space-y-3 rounded-xl border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-medium">
              {productLabel(product.key)} · {t("rowsDetected", { count: product.totalRows })}
            </span>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground text-xs">{t("targetAccount")}</span>
              <select
                value={mapping[product.key] ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, [product.key]: e.target.value }))}
                className="border-input bg-background h-9 w-auto min-w-44 rounded-md border px-2 text-sm"
              >
                <option value="">{t("ignoreProduct")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="border-border overflow-hidden rounded-lg border">
            {product.preview.slice(0, 10).map((r, i) => (
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
      ))}
      {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
      <Button onClick={commit} disabled={pending}>
        {pending ? t("importing") : t("commit")}
      </Button>
    </div>
  );
}
