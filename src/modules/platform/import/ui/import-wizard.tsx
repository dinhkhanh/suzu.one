"use client";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action";
import type { StagedImport } from "../service";

type Props = {
  title: string;
  /** The starter CSV (headers + one example row), built on the server from the import's columns. */
  template?: { fileName: string; csv: string };
  /** File types offered by the picker; default spreadsheets. */
  accept?: string;
  /** Fields posted with the file (which device the log came from). */
  children?: ReactNode;
  stageAction: (input: unknown) => Promise<ActionResult<StagedImport>>;
  commitAction: (input: unknown) => Promise<ActionResult<Record<string, number>>>;
};

/** Upload → see exactly what will be written and every problem → confirm. Nothing is saved before the last step. */
export function ImportWizard({ title, template, accept = ".xlsx,.csv", children, stageAction, commitAction }: Props) {
  const t = useTranslations("imports");
  const [pending, startTransition] = useTransition();
  const [staged, setStaged] = useState<StagedImport | null>(null);
  const [done, setDone] = useState<Record<string, number> | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const fail = (result: { error: string; message?: string }) => setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setDone(null);
    setErrorKey(null);
    startTransition(async () => {
      const result = await stageAction(formData);
      if (result.ok) setStaged(result.data);
      else {
        setStaged(null);
        fail(result);
      }
    });
  }

  function commit() {
    if (!staged) return;
    startTransition(async () => {
      const result = await commitAction({ batchId: staged.batchId });
      if (result.ok) {
        setDone(result.data);
        setStaged(null);
      } else fail(result);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {template ? (
          <a className="text-sm underline" download={template.fileName} href={`data:text/csv;charset=utf-8,${encodeURIComponent(template.csv)}`}>
            {t("template")}
          </a>
        ) : null}
      </div>

      <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
        {children}
        <input type="file" name="file" required accept={accept} className="text-sm" aria-label={t("file")} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && !staged ? t("checking") : t("check")}
        </Button>
      </form>

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
      {done ? <p className="text-sm">{t("done", { summary: Object.entries(done).map(([key, value]) => `${t.has(`counts.${key}`) ? t(`counts.${key}`) : key}: ${value}`).join(" · ") })}</p> : null}

      {staged ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            {t("summary", { rows: staged.rowCount, problems: staged.problemCount })}
            {staged.warningCount > 0 ? ` · ${t("warnings", { count: staged.warningCount })}` : ""}
          </p>

          {staged.problems.length > 0 ? (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-3 text-sm">
              {staged.problems.map((problem, index) => (
                <li key={index} className={problem.code === "column_unknown" ? "text-muted-foreground" : problem.severity === "warning" ? "text-amber-700 dark:text-amber-400" : "text-destructive"}>
                  {t("problemAt", { row: problem.row })}
                  {problem.column ? ` · ${problem.column}` : ""}: {t.has(`problems.${problem.code}`) ? t(`problems.${problem.code}`) : problem.code}
                  {problem.detail ? ` — ${problem.detail}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          {staged.preview.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  {staged.headers.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {staged.preview.map((row) => (
                  <TableRow key={row.row}>
                    <TableCell className="text-muted-foreground">{row.row}</TableCell>
                    {row.cells.map((cell, index) => (
                      <TableCell key={index}>{cell || "—"}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          {staged.rowCount > staged.preview.length ? <p className="text-xs text-muted-foreground">{t("previewLimit", { shown: staged.preview.length, rows: staged.rowCount })}</p> : null}

          <div>
            {staged.status === "ready" ? (
              <Button type="button" onClick={commit} disabled={pending}>
                {t("commit", { rows: staged.rowCount })}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t("fixAndRetry")}</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
