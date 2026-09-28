import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Native <select> styled like <Input> (issue #112 §3): keeps the OS picker on mobile
// and plain FormData submission. `className` sizes the wrapper, the select fills it.
function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn("group/native-select relative has-[select:disabled]:opacity-50", className)}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&>option]:bg-popover [&>option]:text-popover-foreground h-8 w-full min-w-0 appearance-none truncate rounded-lg border bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed aria-invalid:ring-3 data-[size=sm]:h-7 data-[size=sm]:pr-7 data-[size=sm]:pl-2 data-[size=sm]:text-xs md:text-sm md:data-[size=sm]:text-xs"
        {...props}
      />
      <ChevronDownIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 select-none group-has-data-[size=sm]/native-select:right-2 group-has-data-[size=sm]/native-select:size-3.5"
      />
    </div>
  );
}

export { NativeSelect };
