"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Pencil, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { removeMerchantAliasAction } from "@/server/transport/actions/merchants";
import type { MerchantDirectory as Directory, MerchantTotal } from "@/lib/insights";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { MerchantNameDialog, type MerchantTarget } from "./merchant-name-dialog";

const PAGE = 12;
const NO_TARGET: MerchantTarget = { key: null, alias: null, keys: [], label: "" };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function MerchantDirectory({
  directory,
  categories,
}: {
  directory: Directory;
  categories: FlatCategory[];
}) {
  const t = useTranslations("merchants");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<MerchantTarget>(NO_TARGET);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const names = directory.renamed.map((m) => m.label);

  const q = fold(query.trim());
  const matches = (m: MerchantTotal) =>
    !q || fold(m.label).includes(q) || m.keys.some((k) => fold(k).includes(q));
  const renamed = directory.renamed.filter(matches);
  const others = directory.others.filter(matches);
  const shown = others.slice(0, limit);

  function detach(key: string) {
    setError(null);
    startTransition(async () => {
      const r = await removeMerchantAliasAction(key);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  if (directory.renamed.length + directory.others.length === 0) {
    return (
      <div className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        {t("empty")}
      </div>
    );
  }

  const row = (m: MerchantTotal) => (
    <div
      key={m.alias ? `a:${m.alias}` : `k:${m.keys[0]}`}
      data-slot="merchant-row"
      className="flex items-center gap-2 border-t px-4 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${m.alias ? "font-medium" : ""}`}>{m.label}</div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs">
          {m.alias ? (
            m.keys.map((k) => (
              <span key={k} className="inline-flex items-center gap-0.5">
                {k}
                {m.keys.length > 1 && (
                  <button
                    type="button"
                    className="hover:text-foreground -my-1 rounded p-1"
                    aria-label={t("removeKey", { key: k, name: m.label })}
                    disabled={pending}
                    onClick={() => detach(k)}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))
          ) : (
            <span>{(m.categoryId && catName.get(m.categoryId)) || t("noCategory")}</span>
          )}
          <span>· {t("count", { count: m.count })}</span>
        </div>
      </div>
      <span className="text-sm font-semibold tabular-nums">{money.format(m.total)}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={t("rename", { name: m.label })}
        disabled={pending}
        onClick={() => {
          setEditing({
            key: m.alias ? null : m.keys[0],
            alias: m.alias,
            keys: m.keys,
            label: m.label,
          });
          setEditOpen(true);
        }}
      >
        <Pencil />
      </Button>
    </div>
  );

  const section = (title: string, count: number, body: React.ReactNode) => (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      <p className="text-muted-foreground px-4 py-2.5 text-[11px] tracking-[0.08em] uppercase">
        {title} · {count}
      </p>
      {body}
    </div>
  );

  return (
    <div className="space-y-3.5">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder={t("search")}
          aria-label={t("search")}
          className="pl-9"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}

      {renamed.length > 0 && section(t("renamedSection"), renamed.length, renamed.map(row))}

      {others.length > 0 &&
        section(
          t("othersSection"),
          others.length,
          <>
            {shown.map(row)}
            {shown.length < others.length && (
              <button
                type="button"
                className="hover:bg-muted/50 w-full border-t py-3 text-center text-sm font-medium"
                onClick={() => setLimit((l) => l + PAGE * 4)}
              >
                {t("showMore", { count: Math.min(PAGE * 4, others.length - shown.length) })}
              </button>
            )}
          </>,
        )}

      {renamed.length + others.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">{t("noMatch")}</p>
      )}

      <MerchantNameDialog
        target={editing}
        names={names}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}
