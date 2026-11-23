import { ordinalSegments } from "@/lib/format";

// For dates shown under CSS uppercase: « 1er » keeps its lowercase suffix.
export function OrdinalText({ text }: { text: string }) {
  return (
    <>
      {ordinalSegments(text).map((part, i) =>
        i % 2 ? (
          <span key={i} className="normal-case">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
