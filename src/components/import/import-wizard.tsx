"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, ChevronRight, ChevronLeft, ChevronDown, PenLine } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { overline } from "@/components/transactions/bits";
import { CategoryCombobox } from "@/components/transactions/category-combobox";
import { Stepper, FieldMap, CheckRow } from "./wizard-bits";
import { CSV_FIELDS, CSV_MAX_BYTES, PDF_MAX_BYTES } from "@/lib/validation/import";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { PageHeader } from "@/components/shell/page-header";
import { NativeSelect } from "@/components/ui/native-select";
import { discardImportAction } from "@/server/transport/actions/imports";
import { cn } from "@/lib/utils";
import { RevertImportDialog } from "./revert-import-dialog";

type Account = { id: string; name: string; bankName: string | null };
type PreviewRow = {
  externalId: string;
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
  page: number;
  pageSize: number;
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
  rejectedCount?: number;
  rejected?: { row: number; reason: string; value: string }[];
  preview?: PreviewRow[];
  page?: number;
  pageSize?: number;
  products?: Product[];
  error?: string;
};

type Summary = { importedRows: number; skippedRows: number; rejectedRows?: number };

const CSV_PRODUCT = "default";

function isPdfFile(f: File): boolean {
  return f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf";
}

function formatBytes(n: number | null, locale: string): string {
  if (!n) return "";
  const [value, unit] =
    n < 1024 ? [n, "byte"] : n < 1024 ** 2 ? [n / 1024, "kilobyte"] : [n / 1024 ** 2, "megabyte"];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: unit === "byte" ? 0 : 1,
  }).format(value);
}

export function ImportWizard({
  accounts,
  categories,
  history,
}: {
  accounts: Account[];
  categories: FlatCategory[];
  history?: ReactNode;
}) {
  const t = useTranslations("import");
  const tType = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const count = new Intl.NumberFormat(locale);

  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [productAccount, setProductAccount] = useState<Record<string, string>>({});
  // Per-row edits keyed by externalId: category override, and exclusion (the
  // value is the row's product, so ignored products don't count their exclusions).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, string>>({});
  const [autoCategorize, setAutoCategorize] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reverting, setReverting] = useState(false);
  const [reverted, setReverted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const refreshSeq = useRef(0);
  const previewTop = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();

  const step = summary ? 3 : preview ? 2 : loading ? 1 : 0;
  // An upload replaces (and discards) the previewed batch: nothing may commit or re-upload meanwhile.
  const busy = loading || pending || refreshing;

  function errorText(code: string): string {
    if (code === "TOO_LARGE") {
      const max = file && isPdfFile(file) ? PDF_MAX_BYTES : CSV_MAX_BYTES;
      return t("error.TOO_LARGE", { max: formatBytes(max, locale) });
    }
    return t.has(`error.${code}`) ? t(`error.${code}`) : t("error.PARSE_FAILED");
  }

  async function upload(f: File, account: string) {
    discard(preview?.batchId);
    setError(null);
    const isPdf = isPdfFile(f);
    if (f.size === 0) return setError("EMPTY");
    if (f.size > (isPdf ? PDF_MAX_BYTES : CSV_MAX_BYTES)) return setError("TOO_LARGE");
    setLoading(true);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("accountId", account);
    try {
      const res = await fetch(isPdf ? "/api/import/pdf" : "/api/import/csv", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as Preview;
      if (!res.ok) {
        setError(data.error ?? "PARSE_FAILED");
        return;
      }
      setPreview(data);
      setOverrides({});
      setExcluded({});
      setSettingsOpen(false);
      setColumns(
        Object.fromEntries(Object.entries(data.mapping ?? {}).filter(([, v]) => v)) as Record<
          string,
          string
        >,
      );
      const prods = data.products ?? [{ key: CSV_PRODUCT }];
      setProductAccount(Object.fromEntries(prods.map((p, i) => [p.key, i === 0 ? account : ""])));
    } catch {
      setError("PARSE_FAILED");
    } finally {
      setLoading(false);
    }
  }

  // Re-fetches the preview (another page, or a CSV mapping edit). Only the latest
  // request may land, so quick successive clicks can't show a stale page.
  async function refresh(body: object, opts: { resetEdits?: boolean; onFail?: () => void } = {}) {
    if (!preview) return;
    const url =
      preview.source === "PDF"
        ? `/api/import/pdf/${preview.batchId}/preview`
        : `/api/import/csv/${preview.batchId}/preview`;
    const seq = ++refreshSeq.current;
    setRefreshing(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Preview;
      if (seq !== refreshSeq.current) return;
      if (!res.ok) throw new Error(data.error ?? "PARSE_FAILED");
      setError(null);
      setPreview(data);
      if (opts.resetEdits) {
        setOverrides({});
        setExcluded({});
      }
    } catch (e) {
      if (seq !== refreshSeq.current) return;
      opts.onFail?.();
      setError(e instanceof Error ? e.message : "PARSE_FAILED");
    } finally {
      if (seq === refreshSeq.current) setRefreshing(false);
    }
  }

  // The preview is rebuilt with the edited mapping, so it shows exactly what a
  // commit will import; the rows' keys change, hence the reset per-row edits.
  function remap(field: string, header: string) {
    if (!preview || preview.source !== "CSV") return;
    const next = { ...columns, [field]: header };
    const shown = Object.fromEntries(
      Object.entries(preview.mapping ?? {}).filter(([, v]) => v),
    ) as Record<string, string>;
    setColumns(next);
    void refresh(
      { mapping: Object.fromEntries(Object.entries(next).filter(([, v]) => v)), page: 0 },
      // The preview didn't change, so neither does the mapping a commit will use.
      { resetEdits: true, onFail: () => setColumns(shown) },
    );
  }

  function pdfBody(pages: Record<string, number>, accounts: Record<string, string>) {
    return { pages, accounts: Object.fromEntries(Object.entries(accounts).filter(([, v]) => v)) };
  }

  async function goToPage(productKey: string, page: number) {
    if (!preview) return;
    const pages = Object.fromEntries(products.map((p) => [p.key, p.page]));
    await refresh(
      preview.source === "CSV"
        ? { mapping: preview.mapping, page }
        : pdfBody({ ...pages, [productKey]: page }, productAccount),
    );
    previewTop.current?.scrollIntoView({ block: "start" });
  }

  // Duplicates depend on the target account, so the product's rows are re-checked.
  function onProductAccountChange(productKey: string, account: string) {
    const next = { ...productAccount, [productKey]: account };
    setProductAccount(next);
    const pages = Object.fromEntries(products.map((p) => [p.key, p.page]));
    void refresh(pdfBody(pages, next));
  }

  function onFile(f: File) {
    setFile(f);
    void upload(f, accountId);
  }

  function onAccountChange(next: string) {
    setAccountId(next);
    if (file) void upload(file, next); // re-detect duplicates against the new account
  }

  function clear() {
    setFile(null);
    setPreview(null);
    setColumns({});
    setProductAccount({});
    setOverrides({});
    setExcluded({});
    setError(null);
    setSummary(null);
    setReverted(null);
    setProgress(null);
  }

  // Server cleanup is best effort: a batch that survives is purged by cron.
  function discard(batchId: string | undefined) {
    if (batchId) void discardImportAction(batchId);
  }

  function reset() {
    discard(preview?.batchId);
    clear();
  }

  function commit() {
    if (!preview) return;
    startTransition(async () => {
      const isPdf = preview.source === "PDF";
      const url = isPdf
        ? `/api/import/pdf/${preview.batchId}/commit`
        : `/api/import/csv/${preview.batchId}/commit`;
      const edits = { autoCategorize, overrides, excludedIds: Object.keys(excluded) };
      const body = isPdf
        ? {
            mapping: Object.fromEntries(Object.entries(productAccount).filter(([, v]) => v)),
            ...edits,
          }
        : { mapping: preview.mapping, ...edits };
      setProgress(0);
      // A poll answered after the commit settled must not bring the bar back.
      let polling = true;
      const poll = setInterval(async () => {
        const res = await fetch(`/api/import/${preview.batchId}/progress`).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (polling && data?.status === "COMMITTING") setProgress(data.importedRows);
      }, 1000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setError(data.error ?? "COMMIT_FAILED");
        setSummary(data);
        router.refresh();
      } catch {
        setError("COMMIT_FAILED");
      } finally {
        polling = false;
        clearInterval(poll);
        setProgress(null);
      }
    });
  }

  const products: Product[] = preview
    ? preview.source === "PDF"
      ? (preview.products ?? [])
      : [
          {
            key: CSV_PRODUCT,
            totalRows: preview.totalRows ?? 0,
            duplicateCount: preview.duplicateCount ?? 0,
            autoCategorizedCount: preview.autoCategorizedCount ?? 0,
            preview: preview.preview ?? [],
            page: preview.page ?? 0,
            pageSize: preview.pageSize ?? 50,
          },
        ]
    : [];
  const total = products.reduce((n, p) => n + p.totalRows, 0);
  const dupCount = products.reduce((n, p) => n + p.duplicateCount, 0);
  const catCount = products.reduce((n, p) => n + p.autoCategorizedCount, 0);
  const excludedIn = (key: string) => Object.values(excluded).filter((k) => k === key).length;
  // Rows a commit would write: duplicates are always skipped, and so are
  // unchecked rows and products mapped to no account.
  const importable = products
    .filter((p) => productAccount[p.key])
    .reduce((n, p) => n + Math.max(0, p.totalRows - p.duplicateCount - excludedIn(p.key)), 0);
  const sourceBadge = preview?.source ?? (file && isPdfFile(file) ? "PDF" : "CSV");
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? "";
  const fieldLabel = (field: string) => t(`col${field[0].toUpperCase()}${field.slice(1)}`);
  const settingsSummary = [
    preview?.filename ?? sourceBadge,
    accountName,
    preview?.source === "CSV"
      ? CSV_FIELDS.filter((f) => columns[f])
          .map(fieldLabel)
          .join(", ")
      : t("autoDetected"),
  ]
    .filter(Boolean)
    .join(" · ");

  const steps = [t("steps.file"), t("steps.read"), t("steps.match"), t("steps.validate")];

  // Editable category per row (overrides the suggestion), using the same combobox
  // as the transactions screen. Defaults to the suggestion; "" = Sans catégorie.
  function categorySelect(r: PreviewRow) {
    return (
      <CategoryCombobox
        categories={categories}
        defaultValue={overrides[r.externalId] ?? r.suggestedCategoryId ?? ""}
        onChange={(id) => setOverrides((o) => ({ ...o, [r.externalId]: id }))}
      />
    );
  }

  // Include/exclude checkbox per row (checked = will be imported). A duplicate
  // is never imported, so its box stays unchecked and locked.
  function includeCheckbox(r: PreviewRow, productKey: string) {
    const checked = !r.isDuplicate && !excluded[r.externalId];
    return (
      <input
        type="checkbox"
        aria-label={r.isDuplicate ? t("duplicateSkipped") : t("include")}
        checked={checked}
        disabled={r.isDuplicate || busy}
        onChange={() =>
          setExcluded((x) => {
            const next = { ...x };
            if (checked) next[r.externalId] = productKey;
            else delete next[r.externalId];
            return next;
          })
        }
        className="size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed md:size-4"
        style={{ accentColor: "var(--primary)" }}
      />
    );
  }

  function pager(product: Product) {
    if (product.totalRows <= product.pageSize) return null;
    const from = product.page * product.pageSize + 1;
    const to = Math.min(product.totalRows, from + product.pageSize - 1);
    const last = Math.ceil(product.totalRows / product.pageSize) - 1;
    return (
      <div
        data-slot="import-pager"
        className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-xs last:border-b-0 md:px-5"
      >
        <span>
          {t("pager.range", {
            from: count.format(from),
            to: count.format(to),
            total: count.format(product.totalRows),
          })}
        </span>
        <span className="flex gap-2">
          <Button
            variant="outline"
            className="h-9 md:h-8"
            disabled={busy || product.page === 0}
            onClick={() => void goToPage(product.key, product.page - 1)}
          >
            <ChevronLeft />
            {t("pager.previous")}
          </Button>
          <Button
            variant="outline"
            className="h-9 md:h-8"
            disabled={busy || product.page >= last}
            onClick={() => void goToPage(product.key, product.page + 1)}
          >
            {t("pager.next")}
            <ChevronRight />
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        overline={t("overline")}
        title={t("title")}
        subtitle={t("formats")}
        actions={
          <TransactionForm
            accounts={accounts}
            categories={categories}
            trigger={
              <Button variant="outline" disabled={accounts.length === 0}>
                <PenLine />
                {t("manualEntry")}
              </Button>
            }
          />
        }
      />

      <Stepper steps={steps} current={step} />

      {summary ? (
        <Card className="space-y-3 p-6">
          {reverted === null ? (
            <>
              <p className="text-sm">
                {t("summary", { imported: summary.importedRows, skipped: summary.skippedRows })}
                {!!summary.rejectedRows &&
                  ` · ${t("rejected.count", { count: summary.rejectedRows })}`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/${locale}/transactions`} className={buttonVariants()}>
                  {t("viewTransactions")}
                </Link>
                {preview && (
                  <Button variant="outline" onClick={() => setReverting(true)}>
                    {t("revert.action")}
                  </Button>
                )}
              </div>
              {reverting && preview && (
                <RevertImportDialog
                  batchId={preview.batchId}
                  onClose={() => setReverting(false)}
                  onReverted={setReverted}
                />
              )}
            </>
          ) : (
            <>
              <p className="text-sm">{t("revert.done", { count: reverted })}</p>
              <Button variant="outline" onClick={clear}>
                {t("revert.newImport")}
              </Button>
            </>
          )}
        </Card>
      ) : !preview ? (
        <div className="mx-auto max-w-xl space-y-4 pt-4">
          <label className="flex items-center gap-3">
            <span className={overline}>{t("account")}</span>
            <NativeSelect
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-auto max-w-sm min-w-48"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label
            data-slot="import-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              if (!loading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && !loading) onFile(f);
            }}
            className={cn(
              "border-border hover:bg-muted/40 focus-within:border-ring focus-within:ring-ring/50 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center transition-colors focus-within:ring-3",
              dragOver && "border-primary bg-primary/5",
              loading && "cursor-wait opacity-70",
            )}
          >
            <Upload className="text-muted-foreground size-6" />
            <span className="text-sm">{loading ? t("reading") : t("drop")}</span>
            <span className="text-muted-foreground text-xs">
              {t("limits", {
                csv: formatBytes(CSV_MAX_BYTES, locale),
                pdf: formatBytes(PDF_MAX_BYTES, locale),
              })}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,.pdf,application/pdf"
              className="sr-only"
              disabled={loading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onFile(f);
              }}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {errorText(error)}
            </p>
          )}
          {history}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          {/* Settings: a collapsible panel on mobile, the sidebar on desktop */}
          <Card className="h-fit gap-0 p-0 md:p-5">
            <button
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="import-settings"
              onClick={() => setSettingsOpen((o) => !o)}
              className="flex w-full items-center gap-3 p-4 text-left md:hidden"
            >
              <span className="bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">
                {sourceBadge}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t("settings")}</span>
                <span className="text-muted-foreground block truncate text-[11.5px]">
                  {settingsSummary}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform",
                  settingsOpen && "rotate-180",
                )}
              />
            </button>
            <div
              id="import-settings"
              className={cn(
                "space-y-5 border-t p-4 md:block md:border-t-0 md:p-0",
                !settingsOpen && "hidden",
              )}
            >
              <div>
                <div className={`${overline} mb-2`}>{t("fileSection")}</div>
                <div className="bg-muted/60 flex items-center gap-2.5 rounded-lg p-2.5">
                  <span className="bg-foreground text-background flex size-8 items-center justify-center rounded-md font-mono text-[10px]">
                    {sourceBadge}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px]">{preview.filename ?? sourceBadge}</div>
                    <div className="text-muted-foreground text-[11px]">
                      {t("fileMeta", {
                        count: total,
                        size: formatBytes(preview.fileSizeBytes, locale),
                      })}
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
                        aria-pressed={active}
                        onClick={() => onAccountChange(a.id)}
                        disabled={busy}
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
                    <FieldMap key={field} label={fieldLabel(field)}>
                      <NativeSelect
                        value={columns[field] ?? ""}
                        aria-label={fieldLabel(field)}
                        onChange={(e) => remap(field, e.target.value)}
                        disabled={busy}
                        size="sm"
                      >
                        <option value="">{t("none")}</option>
                        {preview.headers!.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </NativeSelect>
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
                <CheckRow
                  label={t("optCategorize")}
                  checked={autoCategorize}
                  onChange={setAutoCategorize}
                />
                <p className="text-muted-foreground py-1.5 text-xs leading-snug">
                  {t("duplicatesNote")}
                </p>
              </div>
            </div>
          </Card>

          {/* Preview */}
          <Card className="gap-0 overflow-hidden p-0">
            <div
              ref={previewTop}
              className="flex scroll-mt-20 flex-wrap items-center justify-between gap-3 p-4 md:p-5"
            >
              <div>
                <div className="font-display text-lg">{t("previewTitle", { count: total })}</div>
                <div className="text-muted-foreground text-xs">
                  {t("previewMeta", { dup: dupCount, cat: catCount })}
                </div>
                {!!preview.rejectedCount && (
                  <div
                    className="mt-2 text-xs"
                    data-slot="import-rejected"
                    style={{ color: "var(--warning)" }}
                  >
                    <div className="font-medium">
                      {t("rejected.count", { count: preview.rejectedCount })}
                    </div>
                    <ul className="mt-0.5 space-y-0.5">
                      {preview.rejected?.map((r) => (
                        <li key={r.row}>
                          {r.value
                            ? t("rejected.example", {
                                row: r.row,
                                reason: t(`rejected.reason.${r.reason}`),
                                value: r.value,
                              })
                            : t("rejected.exampleNoValue", {
                                row: r.row,
                                reason: t(`rejected.reason.${r.reason}`),
                              })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button className="h-9 md:h-7" variant="ghost" onClick={reset} disabled={busy}>
                  {t("cancel")}
                </Button>
                <Button
                  className="h-9 md:h-7"
                  onClick={commit}
                  disabled={busy || importable === 0}
                  title={importable === 0 ? t("nothingToImport") : undefined}
                >
                  {pending ? t("importing") : t("validate")}
                  <ChevronRight />
                </Button>
              </div>
              {progress !== null && (
                <div className="w-full space-y-1" data-slot="import-progress">
                  <div
                    role="progressbar"
                    aria-label={t("importing")}
                    aria-valuemin={0}
                    aria-valuemax={importable}
                    aria-valuenow={Math.min(progress, importable)}
                    className="bg-muted h-1.5 overflow-hidden rounded-full"
                  >
                    <div
                      className="bg-primary h-full transition-[width]"
                      style={{ width: `${importable ? (100 * progress) / importable : 0}%` }}
                    />
                  </div>
                  <div className="text-muted-foreground text-xs tabular-nums">
                    {t("progress", { done: Math.min(progress, importable), total: importable })}
                  </div>
                </div>
              )}
              {importable === 0 && !pending && (
                <p className="text-muted-foreground w-full text-xs">{t("nothingToImport")}</p>
              )}
            </div>

            {products.map((product) => (
              <div key={product.key} data-slot="pdf-product">
                {products.length > 1 && (
                  <div className="bg-muted/40 flex items-center justify-between gap-3 border-y px-5 py-2">
                    <span className="text-sm font-medium">{t(`products.${product.key}`)}</span>
                    <NativeSelect
                      value={productAccount[product.key] ?? ""}
                      aria-label={t("productAccount", {
                        product: t(`products.${product.key}`),
                      })}
                      onChange={(e) => onProductAccountChange(product.key, e.target.value)}
                      disabled={busy}
                      size="sm"
                      className="w-auto min-w-40"
                    >
                      <option value="">{t("ignoreProduct")}</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}
                <div className="text-muted-foreground bg-muted/60 hidden grid-cols-[28px_60px_minmax(0,1fr)_172px_96px] items-center gap-3 border-y px-5 py-2.5 text-[11px] tracking-[0.08em] uppercase md:grid">
                  <span aria-hidden />
                  <span>{t("colDate")}</span>
                  <span>{t("colRawLabel")}</span>
                  <span>{t("colCategory")}</span>
                  <span className="text-right">{t("colAmount")}</span>
                </div>
                {product.preview.map((r) => {
                  const dupBadge = r.isDuplicate ? (
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
                  ) : null;
                  const dimmed = r.isDuplicate || excluded[r.externalId];
                  return (
                    <div
                      key={r.externalId}
                      data-slot="import-preview-row"
                      className="border-b last:border-b-0"
                      style={r.isDuplicate ? { background: "var(--warning-bg)" } : undefined}
                    >
                      {/* Desktop grid */}
                      <div
                        className={cn(
                          "hidden grid-cols-[28px_60px_minmax(0,1fr)_172px_96px] items-center gap-3 px-5 py-2 md:grid",
                          dimmed && "opacity-60",
                        )}
                      >
                        {includeCheckbox(r, product.key)}
                        <span className="text-muted-foreground text-xs">
                          {dayMonth.format(new Date(r.date))}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span
                            className="text-muted-foreground truncate font-mono text-[12.5px]"
                            title={r.rawLabel}
                          >
                            {r.rawLabel}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
                            {tType(`types.${r.type}`)}
                            {dupBadge}
                          </span>
                        </span>
                        <span className="min-w-0">{categorySelect(r)}</span>
                        <span
                          className="text-right text-sm font-medium tabular-nums"
                          style={r.amount > 0 ? { color: "var(--income)" } : undefined}
                        >
                          {money.format(r.amount)}
                        </span>
                      </div>

                      {/* Mobile compact */}
                      <div className={cn("flex gap-3 px-4 py-3 md:hidden", dimmed && "opacity-60")}>
                        <div className="pt-0.5">{includeCheckbox(r, product.key)}</div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <span className="truncate font-mono text-[12.5px]">{r.rawLabel}</span>
                            <span
                              className="shrink-0 text-sm font-medium tabular-nums"
                              style={r.amount > 0 ? { color: "var(--income)" } : undefined}
                            >
                              {money.format(r.amount)}
                            </span>
                          </div>
                          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                            <span className="tabular-nums">
                              {dayMonth.format(new Date(r.date))}
                            </span>
                            <span aria-hidden>·</span>
                            <span>{tType(`types.${r.type}`)}</span>
                            {dupBadge}
                          </div>
                          <div className="flex items-center">{categorySelect(r)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {pager(product)}
              </div>
            ))}
            {error && (
              <p role="alert" className="text-destructive p-5 text-sm">
                {errorText(error)}
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
