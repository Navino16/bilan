import { Badge } from "@/components/ui/badge";

export function StatusBadge({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return <Badge variant="outline">{children}</Badge>;
  return (
    <Badge
      className="border-transparent"
      style={{ color: "var(--income)", background: "var(--income-bg)" }}
    >
      {children}
    </Badge>
  );
}
