"use client";
import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <TableCard>
      <TableCardHeader
        title={title}
        actions={
          template ? (
            <a className={buttonVariants({ variant: "outline", size: "xs" })} download={template.fileName} href={`data:text/csv;charset=utf-8,${encodeURIComponent(template.csv)}`}>
              <DownloadIcon aria-hidden />
              {t("template")}
            </a>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <form onSubmit={upload} className="toolbar">
          {children}
          <Input type="file" name="file" required accept={accept} aria-label={t("file")} className="w-full md:max-w-sm" />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending && !staged ? t("checking") : t("check")}
          </Button>
        </form>

        {errorKey ? <Alert variant="destructive">{t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}</Alert> : null}
        {done ? <Alert variant="success">{t("done", { summary: Object.entries(done).map(([key, value]) => `${t.has(`counts.${key}`) ? t(`counts.${key}`) : key}: ${value}`).join(" · ") })}</Alert> : null}

        {staged ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              {t("summary", { rows: staged.rowCount, problems: staged.problemCount })}
              {staged.warningCount > 0 ? ` · ${t("warnings", { count: staged.warningCount })}` : ""}
            </p>

            {staged.problems.length > 0 ? (
              <List className="max-h-64 overflow-y-auto">
                {staged.problems.map((problem, index) => (
                  <ListItem key={index} className="min-h-10 gap-2.5 py-1.5 text-[0.8125rem]">
                    <Badge variant={problem.code === "column_unknown" ? "secondary" : problem.severity === "warning" ? "warning" : "destructive"} className="shrink-0 font-mono">
                      {t("problemAt", { row: problem.row })}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      {problem.column ? <span className="font-mono text-xs text-muted-foreground">{problem.column} · </span> : null}
                      {t.has(`problems.${problem.code}`) ? t(`problems.${problem.code}`) : problem.code}
                      {problem.detail ? <span className="text-muted-foreground"> — {problem.detail}</span> : null}
                    </span>
                  </ListItem>
                ))}
              </List>
            ) : null}

            {staged.preview.length > 0 ? (
              <Table numbered={false}>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="number">
                      <span className="sr-only">#</span>
                    </TableHead>
                    {staged.headers.map((header) => (
                      <TableHead key={header} kind="text">
                        {header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staged.preview.map((row) => (
                    <TableRow key={row.row}>
                      <TableCell kind="number" className="text-faint">{row.row}</TableCell>
                      {row.cells.map((cell, index) => (
                        <TableCell key={index}>{cell || <span className="text-faint">—</span>}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
            {staged.rowCount > staged.preview.length ? <p className="text-xs text-muted-foreground">{t("previewLimit", { shown: staged.preview.length, rows: staged.rowCount })}</p> : null}

            <div className="flex justify-end">
              {staged.status === "ready" ? (
                <Button type="button" onClick={commit} disabled={pending} size="lg" className="w-full md:w-auto">
                  {t("commit", { rows: staged.rowCount })}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">{t("fixAndRetry")}</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </TableCard>
  );
}
