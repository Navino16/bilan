"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@/components/ui/native-select";
import { BASELINES, type Baseline } from "@/lib/period";

export function BaselineSelect({ value }: { value: Baseline }) {
  const t = useTranslations("insights");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Shows the new choice right away instead of snapping back during the server round-trip.
  const [shown, setShown] = useOptimistic(value);

  function change(next: Baseline) {
    const query = new URLSearchParams(params.toString());
    if (next === "prev") query.delete("vs");
    else query.set("vs", next);
    startTransition(() => {
      setShown(next);
      router.push(`${pathname}?${query.toString()}`);
    });
  }

  return (
    <label className="flex items-center gap-2 text-[12.5px]">
      <span className="text-muted-foreground">{t("compareTo")}</span>
      <NativeSelect
        size="sm"
        data-slot="insights-baseline"
        aria-busy={pending}
        value={shown}
        onChange={(e) => change(e.target.value as Baseline)}
      >
        {BASELINES.map((b) => (
          <option key={b} value={b}>
            {t(`baseline.${b}`)}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
