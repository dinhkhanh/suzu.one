"use client";
// Filing an expense claim (FR-REQ-03): the type's own form, plus the lines it is made of.
//
// The lines run the *same* pure engine the action runs, so a claim that cannot be filed says why
// before the round trip, and the total on screen is the total that will be approved and paid —
// there is no second arithmetic anywhere.
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpenseLine, expenseProblems, expenseTotal, MAX_DESCRIPTION, MAX_LINES, MAX_PROJECT_TAG } from "../engine/expense";
import type { FormDefinition, FormValues } from "../engine/form";
import { beginRequestAttachmentAction, completeRequestAttachmentAction } from "../file-actions";
import { RequestForm } from "./request-form";

type Draft = Omit<ExpenseLine, "amount"> & { amount: string };

const blank = (today: string): Draft => ({ lineDate: today, category: "transport", description: "", amount: "", receiptFileId: null, projectTag: null });

/** What the engine will see: a blank amount is 0, which it refuses — it never becomes a silent zero. */
const toLine = (draft: Draft): ExpenseLine => ({ ...draft, amount: Number.parseInt(draft.amount.replaceAll(/[^\d-]/g, ""), 10) || 0 });

export function ExpenseClaimForm({
  form,
  today,
  submit,
  extra,
  initialValues,
  initialLines,
  submitLabel,
}: {
  form: FormDefinition;
  today: string;
  submit: (input: unknown) => Promise<ActionResult<{ requestId: string }>>;
  extra: Record<string, unknown>;
  initialValues?: FormValues;
  initialLines?: ExpenseLine[];
  submitLabel: string;
}) {
  const t = useTranslations("requests.expense");
  const locale = useLocale();
  const [lines, setLines] = useState<Draft[]>(() => (initialLines?.length ? initialLines.map((line) => ({ ...line, amount: String(line.amount) })) : [blank(today)]));
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const parsed = lines.map(toLine);
  const problems = expenseProblems(parsed, { today });
  const total = expenseTotal(parsed);
  const money = new Intl.NumberFormat(locale === "en" ? "en-US" : "vi-VN");

  const set = (index: number, patch: Partial<Draft>) => setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  const problemOf = (index: number) => problems.find((problem) => problem.line === index)?.problem ?? null;

  function upload(index: number, file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(index);
    startTransition(async () => {
      const result = await uploadThroughSignedUrl(
        file,
        (meta) => beginRequestAttachmentAction(meta) as Promise<ActionResult<{ fileId: string; uploadUrl: string; contentType: string }>>,
        (fileId) => completeRequestAttachmentAction({ fileId }) as Promise<ActionResult<{ fileId: string; fileName: string }>>,
      );
      setUploading(null);
      if (!result.ok) return setUploadError(result.errorKey);
      setFileNames((current) => ({ ...current, [result.data.fileId]: result.data.fileName }));
      set(index, { receiptFileId: result.data.fileId });
    });
  }

  const claimProblem = problems.find((problem) => problem.line === -1)?.problem ?? null;

  return (
    <RequestForm
      form={form}
      submit={submit}
      extra={{ ...extra, lines: parsed }}
      initialValues={initialValues}
      people={[]}
      entities={[]}
      submitLabel={submitLabel}
      addendumInvalid={problems.length > 0}
      addendum={
        <section className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">{t("linesTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("receiptRule")}</p>
          </div>

          <ul className="flex flex-col gap-3">
            {lines.map((line, index) => {
              const problem = problemOf(index);
              return (
                <li key={index} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[9rem_10rem_1fr_9rem]">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("lineDate")}
                    <Input type="date" max={today} value={line.lineDate} onChange={(event) => set(index, { lineDate: event.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("category")}
                    <Select value={line.category} onChange={(event) => set(index, { category: event.target.value as ExpenseCategory })}>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {t(`categories.${category}` as "categories.other")}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("description")}
                    <Input value={line.description} maxLength={MAX_DESCRIPTION} onChange={(event) => set(index, { description: event.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("amount")}
                    <Input inputMode="numeric" value={line.amount} placeholder="0" onChange={(event) => set(index, { amount: event.target.value })} />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
                    {t("projectTag")}
                    <Input value={line.projectTag ?? ""} maxLength={MAX_PROJECT_TAG} onChange={(event) => set(index, { projectTag: event.target.value || null })} />
                  </label>
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
                    {t("receipt")}
                    {line.receiptFileId ? (
                      <span className="flex items-center gap-2 text-sm text-foreground">
                        {fileNames[line.receiptFileId] ?? line.receiptFileId}
                        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => set(index, { receiptFileId: null })}>
                          {t("removeReceipt")}
                        </Button>
                      </span>
                    ) : (
                      <input
                        type="file"
                        aria-label={t("addReceipt")}
                        disabled={uploading === index}
                        className="text-sm file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-sm"
                        onChange={(event) => {
                          upload(index, event.currentTarget.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 sm:col-span-4">
                    {problem ? (
                      <p role="alert" className="text-xs text-destructive">
                        {t(`problems.${problem}` as "problems.no_lines")}
                      </p>
                    ) : (
                      <span />
                    )}
                    {lines.length > 1 ? (
                      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setLines((current) => current.filter((_, at) => at !== index))}>
                        {t("removeLine")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {uploadError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("uploadFailed")}
            </p>
          ) : null}
          {claimProblem ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`problems.${claimProblem}` as "problems.no_lines")}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" disabled={lines.length >= MAX_LINES} onClick={() => setLines((current) => [...current, blank(today)])}>
              {t("addLine")}
            </Button>
            <p className="text-sm font-medium">{t("total", { amount: money.format(total) })}</p>
          </div>
        </section>
      }
    />
  );
}
