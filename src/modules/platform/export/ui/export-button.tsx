"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";
import type { CsvFile } from "../csv";

/**
 * Runs an export action (permission-filtered and audit-logged on the server) and hands the file
 * to the browser. `input` is what the list is currently filtered by, so the file matches the screen.
 */
export function ExportButton({ action, input, label, failedLabel, truncatedLabel }: { action: (input: unknown) => Promise<ActionResult<CsvFile>>; input: unknown; label: string; failedLabel: string; truncatedLabel: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action(input);
            if (!result.ok) return setMessage(failedLabel);
            setMessage(result.data.truncated ? truncatedLabel : null);
            const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
            const link = Object.assign(document.createElement("a"), { href: url, download: result.data.fileName });
            link.click();
            URL.revokeObjectURL(url);
          })
        }
      >
        {label}
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </span>
  );
}
