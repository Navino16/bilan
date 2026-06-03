"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { overline, Pill, CategoryChip } from "@/components/transactions/bits";
import { Stepper, FieldMap, CheckRow } from "./wizard-bits";
import { CSV_FIELDS } from "@/lib/validation/import";
import type { FlatCategory } from "@/components/transactions/category-tree";

type Account = { id: string; name: string; bankName: string | null };
type PreviewRow = {
  date: string;
  amount: number;
  rawLabel: string;
  type: string;
  suggestedCategoryId: string | null;
  isDuplicate: boolean;
};
type Product = {
  key: string;
  totalRows: number;
  duplicateCount: number;
  autoCategorizedCount: number;
  preview: PreviewRow[];
};
type Preview = {
  batchId: string;
  source: "CSV" | "PDF";
  filename: string | null;
  fileSizeBytes: number | null;
  bank?: string | null;
  headers?: string[];
  mapping?: Record<string, string | undefined>;
  totalRows?: number;
  duplicateCount?: number;
  autoCategorizedCount?: number;
  preview?: PreviewRow[];
  products?: Product[];
  error?: string;
};
type Summary = { importedRows: number; skippedRows: number };

function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} o`;
  return `${(n / 1024).toFixed(1).replace(".", ",")} Ko`;
}

export function ImportWizard({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: FlatCategory[];
}) {
  const t = useTranslations("import");
  const tType = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [productAccount, setProductAccount] = useState<Record<string, string>>({});
  const [autoCategorize, setAutoCategorize] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  const step = summary ? 3 : preview ? 2 : loading ? 1 : 0;

  async function upload(f: File, account: string) {
    setError(null);
    setLoading(true);
    const isPdf = f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf";
    const endpoint = isPdf ? "/api/import/pdf" : "/api/import/csv";
    const fd = new FormData();
    fd.set("file", f);
    fd.set("accountId", account);
    try {
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const data = (await res.json()) as Preview;
      if (!res.ok) {
        setError(data.error ?? "PARSE_FAILED");
        return;
      }
      setPreview(data);
      setColumns(
        Object.fromEntries(Object.entries(data.mapping ?? {}).filter(([, v]) => v)) as Record<
          string,
          string
        >,
      );
      const prods = data.products ?? [{ key: "default" }];
      setProductAccount(Object.fromEntries(prods.map((p, i) => [p.key, i === 0 ? account : ""])));
    } finally {
      setLoading(false);
    }
  }

  function onFile(f: File) {
    setFile(f);
    void upload(f, accountId);
  }

  function onAccountChange(next: string) {
    setAccountId(next);
    if (file) void upload(file, next); // re-detect duplicates against the new account
  }

  function commit() {
    if (!preview) return;
    startTransition(async () => {
      const isPdf = preview.source === "PDF";
      const url = isPdf
        ? `/api/import/pdf/${preview.batchId}/commit`
        : `/api/import/csv/${preview.batchId}/commit`;
      const body = isPdf
        ? {
            mapping: Object.fromEntries(Object.entries(productAccount).filter(([, v]) => v)),
            autoCategorize,
          }
        : { mapping: columns, autoCategorize };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "COMMIT_FAILED");
      setSummary(data);
      router.refresh();
    });
  }

  const products: Product[] = preview
    ? preview.source === "PDF"
      ? (preview.products ?? [])
      : [
          {
            key: "default",
            totalRows: preview.totalRows ?? 0,
            duplicateCount: preview.duplicateCount ?? 0,
            autoCategorizedCount: preview.autoCategorizedCount ?? 0,
            preview: preview.preview ?? [],
          },
        ]
    : [];
  const total = products.reduce((n, p) => n + p.totalRows, 0);
  const dupCount = products.reduce((n, p) => n + p.duplicateCount, 0);
  const catCount = products.reduce((n, p) => n + p.autoCategorizedCount, 0);
  const sourceBadge =
    preview?.source ?? (file?.name.toLowerCase().endsWith(".pdf") ? "PDF" : "CSV");

  const steps = [t("steps.file"), t("steps.read"), t("steps.match"), t("steps.validate")];

  function categoryCell(id: string | null) {
    const c = id ? catById.get(id) : undefined;
    if (!c) return <Pill>{t("noCategory")}</Pill>;
    return <CategoryChip name={c.name} color={c.color} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <div className={overline}>{t("overline")}</div>
          <h1 className="font-display text-3xl leading-none">{t("title")}</h1>
        </div>
        <span className="text-muted-foreground text-xs">{t("sources")}</span>
      </div>

      <Stepper steps={steps} current={step} />

      {summary ? (
        <Card className="space-y-3 p-6">
          <p className="text-sm">
            {t("summary", { imported: summary.importedRows, skipped: summary.skippedRows })}
          </p>
          <Button nativeButton={false} render={<Link href={`/${locale}/transactions`} />}>
            {t("viewTransactions")}
          </Button>
        </Card>
      ) : !preview ? (
        <div className="max-w-xl space-y-4">
          <label className="flex items-center gap-3">
            <span className={overline}>{t("account")}</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="border-input bg-card h-9 w-auto max-w-sm min-w-48 rounded-lg border px-3 text-sm shadow-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="border-border hover:bg-muted/40 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center transition-colors">
            <Upload className="text-muted-foreground size-6" />
            <span className="text-muted-foreground text-sm">{t("drop")}</span>
            <input
              type="file"
              accept=".csv,text/csv,.pdf,application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          {/* Sidebar */}
          <Card className="h-fit gap-0 space-y-5 p-5">
            <div>
              <div className={`${overline} mb-2`}>{t("fileSection")}</div>
              <div className="bg-muted/60 flex items-center gap-2.5 rounded-lg p-2.5">
                <span className="bg-foreground text-background flex size-8 items-center justify-center rounded-md font-mono text-[10px]">
                  {sourceBadge}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px]">{preview.filename ?? sourceBadge}</div>
                  <div className="text-muted-foreground text-[11px]">
                    {t("fileMeta", { count: total, size: formatBytes(preview.fileSizeBytes) })}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className={`${overline} mb-2`}>{t("targetAccount")}</div>
              <div className="space-y-1.5">
                {accounts.map((a) => {
                  const active = accountId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onAccountChange(a.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:bg-muted/40"
                      }`}
                    >
                      <span className="bg-primary size-2 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{a.name}</div>
                        {a.bankName && (
                          <div className="text-muted-foreground truncate text-[10.5px]">
                            {a.bankName}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className={`${overline} mb-2`}>{t("mapping")}</div>
              {preview.source === "CSV" && preview.headers ? (
                CSV_FIELDS.map((field) => (
                  <FieldMap key={field} label={t(`col${field[0].toUpperCase()}${field.slice(1)}`)}>
                    <select
                      value={columns[field] ?? ""}
                      onChange={(e) => setColumns((m) => ({ ...m, [field]: e.target.value }))}
                      className="border-input bg-card h-8 w-full rounded-md border px-2 text-xs"
                    >
                      <option value="">{t("none")}</option>
                      {preview.headers!.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </FieldMap>
                ))
              ) : (
                <>
                  <FieldMap label={t("colDate")}>
                    <span className="text-[12.5px]">{t("autoDetected")}</span>
                  </FieldMap>
                  <FieldMap label={t("colLabel")}>
                    <span className="text-[12.5px]">{t("autoDetected")}</span>
                  </FieldMap>
                  <FieldMap label={t("colAmount")}>
                    <span className="text-[12.5px]">{t("autoDetected")}</span>
                  </FieldMap>
                </>
              )}
            </div>

            <div>
              <div className={`${overline} mb-2`}>{t("options")}</div>
              <CheckRow label={t("optDuplicates")} checked disabled />
              <CheckRow
                label={t("optCategorize")}
                checked={autoCategorize}
                onChange={setAutoCategorize}
              />
              <CheckRow label={t("optLinks")} checked={false} disabled />
            </div>
          </Card>

          {/* Preview */}
          <Card className="gap-0 overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <div className="font-display text-lg">{t("previewTitle", { count: total })}</div>
                <div className="text-muted-foreground text-xs">
                  {t("previewMeta", { dup: dupCount, cat: catCount })}
                </div>
              </div>
              <Button size="sm" onClick={commit} disabled={pending}>
                {pending ? t("importing") : t("validate")}
                <ChevronRight />
              </Button>
            </div>

            {products.map((product) => (
              <div key={product.key} data-slot="pdf-product">
                {products.length > 1 && (
                  <div className="bg-muted/40 flex items-center justify-between gap-3 border-y px-5 py-2">
                    <span className="text-sm font-medium">{t(`products.${product.key}`)}</span>
                    <select
                      value={productAccount[product.key] ?? ""}
                      onChange={(e) =>
                        setProductAccount((m) => ({ ...m, [product.key]: e.target.value }))
                      }
                      className="border-input bg-card h-8 w-auto min-w-40 rounded-md border px-2 text-xs"
                    >
                      <option value="">{t("ignoreProduct")}</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="text-muted-foreground bg-muted/60 grid grid-cols-[64px_1fr_minmax(0,150px)_96px_104px] gap-3 border-y px-5 py-2.5 text-[11px] tracking-[0.08em] uppercase">
                  <span>{t("colDate")}</span>
                  <span>{t("colRawLabel")}</span>
                  <span>{t("colCategory")}</span>
                  <span>{t("colType")}</span>
                  <span className="text-right">{t("colAmount")}</span>
                </div>
                {product.preview.map((r, i) => (
                  <div
                    key={i}
                    data-slot="import-preview-row"
                    className="grid grid-cols-[64px_1fr_minmax(0,150px)_96px_104px] items-center gap-3 border-b px-5 py-2.5 last:border-b-0"
                    style={r.isDuplicate ? { background: "var(--warning-bg)" } : undefined}
                  >
                    <span className="text-muted-foreground text-xs">
                      {dayMonth.format(new Date(r.date))}
                    </span>
                    <span className="text-muted-foreground truncate font-mono text-[12.5px]">
                      {r.rawLabel}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      {categoryCell(r.suggestedCategoryId)}
                      {r.isDuplicate && (
                        <span
                          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[0.65rem] font-medium"
                          style={{ color: "var(--warning)", background: "var(--warning-bg)" }}
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: "var(--warning)" }}
                          />
                          {t("duplicate")}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-[11.5px]">
                      {tType(`types.${r.type}`)}
                    </span>
                    <span
                      className="text-right text-sm font-medium tabular-nums"
                      style={r.amount > 0 ? { color: "var(--income)" } : undefined}
                    >
                      {money.format(r.amount)}
                    </span>
                  </div>
                ))}
                {product.totalRows > product.preview.length && (
                  <div className="text-muted-foreground border-b px-5 py-3 text-center text-xs last:border-b-0">
                    {t("moreRows", { count: product.totalRows - product.preview.length })}
                  </div>
                )}
              </div>
            ))}
            {error && <p className="text-destructive p-5 text-sm">{t(`error.${error}`)}</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
