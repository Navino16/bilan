// Bar growing from a centre axis: increases (more spent) right, decreases left.
export function DivergingBar({ value, max }: { value: number; max: number }) {
  const width = max ? (Math.abs(value) / max) * 50 : 0;
  return (
    <div className="bg-muted relative h-2 rounded">
      <div
        className="absolute inset-y-0 rounded opacity-85"
        style={{
          [value > 0 ? "left" : "right"]: "50%",
          width: `${width}%`,
          background: value > 0 ? "var(--expense)" : "var(--income)",
        }}
      />
      <div aria-hidden className="bg-muted-foreground absolute -inset-y-0.5 left-1/2 w-px" />
    </div>
  );
}
