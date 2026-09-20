import type { DiffLine } from "../engine/diff";

/** A line diff of two plain texts: removed lines red, added lines green. */
export function DiffView({ lines }: { lines: readonly DiffLine[] }) {
  return (
    <div className="overflow-x-auto rounded-md border font-mono text-xs">
      {lines.map((line, index) => (
        <div key={index} className={`flex gap-2 px-3 py-0.5 whitespace-pre-wrap ${line.type === "added" ? "bg-emerald-100 dark:bg-emerald-950/60" : line.type === "removed" ? "bg-red-100 dark:bg-red-950/60" : ""}`}>
          <span aria-hidden className="w-3 shrink-0 select-none text-muted-foreground">
            {line.type === "added" ? "+" : line.type === "removed" ? "−" : ""}
          </span>
          <span className="min-w-0 break-words">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
