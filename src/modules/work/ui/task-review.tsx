"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FileLink } from "@/modules/platform/files/ui/signed-upload";
import { openTaskFileAction, updateTaskAction } from "../actions";
import { decideReviewAction, submitDeliverableAction } from "../review-actions";

export type ReviewDeliverable = { id: string; version: number; kind: string; fileId: string | null; fileName: string | null; url: string | null; note: string | null; submittedAt: string; submittedByName: string | null; decision: string; decidedAt: string | null; decidedByName: string | null; decisionComment: string | null };

type Failure = { ok: boolean; error?: string; message?: string };
const keyOf = (result: Failure) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

/** The review step of a task (FR-WRK-08): hand in a version, decide it, and the whole history below. */
export function TaskReview({
  taskId,
  status,
  rounds,
  reviewerPersonId,
  deliverables,
  files,
  people,
  canSubmit,
  canDecide,
  canEdit,
}: {
  taskId: string;
  status: string;
  rounds: number;
  reviewerPersonId: string | null;
  deliverables: ReviewDeliverable[];
  /** The task's files: a deliverable is one of them, or a link. */
  files: { id: string; fileName: string }[];
  people: { id: string; fullName: string }[];
  canSubmit: boolean;
  canDecide: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("work.review");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [source, setSource] = useState<"file" | "link">(files.length ? "file" : "link");
  const run = (work: () => Promise<Failure>, done?: () => void) =>
    startTransition(async () => {
      const result = await work();
      setErrorKey(keyOf(result));
      if (result.ok) done?.();
      router.refresh();
    });
  const when = (value: string) => format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" });
  if (!canSubmit && !canDecide && deliverables.length === 0 && !canEdit) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
        {t("title")}
        {status !== "none" ? <Badge variant={status === "changes_requested" ? "destructive" : status === "approved" ? "default" : "secondary"}>{t(`status.${status}`)}</Badge> : null}
        {rounds > 0 ? <Badge variant="outline">{t("rounds", { count: rounds })}</Badge> : null}
      </h2>

      {canEdit ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("reviewer")}
          <Select className="w-56" aria-label={t("reviewer")} defaultValue={reviewerPersonId ?? ""} disabled={pending} onChange={(event) => run(() => updateTaskAction({ taskId, reviewerPersonId: event.target.value }))}>
            <option value="">{t("reviewerDefault")}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {canDecide && status === "submitted" ? (
        <form
          className="flex flex-col gap-2 rounded-xl border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const decision = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
            const comment = String(new FormData(form).get("comment") ?? "");
            run(() => decideReviewAction({ taskId, decision, comment }), () => form.reset());
          }}
        >
          <p className="text-sm font-medium">{t("decideTitle", { version: deliverables[0]?.version ?? 1 })}</p>
          <textarea name="comment" rows={3} maxLength={4000} placeholder={t("commentPlaceholder")} aria-label={t("comment")} className="rounded-md border bg-transparent px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" name="decision" value="approved" disabled={pending}>
              {t("approve")}
            </Button>
            <Button type="submit" size="sm" variant="outline" name="decision" value="changes_requested" disabled={pending}>
              {t("requestChanges")}
            </Button>
          </div>
        </form>
      ) : null}

      {canSubmit ? (
        <form
          className="flex flex-col gap-2 rounded-xl border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            run(() => submitDeliverableAction({ taskId, fileId: source === "file" ? data.get("fileId") : "", url: source === "link" ? data.get("url") : "", note: data.get("note") }), () => form.reset());
          }}
        >
          <p className="text-sm font-medium">{t(status === "submitted" ? "submitAgainTitle" : "submitTitle", { version: (deliverables[0]?.version ?? 0) + 1 })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label={t("source")} className="w-32" value={source} onChange={(event) => setSource(event.target.value as "file" | "link")}>
              <option value="file">{t("sourceFile")}</option>
              <option value="link">{t("sourceLink")}</option>
            </Select>
            {source === "file" ? (
              files.length ? (
                <Select name="fileId" aria-label={t("sourceFile")} className="min-w-0 flex-1" defaultValue={files.at(-1)?.id}>
                  {files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.fileName}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm text-muted-foreground">{t("noFiles")}</span>
              )
            ) : (
              <Input name="url" type="url" placeholder="https://drive.google.com/…" aria-label={t("sourceLink")} className="min-w-0 flex-1" required />
            )}
          </div>
          <Input name="note" maxLength={2000} placeholder={t("notePlaceholder")} aria-label={t("note")} />
          <Button type="submit" size="sm" className="w-fit" disabled={pending || (source === "file" && files.length === 0)}>
            {t("submit")}
          </Button>
        </form>
      ) : null}

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}

      {deliverables.length ? (
        <ol className="flex flex-col divide-y rounded-xl border text-sm">
          {deliverables.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">v{item.version}</span>
                <span className="min-w-0 flex-1 truncate">
                  {item.kind === "file" && item.fileId ? (
                    <FileLink fileId={item.fileId} fileName={item.fileName ?? t("sourceFile")} download={openTaskFileAction} onError={setErrorKey} />
                  ) : item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                      {item.url}
                    </a>
                  ) : null}
                </span>
                <Badge variant={item.decision === "changes_requested" ? "destructive" : item.decision === "approved" ? "default" : "outline"}>{t(`decision.${item.decision}`)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{t("submittedBy", { name: item.submittedByName ?? "—", when: when(item.submittedAt) })}</p>
              {item.note ? <p className="text-sm whitespace-pre-wrap">{item.note}</p> : null}
              {item.decidedAt && item.decidedByName ? <p className="text-xs text-muted-foreground">{t("decidedBy", { name: item.decidedByName, when: when(item.decidedAt) })}</p> : null}
              {item.decisionComment ? <p className="border-l-2 pl-2 text-sm whitespace-pre-wrap">{item.decisionComment}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
