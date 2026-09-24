"use client";
// Recording what the client decided (FR-PJM-51): clients have no accounts, so the account person
// records the decision on a version — how it came (email, Zalo, a meeting…), who decided on the
// client's side, what they said — with evidence: a screenshot or file, or a link. On a phone it is
// three taps from Today: the decision, the photo, save (FR-PJM-37).
import { Camera, Check, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { beginEvidenceUploadAction, completeEvidenceUploadAction, decideStageAction, recordClientDecisionAction } from "../delivery-actions";
import { CLIENT_CHANNELS, STAGE_DECISIONS, type StageDecision } from "../engine/delivery";
import { DeliveryError, errorKeyOf, type Result } from "./delivery-shared";

/** Where the decision goes: the client stage a version waits at, or any version. */
export type DecisionTarget = { kind: "stage"; taskId: string } | { kind: "version"; taskId: string; deliverableId: string };

const textareaClass = "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

async function sendDecision(target: DecisionTarget, input: Record<string, unknown>): Promise<Result> {
  return target.kind === "stage" ? decideStageAction({ taskId: target.taskId, ...input }) : recordClientDecisionAction({ deliverableId: target.deliverableId, ...input });
}

/** Uploads the evidence to the task and answers with its file id. */
async function uploadEvidence(taskId: string, file: File): Promise<{ ok: true; fileId: string } | { ok: false; errorKey: string }> {
  const result = await uploadThroughSignedUrl(file, (meta) => beginEvidenceUploadAction({ taskId, ...meta }), (fileId) => completeEvidenceUploadAction({ fileId }));
  return result.ok ? { ok: true, fileId: result.data.id } : result;
}

/** The full form: on the task page, for the client stage or any version. */
export function ClientDecisionForm({ target, version, clientName, files, today, onDone }: { target: DecisionTarget; version: number; clientName: string | null; files: { id: string; fileName: string }[]; today: string; onDone?: () => void }) {
  const t = useTranslations("work.clientDecision");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [decision, setDecision] = useState<StageDecision>("approved");
  const [evidence, setEvidence] = useState<"upload" | "file" | "link">("upload");

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        startTransition(async () => {
          let evidenceFileId = evidence === "file" ? String(data.get("evidenceFileId") ?? "") : "";
          const upload = data.get("evidenceUpload");
          if (evidence === "upload") {
            if (!(upload instanceof File) || upload.size === 0) {
              setErrorKey("client_evidence_required");
              return;
            }
            const stored = await uploadEvidence(target.taskId, upload);
            if (!stored.ok) {
              setErrorKey(stored.errorKey);
              return;
            }
            evidenceFileId = stored.fileId;
          }
          const result = await sendDecision(target, { decision, comment: data.get("comment"), channel: data.get("channel"), decidedByName: data.get("decidedByName"), decidedOn: data.get("decidedOn"), evidenceFileId, evidenceUrl: evidence === "link" ? data.get("evidenceUrl") : "" });
          setErrorKey(errorKeyOf(result));
          if (result.ok) {
            form.reset();
            onDone?.();
            router.refresh();
          }
        });
      }}
    >
      <p className="text-sm font-medium">{t("title", { version })}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("decision")}>
        {STAGE_DECISIONS.map((value) => (
          <Button key={value} type="button" size="sm" variant={decision === value ? (value === "changes_required" ? "destructive" : "default") : "outline"} role="radio" aria-checked={decision === value} onClick={() => setDecision(value)}>
            {t(`decisions.${value}`)}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`cd-on-${version}`}>{t("decidedOn")}</Label>
          <Input id={`cd-on-${version}`} name="decidedOn" type="date" required defaultValue={today} max={today} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`cd-channel-${version}`}>{t("channel")}</Label>
          <Select id={`cd-channel-${version}`} name="channel" defaultValue="zalo">
            {CLIENT_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {t(`channels.${channel}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`cd-by-${version}`}>{t("decidedBy")}</Label>
          <Input id={`cd-by-${version}`} name="decidedByName" maxLength={120} placeholder={clientName ?? t("decidedByPlaceholder")} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`cd-comment-${version}`}>{t("comment")}</Label>
        <textarea id={`cd-comment-${version}`} name="comment" maxLength={4000} required={decision !== "approved"} placeholder={t(decision === "approved" ? "commentOptional" : "commentRequired")} className={textareaClass} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("evidence")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["upload", ...(files.length ? ["file" as const] : []), "link"] as const).map((kind) => (
            <Button key={kind} type="button" size="xs" variant={evidence === kind ? "secondary" : "ghost"} onClick={() => setEvidence(kind)}>
              {t(`evidenceKinds.${kind}`)}
            </Button>
          ))}
        </div>
        {evidence === "upload" ? (
          <Input name="evidenceUpload" type="file" accept="image/*,.pdf" aria-label={t("evidenceKinds.upload")} />
        ) : evidence === "file" ? (
          <Select name="evidenceFileId" aria-label={t("evidenceKinds.file")} defaultValue={files.at(-1)?.id}>
            {files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.fileName}
              </option>
            ))}
          </Select>
        ) : (
          <Input name="evidenceUrl" type="url" required placeholder="https://mail.google.com/…" aria-label={t("evidenceKinds.link")} />
        )}
        <p className="text-xs text-muted-foreground">{t("evidenceHint")}</p>
      </fieldset>
      <DeliveryError errorKey={errorKey} />
      <Button type="submit" size="sm" className="w-fit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
      {decision !== "changes_required" ? <p className="text-xs text-muted-foreground">{t("freezeHint")}</p> : null}
    </form>
  );
}

/**
 * Today's quick action: tap the decision, take the photo of the client's message, and — for an
 * approval — it is saved as the photo arrives. Changes ask for one line of what the client said.
 */
export function ClientDecisionQuick({ target, version }: { target: DecisionTarget; version: number }) {
  const t = useTranslations("work.clientDecision");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [decision, setDecision] = useState<StageDecision | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [link, setLink] = useState(false);
  const [done, setDone] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const save = (chosen: StageDecision, evidence: { file: File } | { url: string }, comment: string) =>
    startTransition(async () => {
      let evidenceFileId = "";
      if ("file" in evidence) {
        const stored = await uploadEvidence(target.taskId, evidence.file);
        if (!stored.ok) {
          setErrorKey(stored.errorKey);
          return;
        }
        evidenceFileId = stored.fileId;
      }
      const result = await sendDecision(target, { decision: chosen, comment, evidenceFileId, evidenceUrl: "url" in evidence ? evidence.url : "" });
      setErrorKey(errorKeyOf(result));
      if (result.ok) {
        setDone(true);
        router.refresh();
      }
    });

  if (done)
    return (
      <p className="flex items-center gap-1 text-sm text-success">
        <Check className="size-4" aria-hidden /> {t("recorded")}
      </p>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {STAGE_DECISIONS.map((value) => (
          <Button key={value} type="button" size="sm" disabled={pending} variant={decision === value ? (value === "changes_required" ? "destructive" : "default") : "outline"} onClick={() => setDecision(value)}>
            {t(`decisions.${value}`)}
          </Button>
        ))}
      </div>
      {decision ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const url = String(data.get("evidenceUrl") ?? "");
            if (!photo && !url) {
              setErrorKey("client_evidence_required");
              return;
            }
            save(decision, photo ? { file: photo } : { url }, String(data.get("comment") ?? ""));
          }}
        >
          <input
            ref={picker}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={t("takePhoto")}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setPhoto(file);
              // An approval needs nothing else: saved as soon as the photo is there.
              if (file && decision === "approved") save(decision, { file }, "");
            }}
          />
          {decision !== "approved" ? <Input name="comment" required maxLength={4000} placeholder={t("commentRequired")} aria-label={t("comment")} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant={photo ? "secondary" : "default"} disabled={pending} onClick={() => picker.current?.click()}>
              <Camera aria-hidden /> {photo ? t("photoTaken") : t("takePhoto")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLink(!link)}>
              <Link2 aria-hidden /> {t("evidenceKinds.link")}
            </Button>
            {decision !== "approved" || link ? (
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? t("saving") : t("save")}
              </Button>
            ) : null}
          </div>
          {link ? <Input name="evidenceUrl" type="url" placeholder="https://…" aria-label={t("evidenceKinds.link")} /> : null}
          <p className="text-xs text-muted-foreground">{t("quickHint", { version })}</p>
        </form>
      ) : null}
      <DeliveryError errorKey={errorKey} />
    </div>
  );
}
