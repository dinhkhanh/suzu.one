"use client";
import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ActionResult } from "@/lib/action";
import { tableToCsv } from "../csv";
import type { ExportFile, ExportFormat } from "../table";
import { tableToXlsx } from "../xlsx";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The table as the file the person asked for, handed to the browser to save. */
function download(file: ExportFile, format: ExportFormat) {
  const blob = format === "xlsx" ? new Blob([tableToXlsx(file.table, file.fileName) as Uint8Array<ArrayBuffer>], { type: XLSX_TYPE }) : new Blob([tableToCsv(file.table)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: `${file.fileName}.${format}` });
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Runs an export action (permission-filtered and audit-logged on the server) and hands the file
 * to the browser, as Excel or CSV. `input` is what the list is currently filtered by, so the file
 * matches the screen.
 */
export function ExportButton({ action, input, label, failedLabel, truncatedLabel }: { action: (input: unknown) => Promise<ActionResult<ExportFile>>; input: unknown; label: string; failedLabel: string; truncatedLabel: string }) {
  const t = useTranslations("controls");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (format: ExportFormat) =>
    startTransition(async () => {
      const result = await action(input);
      if (!result.ok) return setMessage(failedLabel);
      setMessage(result.data.truncated ? truncatedLabel : null);
      download(result.data, format);
    });
  return (
    <span className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          render={
            <Button type="button" size="sm" variant="outline">
              <DownloadIcon aria-hidden />
              {label}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem onClick={() => run("xlsx")}>{t("exportXlsx")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("csv")}>{t("exportCsv")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </span>
  );
}
