"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, ChevronRight, ChevronLeft, ChevronDown, PenLine, Check } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedTabs, overline } from "@/components/transactions/bits";
import { CategoryCombobox } from "@/components/transactions/category-combobox";
import { Stepper, FieldMap, CheckRow } from "./wizard-bits";
import {
  CSV_FIELDS,
  CSV_MAX_BYTES,
  DATE_ORDERS,
  DECIMAL_MARKS,
  DEFAULT_DATE_ORDER,
  OFX_MAX_BYTES,
  PDF_MAX_BYTES,
  type DateOrder,
  type DecimalMark,
} from "@/lib/validation/import";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { PageHeader } from "@/components/shell/page-header";
import { NativeSelect } from "@/components/ui/native-select";
import { discardImportAction } from "@/server/transport/actions/imports";
import { cn } from "@/lib/utils";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { previewCategoryId, rejectedFields } from "@/lib/import-preview";
import { RevertImportDialog } from "./revert-import-dialog";
import { AddBlockedState, ADD_BLOCKED_ID } from "@/components/onboarding/add-blocked";
import type { AddTransactionBlocker } from "@/lib/onboarding";
import { SUPPORTED_BANKS, type BankKey } from "@/server/services/imports/pdf/detect";
import type { OfxBalance, OfxPreviewProduct } from "@/server/services/imports/ofx-service";

type Account = { id: string; name: string; bankName: string | null };
type PreviewRow = {
  externalId: string;
  date: string;
  amount: number;
  rawLabel: string;
  type: string;
  suggestedCategoryId: string | null;
  isDuplicate: boolean;
  probableOf: string | null;
};
type Product = {
  key: string;
  totalRows: number;
  duplicateCount: number;
  probableCount: number;
  viewRows: number;
  autoCategorizedCount: number;
  preview: PreviewRow[];
  page: number;
  pageSize: number;
  kind?: OfxPreviewProduct["kind"];
  accountType?: string | null;
  accountLast4?: string;
  balance?: OfxBalance | null;
};
type Source = "CSV" | "PDF" | "OFX";
type Preview = {
  batchId: string;
  source: Source;
  filename: string | null;
  fileSizeBytes: number | null;
  bank?: string | null;
  headers?: string[];
  mapping?: Record<string, string | undefined>;
  totalRows?: number;
  duplicateCount?: number;
  probableCount?: number;
  viewRows?: number;
  autoCategorizedCount?: number;
  rejectedCount?: number;
  rejected?: { row: number; reason: string; value: string }[];
  decimalGuessed?: boolean;
  dateOrderGuessed?: boolean;
  preview?: PreviewRow[];
  page?: number;
  pageSize?: number;
  products?: Product[];
  error?: string;
};

type Summary = { importedRows: number; skippedRows: number; rejectedRows?: number };
// A ticked/unticked row: its product, plus the amount and date the live OFX balance needs.
type RowEdit = { product: string; amount: number; date: string };

const CSV_PRODUCT = "default";

function isPdfFile(f: File): boolean {
  return f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf";
}

function isOfxFile(f: File): boolean {
  return f.name.toLowerCase().endsWith(".ofx") || f.type === "application/x-ofx";
}

const sourceOf = (f: File): Source => (isPdfFile(f) ? "PDF" : isOfxFile(f) ? "OFX" : "CSV");
const MAX_BYTES: Record<Source, number> = {
  CSV: CSV_MAX_BYTES,
  PDF: PDF_MAX_BYTES,
  OFX: OFX_MAX_BYTES,
};
const apiBase = (source: Source) => `/api/import/${source.toLowerCase()}`;
const OFX_ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "MONEYMRKT", "CREDITLINE", "CREDITCARD"];
const round2 = (x: number) => Math.round(x * 100) / 100;

const MARK_KEY: Record<DecimalMark, "comma" | "dot"> = { ",": "comma", ".": "dot" };
const otherMark = (m: DecimalMark): DecimalMark => (m === "," ? "." : ",");
const isBankKey = (b: string | null | undefined): b is BankKey =>
  (SUPPORTED_BANKS as readonly string[]).includes(b ?? "");
const otherDateOrder = (o: DateOrder): DateOrder => (o === "DMY" ? "MDY" : "DMY");

function columnsOf(mapping: Record<string, string | undefined> | undefined) {
  return Object.fromEntries(
    Object.entries(mapping ?? {}).filter(
      ([k, v]) => v && (CSV_FIELDS as readonly string[]).includes(k),
    ),
  ) as Record<string, string>;
}

// Until the user picks a decimal mark or date order, it's left out so the server
// re-detects it (and keeps flagging a guessed mark, #187) on every page and remap.
function csvMappingBody(
  columns: Record<string, string>,
  decimal: DecimalMark | null,
  dateOrder: DateOrder | null,
) {
  return {
    ...columnsOf(columns),
    ...(decimal ? { decimal } : {}),
    ...(dateOrder ? { dateOrder } : {}),
  };
}

export function ImportWizard({
  accounts,
  addBlocker = null,
  categories,
  history,
}: {
  accounts: Account[];
  addBlocker?: AddTransactionBlocker | null;
  categories: FlatCategory[];
  history?: ReactNode;
}) {
  const t = useTranslations("import");
  const tType = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });

  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [decimalChoice, setDecimalChoice] = useState<DecimalMark | null>(null);
  const [dateOrderChoice, setDateOrderChoice] = useState<DateOrder | null>(null);
  const [productAccount, setProductAccount] = useState<Record<string, string>>({});
  // Per-row edits keyed by externalId: category override, and exclusion (keeping the
  // row's product, so ignored products don't count their exclusions).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, RowEdit>>({});
  // Probable duplicates are skipped unless ticked, kept like `excluded`.
  const [includedProbable, setIncludedProbable] = useState<Record<string, RowEdit>>({});
  // OFX products whose opening balance the commit should adjust.
  const [adjustBalance, setAdjustBalance] = useState<string[]>([]);
  const [probableOnly, setProbableOnly] = useState(false);
  // Bumped when per-row edits reset, to remount the (uncontrolled) row category pickers.
  const [editsEpoch, setEditsEpoch] = useState(0);
  const [autoCategorize, setAutoCategorize] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reverting, setReverting] = useState(false);
  const [reverted, setReverted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const refreshSeq = useRef(0);
  const previewTop = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();

  const guessedMark = preview?.mapping?.decimal as DecimalMark | undefined;
  const shownDecimal = decimalChoice ?? guessedMark ?? ",";
  const shownDateOrder =
    dateOrderChoice ?? (preview?.mapping?.dateOrder as DateOrder | undefined) ?? DEFAULT_DATE_ORDER;
  const step = summary ? 3 : preview ? 2 : loading ? 1 : 0;
  // An upload replaces (and discards) the previewed batch: nothing may commit or re-upload meanwhile.
  const busy = loading || pending || refreshing;

  function errorText(code: string): string {
    if (code === "TOO_LARGE") {
      const max = MAX_BYTES[file ? sourceOf(file) : "CSV"];
      return t("error.TOO_LARGE", { max: formatBytes(max, locale) });
    }
    return t.has(`error.${code}`) ? t(`error.${code}`) : t("error.PARSE_FAILED");
  }

  async function upload(f: File, account: string) {
    discard(preview?.batchId);
    setError(null);
    setMappingError(null);
    const source = sourceOf(f);
    if (f.size === 0) return setError("EMPTY");
    if (f.size > MAX_BYTES[source]) return setError("TOO_LARGE");
    setLoading(true);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("accountId", account);
    try {
      const res = await fetch(apiBase(source), { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as Preview;
      if (!res.ok) {
        setError(data.error ?? "PARSE_FAILED");
        return;
      }
      setPreview(data);
      setOverrides({});
      setExcluded({});
      setIncludedProbable({});
      setAdjustBalance([]);
      setProbableOnly(false);
      setSettingsOpen(false);
      setColumns(columnsOf(data.mapping));
      setDecimalChoice(null);
      setDateOrderChoice(null);
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
  // The current probable-only filter carries over unless the body sets it.
  async function refresh(
    body: { probableOnly?: boolean } & Record<string, unknown>,
    opts: { resetEdits?: boolean; mapping?: boolean; onFail?: () => void } = {},
  ) {
    if (!preview) return;
    const sent = { probableOnly, ...body };
    const url = `${apiBase(preview.source)}/${preview.batchId}/preview`;
    const seq = ++refreshSeq.current;
    setRefreshing(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent),
      });
      const data = (await res.json().catch(() => ({}))) as Preview;
      if (seq !== refreshSeq.current) return;
      if (!res.ok) throw new Error(data.error ?? "PARSE_FAILED");
      setError(null);
      setMappingError(null);
      setPreview(data);
      setProbableOnly(sent.probableOnly);
      if (opts.resetEdits) {
        setOverrides({});
        setExcluded({});
        setIncludedProbable({});
        setEditsEpoch((n) => n + 1);
      }
    } catch (e) {
      if (seq !== refreshSeq.current) return;
      opts.onFail?.();
      const code = e instanceof Error ? e.message : "PARSE_FAILED";
      // Shown by the mapping controls the user just changed (the sidebar).
      if (opts.mapping) setMappingError(code);
      else setError(code);
    } finally {
      if (seq === refreshSeq.current) setRefreshing(false);
    }
  }

  // The preview is rebuilt with the edited mapping, so it shows exactly what a
  // commit will import; the rows' keys change, hence the reset per-row edits.
  function remap(field: string, header: string) {
    if (!preview || preview.source !== "CSV") return;
    const next = { ...columns, [field]: header };
    const shown = columnsOf(preview.mapping);
    setColumns(next);
    void refresh(
      { mapping: csvMappingBody(next, decimalChoice, dateOrderChoice), page: 0 },
      // The preview didn't change, so neither does the mapping a commit will use.
      { resetEdits: true, mapping: true, onFail: () => setColumns(shown) },
    );
  }

  // Picking the guessed mark again confirms it: same amounts, so per-row edits stay.
  // The banner sits in the preview card, so its errors show there, not in the sidebar.
  function chooseDecimal(mark: DecimalMark, fromBanner = false) {
    if (!preview || preview.source !== "CSV") return;
    const confirming = mark === shownDecimal;
    if (confirming && !preview.decimalGuessed) return;
    const previous = decimalChoice;
    setDecimalChoice(mark);
    void refresh(
      {
        mapping: csvMappingBody(columns, mark, dateOrderChoice),
        page: confirming ? (preview.page ?? 0) : 0,
      },
      {
        resetEdits: !confirming,
        mapping: !fromBanner,
        onFail: () => setDecimalChoice(previous),
      },
    );
  }

  // Same confirm-or-switch flow as chooseDecimal, for a guessed date order.
  function chooseDateOrder(order: DateOrder, fromBanner = false) {
    if (!preview || preview.source !== "CSV") return;
    const confirming = order === shownDateOrder;
    if (confirming && !preview.dateOrderGuessed) return;
    const previous = dateOrderChoice;
    setDateOrderChoice(order);
    void refresh(
      {
        mapping: csvMappingBody(columns, decimalChoice, order),
        page: confirming ? (preview.page ?? 0) : 0,
      },
      {
        resetEdits: !confirming,
        mapping: !fromBanner,
        onFail: () => setDateOrderChoice(previous),
      },
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
        ? { mapping: csvMappingBody(columns, decimalChoice, dateOrderChoice), page }
        : pdfBody({ ...pages, [productKey]: page }, productAccount),
    );
    previewTop.current?.scrollIntoView({ block: "start" });
  }

  async function toggleProbableOnly() {
    if (!preview) return;
    const next = !probableOnly;
    await refresh(
      preview.source === "CSV"
        ? {
            mapping: csvMappingBody(columns, decimalChoice, dateOrderChoice),
            page: 0,
            probableOnly: next,
          }
        : { ...pdfBody({}, productAccount), probableOnly: next },
    );
    previewTop.current?.scrollIntoView({ block: "start" });
  }

  // Duplicates depend on the target account, so the product's rows are re-checked.
  function onProductAccountChange(productKey: string, account: string) {
    const next = { ...productAccount, [productKey]: account };
    setProductAccount(next);
    // Both ticks were given against the previous account: its transaction, its balance.
    setIncludedProbable((m) =>
      Object.fromEntries(Object.entries(m).filter(([, e]) => e.product !== productKey)),
    );
    setAdjustBalance((keys) => keys.filter((k) => k !== productKey));
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
    setDecimalChoice(null);
    setDateOrderChoice(null);
    setProductAccount({});
    setOverrides({});
    setExcluded({});
    setIncludedProbable({});
    setAdjustBalance([]);
    setProbableOnly(false);
    setError(null);
    setMappingError(null);
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
      const url = `${apiBase(preview.source)}/${preview.batchId}/commit`;
      const edits = {
        autoCategorize,
        overrides,
        excludedIds: Object.keys(excluded),
        includedProbableIds: Object.keys(includedProbable),
      };
      const mapping = Object.fromEntries(Object.entries(productAccount).filter(([, v]) => v));
      const body =
        preview.source === "CSV"
          ? { mapping: preview.mapping, ...edits }
          : preview.source === "PDF"
            ? { mapping, ...edits }
            : {
                mapping,
                ...edits,
                adjustBalance: adjustBalance.filter(
                  (k) => mapping[k] && products.find((p) => p.key === k)?.balance?.canAdjust,
                ),
              };
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
    ? preview.source !== "CSV"
      ? (preview.products ?? [])
      : [
          {
            key: CSV_PRODUCT,
            totalRows: preview.totalRows ?? 0,
            duplicateCount: preview.duplicateCount ?? 0,
            probableCount: preview.probableCount ?? 0,
            viewRows: preview.viewRows ?? 0,
            autoCategorizedCount: preview.autoCategorizedCount ?? 0,
            preview: preview.preview ?? [],
            page: preview.page ?? 0,
            pageSize: preview.pageSize ?? 50,
          },
        ]
    : [];
  const total = products.reduce((n, p) => n + p.totalRows, 0);
  const invalidFields = rejectedFields(preview?.rejected);
  const dupCount = products.reduce((n, p) => n + p.duplicateCount, 0);
  const catCount = products.reduce((n, p) => n + p.autoCategorizedCount, 0);
  const probableTotal = products.reduce((n, p) => n + p.probableCount, 0);
  const countIn = (edits: Record<string, RowEdit>, key: string) =>
    Object.values(edits).filter((e) => e.product === key).length;
  // Rows a commit would write: duplicates are always skipped, and so are unticked
  // probable duplicates, unchecked rows and products mapped to no account.
  const importable = products
    .filter((p) => productAccount[p.key])
    .reduce(
      (n, p) =>
        n +
        Math.max(
          0,
          p.totalRows -
            p.duplicateCount -
            Math.max(0, p.probableCount - countIn(includedProbable, p.key)) -
            countIn(excluded, p.key),
        ),
      0,
    );
  const sourceBadge = preview?.source ?? (file ? sourceOf(file) : "CSV");
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
  // as the transactions screen.
  function categorySelect(r: PreviewRow) {
    return (
      <CategoryCombobox
        key={`${autoCategorize}-${editsEpoch}`}
        aria-label={t("rowCategory", { label: r.rawLabel })}
        categories={categories}
        defaultValue={previewCategoryId(r, overrides, autoCategorize)}
        onChange={(id) => setOverrides((o) => ({ ...o, [r.externalId]: id }))}
      />
    );
  }

  const isIncluded = (r: PreviewRow) =>
    !r.isDuplicate &&
    (r.probableOf !== null ? !!includedProbable[r.externalId] : !excluded[r.externalId]);

  // Include/exclude checkbox per row (checked = will be imported). A duplicate
  // is never imported, so its box stays unchecked and locked; a probable one is opt-in.
  function includeCheckbox(r: PreviewRow, productKey: string) {
    const checked = isIncluded(r);
    const probable = r.probableOf !== null;
    const toggle = (edits: Record<string, RowEdit>) => {
      const next = { ...edits };
      if (probable ? !checked : checked) {
        next[r.externalId] = { product: productKey, amount: r.amount, date: r.date };
      } else delete next[r.externalId];
      return next;
    };
    // externalId doesn't depend on the account, so a PDF account switch can leave the
    // row in the other map: the maps stay exclusive, the server checks `excluded` first.
    const forget = (edits: Record<string, RowEdit>) => {
      if (!(r.externalId in edits)) return edits;
      const next = { ...edits };
      delete next[r.externalId];
      return next;
    };
    return (
      <input
        type="checkbox"
        aria-label={
          r.isDuplicate ? t("duplicateSkipped") : probable ? t("probableInclude") : t("include")
        }
        checked={checked}
        disabled={r.isDuplicate || busy}
        onChange={() => {
          (probable ? setIncludedProbable : setExcluded)(toggle);
          (probable ? setExcluded : setIncludedProbable)(forget);
        }}
        className="size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed md:size-4"
        style={{ accentColor: "var(--primary)" }}
      />
    );
  }

  function pager(product: Product) {
    if (product.viewRows <= product.pageSize) return null;
    const from = product.page * product.pageSize + 1;
    const to = Math.min(product.viewRows, from + product.pageSize - 1);
    const last = Math.ceil(product.viewRows / product.pageSize) - 1;
    return (
      <div
        data-slot="import-pager"
        className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-xs last:border-b-0 md:px-5"
      >
        <span>
          {t("pager.range", {
            from: formatCount(from, locale),
            to: formatCount(to, locale),
            total: formatCount(product.viewRows, locale),
          })}
        </span>
        <span className="flex gap-2">
          <Button
            variant="outline"
            className="h-10 md:h-8"
            disabled={busy || product.page === 0}
            onClick={() => void goToPage(product.key, product.page - 1)}
          >
            <ChevronLeft />
            {t("pager.previous")}
          </Button>
          <Button
            variant="outline"
            className="h-10 md:h-8"
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

  function productTitle(product: Product) {
    if (preview?.source !== "OFX") return t(`products.${product.key}`);
    const type = product.kind === "CREDITCARD" ? "CREDITCARD" : (product.accountType ?? "");
    return t("ofxProduct", {
      type: t(`ofxAccountType.${OFX_ACCOUNT_TYPES.includes(type) ? type : "OTHER"}`),
      last4: product.accountLast4 ?? "",
    });
  }

  // Server figures plus the rows the user toggled since: what the commit would produce (spec §5.5).
  function balanceBlock(product: Product) {
    const b = product.balance;
    if (!b || !productAccount[product.key]) return null;
    const upToAsOf = (edits: Record<string, RowEdit>) =>
      Object.values(edits)
        .filter((e) => e.product === product.key && e.date.slice(0, 10) <= b.asOf)
        .reduce((n, e) => n + e.amount, 0);
    const after = round2(
      b.base + b.defaultImport - upToAsOf(excluded) + upToAsOf(includedProbable),
    );
    const gap = round2(b.ledger - after);
    return (
      <div
        data-slot="import-ofx-balance"
        className="flex flex-wrap items-end gap-x-6 gap-y-2 border-y px-4 py-3 text-xs md:px-5"
      >
        <div>
          <div className="text-muted-foreground">
            {t("balance.bank", { date: formatDate(b.asOf, locale) })}
          </div>
          <div className="text-sm font-medium tabular-nums">{money.format(b.ledger)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">{t("balance.after")}</div>
          <div className="text-sm font-medium tabular-nums">{money.format(after)}</div>
        </div>
        {gap === 0 ? (
          <p role="status" className="flex items-center gap-1 font-medium">
            <Check aria-hidden className="size-3.5" style={{ color: "var(--income)" }} />
            {t("balance.matches")}
          </p>
        ) : (
          <p role="status" className="font-medium" style={{ color: "var(--warning-text)" }}>
            {t("balance.gap", { amount: money.format(gap) })}
          </p>
        )}
        {b.canAdjust && (
          <label className="flex w-full cursor-pointer items-center gap-2 max-md:min-h-10">
            <input
              type="checkbox"
              checked={adjustBalance.includes(product.key)}
              disabled={busy}
              onChange={(e) =>
                setAdjustBalance((keys) =>
                  e.target.checked ? [...keys, product.key] : keys.filter((k) => k !== product.key),
                )
              }
              className="size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed md:size-4"
              style={{ accentColor: "var(--primary)" }}
            />
            {t("balance.adjust")}
          </label>
        )}
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
          accounts.length === 0 ? (
            <Button variant="outline" aria-disabled="true" aria-describedby={ADD_BLOCKED_ID}>
              <PenLine />
              {t("manualEntry")}
            </Button>
          ) : (
            <TransactionForm
              accounts={accounts}
              categories={categories}
              trigger={
                <Button variant="outline">
                  <PenLine />
                  {t("manualEntry")}
                </Button>
              }
            />
          )
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
      ) : !preview && accounts.length === 0 ? (
        <div className="mx-auto max-w-xl space-y-4 pt-4">
          <AddBlockedState reason={addBlocker ?? "NO_ACCOUNT"} />
          {history}
        </div>
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
                ofx: formatBytes(OFX_MAX_BYTES, locale),
              })}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,.pdf,application/pdf,.ofx,application/x-ofx"
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
                <span
                  className="text-muted-foreground block truncate text-[11.5px]"
                  title={settingsSummary}
                >
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
                  <span className="bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-[10px]">
                    {sourceBadge}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px]" title={preview.filename ?? undefined}>
                      {preview.filename ?? sourceBadge}
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      {t("fileMeta", {
                        count: total + (preview.rejectedCount ?? 0),
                        size: preview.fileSizeBytes
                          ? formatBytes(preview.fileSizeBytes, locale)
                          : "",
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
                          <div className="truncate text-[13px]" title={a.name}>
                            {a.name}
                          </div>
                          {a.bankName && (
                            <div
                              className="text-muted-foreground truncate text-[10.5px]"
                              title={a.bankName}
                            >
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
                  <>
                    {mappingError && (
                      <p
                        role="alert"
                        data-slot="import-mapping-error"
                        className="text-destructive pb-1 text-xs leading-snug"
                      >
                        {errorText(mappingError)}
                      </p>
                    )}
                    {CSV_FIELDS.map((field) => (
                      <FieldMap
                        key={field}
                        label={fieldLabel(field)}
                        mapped={!!columns[field]}
                        invalid={invalidFields.has(field) ? t("fieldRejected") : undefined}
                      >
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
                    ))}
                    <FieldMap label={t("decimal.label")}>
                      <SegmentedTabs<DecimalMark>
                        aria-label={t("decimal.label")}
                        items={DECIMAL_MARKS.map((m) => ({
                          id: m,
                          label: t(`decimal.${MARK_KEY[m]}`),
                        }))}
                        value={shownDecimal}
                        onChange={(mark) => chooseDecimal(mark)}
                        disabled={busy}
                        className="grid w-full grid-cols-2"
                      />
                    </FieldMap>
                    <FieldMap label={t("dateOrder.label")}>
                      <SegmentedTabs<DateOrder>
                        aria-label={t("dateOrder.label")}
                        items={DATE_ORDERS.map((o) => ({ id: o, label: t(`dateOrder.${o}`) }))}
                        value={shownDateOrder}
                        onChange={(order) => chooseDateOrder(order)}
                        disabled={busy}
                        className="grid w-full grid-cols-2"
                      />
                    </FieldMap>
                  </>
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
          {/* Rows switch layout on the card's own width: it sits beside the sidebar. */}
          <Card data-slot="import-preview" className="@container/preview gap-0 overflow-hidden p-0">
            <div
              ref={previewTop}
              className="flex scroll-mt-20 flex-wrap items-center justify-between gap-3 p-4 md:p-5"
            >
              <div>
                <div className="font-display text-lg">{t("previewTitle", { count: total })}</div>
                <div data-slot="import-preview-meta" className="text-muted-foreground text-xs">
                  {autoCategorize
                    ? t("previewMeta", { dup: dupCount, cat: catCount })
                    : t("previewMetaNoCat", { dup: dupCount })}
                </div>
                {(probableTotal > 0 || probableOnly) && (
                  <div className="mt-2 space-y-2" data-slot="import-probable">
                    <p
                      role="status"
                      className="text-xs font-medium"
                      style={{ color: "var(--warning-text)" }}
                    >
                      {t("probable.count", { count: probableTotal })}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-md:h-10"
                      disabled={busy}
                      onClick={() => void toggleProbableOnly()}
                    >
                      {probableOnly ? t("probable.showAll") : t("probable.showOnly")}
                    </Button>
                  </div>
                )}
                {preview.source === "CSV" && preview.decimalGuessed && guessedMark && (
                  <div className="mt-2 space-y-2" data-slot="import-decimal-guessed">
                    <p
                      role="status"
                      className="text-xs font-medium"
                      style={{ color: "var(--warning-text)" }}
                    >
                      {t("decimal.guessed", { mark: MARK_KEY[guessedMark] })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="max-md:h-10"
                        disabled={busy}
                        onClick={() => chooseDecimal(guessedMark, true)}
                      >
                        {t("decimal.confirm")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="max-md:h-10"
                        disabled={busy}
                        onClick={() => chooseDecimal(otherMark(guessedMark), true)}
                      >
                        {t("decimal.useOther", { mark: MARK_KEY[otherMark(guessedMark)] })}
                      </Button>
                    </div>
                  </div>
                )}
                {preview.source === "PDF" &&
                  (isBankKey(preview.bank) ? (
                    <p data-slot="import-pdf-bank" className="text-muted-foreground mt-1 text-xs">
                      {t("bankDetected", { bank: t(`banks.${preview.bank}`) })}
                    </p>
                  ) : (
                    <div
                      data-slot="import-pdf-bank"
                      role="status"
                      className="mt-2 space-y-0.5 text-xs"
                      style={{ color: "var(--warning-text)" }}
                    >
                      <p className="font-medium">{t("bankUnknown")}</p>
                      <p>
                        {t("supportedBanks", {
                          list: new Intl.ListFormat(locale, { type: "conjunction" }).format(
                            SUPPORTED_BANKS.map((b) => t(`banks.${b}`)),
                          ),
                        })}
                      </p>
                    </div>
                  ))}
                {preview.source === "CSV" && preview.dateOrderGuessed && (
                  <div className="mt-2 space-y-2" data-slot="import-date-order-guessed">
                    <p
                      role="status"
                      className="text-xs font-medium"
                      style={{ color: "var(--warning-text)" }}
                    >
                      {t("dateOrder.guessed", { order: t(`dateOrder.${shownDateOrder}`) })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="max-md:h-10"
                        disabled={busy}
                        onClick={() => chooseDateOrder(shownDateOrder, true)}
                      >
                        {t("dateOrder.confirm")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="max-md:h-10"
                        disabled={busy}
                        onClick={() => chooseDateOrder(otherDateOrder(shownDateOrder), true)}
                      >
                        {t("dateOrder.useOther", {
                          order: t(`dateOrder.${otherDateOrder(shownDateOrder)}`),
                        })}
                      </Button>
                    </div>
                  </div>
                )}
                {!!preview.rejectedCount && (
                  <div
                    className="mt-2 text-xs"
                    data-slot="import-rejected"
                    style={{ color: "var(--warning-text)" }}
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
                <Button className="h-10 md:h-7" variant="ghost" onClick={reset} disabled={busy}>
                  {t("cancel")}
                </Button>
                <Button
                  className="h-10 md:h-7"
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
              {error && (
                <p role="alert" className="text-destructive w-full text-sm">
                  {errorText(error)}
                </p>
              )}
            </div>

            {products.map((product) => (
              <div key={product.key} data-slot="pdf-product">
                {products.length > 1 && (
                  <div className="bg-muted/40 flex items-center justify-between gap-3 border-y px-5 py-2">
                    <span className="text-sm font-medium">{productTitle(product)}</span>
                    <NativeSelect
                      value={productAccount[product.key] ?? ""}
                      aria-label={t("productAccount", { product: productTitle(product) })}
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
                {balanceBlock(product)}
                <div className="text-muted-foreground bg-muted/60 hidden grid-cols-[28px_92px_minmax(0,1fr)_172px_104px] items-center gap-3 border-y px-5 py-2.5 text-[11px] tracking-[0.08em] uppercase @2xl/preview:grid">
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
                      style={{ color: "var(--warning-text)", background: "var(--warning-bg)" }}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: "var(--warning)" }}
                      />
                      {t("duplicate")}
                    </span>
                  ) : r.probableOf !== null ? (
                    <span
                      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[0.65rem] font-medium"
                      style={{ color: "var(--warning-text)", borderColor: "var(--warning)" }}
                    >
                      <span
                        className="size-1.5 rounded-full border"
                        style={{ borderColor: "var(--warning)" }}
                      />
                      {t("probableDuplicate")}
                    </span>
                  ) : null;
                  const probableLine = r.probableOf !== null && (
                    <span
                      data-slot="import-row-probable"
                      className="text-muted-foreground truncate font-mono text-[11px]"
                      title={r.probableOf}
                    >
                      {t("probableOf", { label: r.probableOf })}
                    </span>
                  );
                  // Muted color keeps dimmed rows at AA contrast.
                  const dimmed = !isIncluded(r);
                  return (
                    <div
                      key={r.externalId}
                      data-slot="import-preview-row"
                      className="border-b last:border-b-0"
                      style={r.isDuplicate ? { background: "var(--warning-bg)" } : undefined}
                    >
                      <div
                        className={cn(
                          "hidden grid-cols-[28px_92px_minmax(0,1fr)_172px_104px] items-center gap-3 px-5 py-2 @2xl/preview:grid",
                          dimmed && "text-muted-foreground",
                        )}
                      >
                        {includeCheckbox(r, product.key)}
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          {formatDate(r.date, locale)}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span
                            data-slot="import-row-label"
                            className="text-muted-foreground truncate font-mono text-[12.5px]"
                            title={r.rawLabel}
                          >
                            {r.rawLabel}
                          </span>
                          {probableLine}
                          <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
                            {tType(`types.${r.type}`)}
                            {dupBadge}
                          </span>
                        </span>
                        <span className="min-w-0">{categorySelect(r)}</span>
                        <span
                          data-slot="import-row-amount"
                          className="text-right text-sm font-medium whitespace-nowrap tabular-nums"
                          style={r.amount > 0 && !dimmed ? { color: "var(--income)" } : undefined}
                        >
                          {money.format(r.amount)}
                        </span>
                      </div>

                      <div
                        className={cn(
                          "flex gap-3 px-4 py-3 @2xl/preview:hidden",
                          dimmed && "text-muted-foreground",
                        )}
                      >
                        <div className="pt-0.5">{includeCheckbox(r, product.key)}</div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <span
                              data-slot="import-row-label"
                              className="truncate font-mono text-[12.5px]"
                              title={r.rawLabel}
                            >
                              {r.rawLabel}
                            </span>
                            <span
                              data-slot="import-row-amount"
                              className="shrink-0 text-sm font-medium tabular-nums"
                              style={
                                r.amount > 0 && !dimmed ? { color: "var(--income)" } : undefined
                              }
                            >
                              {money.format(r.amount)}
                            </span>
                          </div>
                          {probableLine}
                          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                            <span className="tabular-nums">{formatDate(r.date, locale)}</span>
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
          </Card>
        </div>
      )}
    </div>
  );
}
