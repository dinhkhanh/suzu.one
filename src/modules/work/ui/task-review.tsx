"use client";
import { Lock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FileLink } from "@/modules/platform/files/ui/signed-upload";
import { openTaskFileAction, updateTaskAction } from "../actions";
import { decideStageAction } from "../delivery-actions";
import { type MediaKind, mediaKindOf, STAGE_DECISIONS } from "../engine/delivery";
import { decideReviewAction, submitDeliverableAction } from "../review-actions";
import { ClientDecisionForm } from "./client-decision";
import { CompareVersions, type MediaVersion, PinBoard, type PinItem } from "./visual-feedback";

export type ReviewDecisionItem = { id: string; stageName: string | null; decision: string; comment: string | null; isClient: boolean; decidedByName: string | null; createdAt: string; client: { channel: string; decidedByName: string; decidedOn: string; evidenceUrl?: string | null; evidenceFileId?: string | null } | null; evidenceFileName: string | null };

export type ReviewDeliverable = {
  id: string;
  version: number;
  kind: string;
  fileId: string | null;
  fileName: string | null;
  contentType: string | null;
  url: string | null;
  note: string | null;
  submittedAt: string;
  submittedByName: string | null;
  decision: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionComment: string | null;
  chainId: string | null;
  stageIndex: number;
  stageReviewerName: string | null;
  stageDueAt: string | null;
  frozenAt: string | null;
  stages: string[];
  clientStageIndex: number | null;
  decisions: ReviewDecisionItem[];
  pins: PinItem[];
};

type Failure = { ok: boolean; error?: string; message?: string };
const keyOf = (result: Failure) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

/**
 * The review step of a task (FR-WRK-08): hand in a version, decide it, and the whole history below.
 * With a review chain (FR-PJM-50) the waiting version shows its stages and the decision offers
 * "approved with changes"; a client stage — or any version — takes the client's decision with its
 * evidence (FR-PJM-51); images and videos take pinned feedback and compare side by side (FR-PJM-52).
 */
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
  canRecordClient = false,
  canPin = false,
  clientName = null,
  today,
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
  /** May decide what the waiting version waits for: the single step, or the chain's current stage. */
  canDecide: boolean;
  canEdit: boolean;
  /** The account side: records client decisions on any version (FR-PJM-51). */
  canRecordClient?: boolean;
  canPin?: boolean;
  clientName?: string | null;
  today: string;
}) {
  const t = useTranslations("work.review");
  const tChain = useTranslations("work.chains");
  const tClient = useTranslations("work.clientDecision");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [source, setSource] = useState<"file" | "link">(files.length ? "file" : "link");
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [pinsFor, setPinsFor] = useState<string | null>(null);
  const run = (work: () => Promise<Failure>, done?: () => void) =>
    startTransition(async () => {
      const result = await work();
      setErrorKey(keyOf(result));
      if (result.ok) done?.();
      router.refresh();
    });
  const when = (value: string) => format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" });
  if (!canSubmit && !canDecide && deliverables.length === 0 && !canEdit) return null;

  const waiting = deliverables.find((item) => item.decision === "pending");
  const inChain = !!waiting?.chainId && waiting.stages.length > 0;
  const stageIndex = waiting ? Math.min(waiting.stageIndex, Math.max(waiting.stages.length - 1, 0)) : 0;
  const atClientStage = inChain && waiting!.clientStageIndex === stageIndex;
  const mediaVersions: MediaVersion[] = deliverables.flatMap((item) => {
    const media = mediaKindOf(item.contentType);
    return item.fileId && media ? [{ id: item.id, version: item.version, fileId: item.fileId, fileName: item.fileName ?? "", media: media as MediaKind }] : [];
  });

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

      {inChain ? (
        <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={tChain("progress")}>
          {waiting!.stages.map((name, index) => (
            <li key={`${index}:${name}`} className="flex items-center gap-1">
              {index > 0 ? <span className="text-muted-foreground">→</span> : null}
              <Badge variant={index < stageIndex ? "success" : index === stageIndex ? "info" : "outline"}>{name}</Badge>
            </li>
          ))}
          <li className="basis-full pt-1 text-muted-foreground">
            {tChain("waitingOn", { name: waiting!.stageReviewerName ?? "—" })}
            {waiting!.stageDueAt ? ` · ${tChain("dueAt", { when: when(waiting!.stageDueAt) })}` : ""}
          </li>
        </ol>
      ) : null}

      {canDecide && status === "submitted" && waiting && atClientStage ? (
        <ClientDecisionForm target={{ kind: "stage", taskId }} version={waiting.version} clientName={clientName} files={files} today={today} />
      ) : canDecide && status === "submitted" && waiting ? (
        <form
          className="flex flex-col gap-2 rounded-xl border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const decision = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
            const comment = String(new FormData(form).get("comment") ?? "");
            run(() => (inChain ? decideStageAction({ taskId, decision, comment }) : decideReviewAction({ taskId, decision, comment })), () => form.reset());
          }}
        >
          <p className="text-sm font-medium">{inChain ? tChain("decideTitle", { version: waiting.version, stage: waiting.stages[stageIndex] }) : t("decideTitle", { version: waiting.version })}</p>
          <textarea name="comment" rows={3} maxLength={4000} placeholder={t("commentPlaceholder")} aria-label={t("comment")} className="rounded-md border bg-transparent px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            {inChain ? (
              STAGE_DECISIONS.map((decision) => (
                <Button key={decision} type="submit" size="sm" name="decision" value={decision} variant={decision === "approved" ? "default" : "outline"} disabled={pending}>
                  {tChain(`decisions.${decision}`)}
                </Button>
              ))
            ) : (
              <>
                <Button type="submit" size="sm" name="decision" value="approved" disabled={pending}>
                  {t("approve")}
                </Button>
                <Button type="submit" size="sm" variant="outline" name="decision" value="changes_requested" disabled={pending}>
                  {t("requestChanges")}
                </Button>
              </>
            )}
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
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}

      <CompareVersions versions={mediaVersions} />

      {deliverables.length ? (
        <ol className="flex flex-col divide-y rounded-xl border text-sm">
          {deliverables.map((item) => {
            const media = mediaVersions.find((row) => row.id === item.id);
            const openPins = item.pins.filter((pin) => !pin.resolved).length;
            return (
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
                  {item.frozenAt ? (
                    <Badge variant="success" title={tClient("frozenHint")}>
                      <Lock aria-hidden /> {tClient("frozen")}
                    </Badge>
                  ) : null}
                  <Badge variant={item.decision === "changes_requested" ? "destructive" : item.decision === "approved" ? "default" : "outline"}>{t(`decision.${item.decision}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t("submittedBy", { name: item.submittedByName ?? "—", when: when(item.submittedAt) })}</p>
                {item.note ? <p className="text-sm whitespace-pre-wrap">{item.note}</p> : null}
                {item.decisions.length ? (
                  <ul className="flex flex-col gap-1 border-l-2 pl-2">
                    {item.decisions.map((decision) => (
                      <li key={decision.id} className="text-xs">
                        <span className="font-medium">{decision.isClient ? tClient("clientSaid") : (decision.stageName ?? t("title"))}</span>
                        {": "}
                        {tChain(`decisions.${decision.decision}`)}
                        {" · "}
                        {decision.isClient && decision.client ? tClient("recordedAs", { client: decision.client.decidedByName || "—", channel: tClient(`channels.${decision.client.channel}`), date: decision.client.decidedOn.split("-").reverse().join("/"), name: decision.decidedByName ?? "—" }) : `${decision.decidedByName ?? "—"}, ${when(decision.createdAt)}`}
                        {decision.comment ? <span className="block text-sm whitespace-pre-wrap">{decision.comment}</span> : null}
                        {decision.client?.evidenceUrl ? (
                          <a href={decision.client.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow" className="block underline">
                            {tClient("evidenceLink")}
                          </a>
                        ) : decision.client?.evidenceFileId ? (
                          <FileLink fileId={decision.client.evidenceFileId} fileName={decision.evidenceFileName ?? tClient("evidenceFile")} download={openTaskFileAction} onError={setErrorKey} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* A single-step review keeps its decision on the version; a chain's are the rows above. */}
                {!item.chainId && item.decidedAt && item.decidedByName ? <p className="text-xs text-muted-foreground">{t("decidedBy", { name: item.decidedByName, when: when(item.decidedAt) })}</p> : null}
                {!item.chainId && item.decisionComment ? <p className="border-l-2 pl-2 text-sm whitespace-pre-wrap">{item.decisionComment}</p> : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  {media ? (
                    <Button type="button" size="xs" variant="outline" onClick={() => setPinsFor(pinsFor === item.id ? null : item.id)}>
                      {pinsFor === item.id ? tWork("pins.hide") : tWork("pins.open", { count: openPins })}
                    </Button>
                  ) : null}
                  {canRecordClient && !item.frozenAt && item.decision !== "superseded" && !(item.decision === "pending" && atClientStage) ? (
                    <Button type="button" size="xs" variant="ghost" onClick={() => setRecordingFor(recordingFor === item.id ? null : item.id)}>
                      {tClient("record")}
                    </Button>
                  ) : null}
                </div>
                {media && pinsFor === item.id ? <PinBoard version={media} pins={item.pins} canPin={canPin} /> : null}
                {recordingFor === item.id ? <ClientDecisionForm target={{ kind: "version", taskId, deliverableId: item.id }} version={item.version} clientName={clientName} files={files} today={today} onDone={() => setRecordingFor(null)} /> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
