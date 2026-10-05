"use client";
// The account side of the client's review link (D24, FR-PJM-51a): make one, see what has become of
// the ones already out there, copy the URL **once**, revoke.
//
// The one piece of interface design that matters here is the copy: the token exists in this
// response and nowhere else — not in the row, not in the audit log, not in a second request — so
// the panel says so plainly and keeps it on screen until the person navigates away. Losing it costs
// a new link, which is the safe direction and the reason it is built that way.
//
// `ProjectPreviewLinks` below is the other half (R14): every link of a project that is still out
// there, across its tasks, in one list on the project's page — so what clients are holding can be
// seen, and taken back, without opening each task in turn.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/page";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { draftSaved } from "@/modules/platform/rich-text/ui/drafts";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { PREVIEW_DEFAULT_DAYS, PREVIEW_LABEL_MAX, PREVIEW_MAX_DAYS, PREVIEW_MESSAGE_MAX, PREVIEW_MIN_DAYS, type PreviewState } from "../engine/preview";
import { createPreviewLinkAction, revokePreviewLinkAction } from "../preview-actions";
import { DeliveryError, errorKeyOf, type Result } from "./delivery-shared";

export type PreviewLinkItem = {
  id: string;
  label: string | null;
  message: string | null;
  allowDecision: boolean;
  version: number | null;
  state: PreviewState;
  expiresAt: string;
  viewCount: number;
  lastViewedAt: string | null;
  createdByPersonId?: string | null;
  createdByName: string | null;
  createdAt: string;
  decision: { decision: string; decidedByName: string; comment: string | null; at: string } | null;
  canRevoke: boolean;
};

export type PreviewVersion = { id: string; version: number; frozen: boolean };

const isLive = (state: PreviewState) => state === "active" || state === "viewed";

/**
 * Taking a link back, asked twice: the button opens a small sheet that says what will happen, and
 * the link is revoked from there. A revoked link cannot be brought back — the client needs a new
 * one — so one stray tap in a table must not be enough.
 */
function RevokeButton({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  const t = useTranslations("work.preview");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" size="xs" variant="ghost" disabled={disabled} />}>{t("revoke")}</PopoverTrigger>
      <PopoverContent align="end">
        <PopoverHeader>
          <PopoverTitle>{t("revokeTitle")}</PopoverTitle>
          <PopoverDescription>{t("revokeConfirm")}</PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {t("revoke")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PreviewLinkPanel({ taskId, links, versions, canManage }: { taskId: string; links: PreviewLinkItem[]; versions: PreviewVersion[]; canManage: boolean }) {
  const t = useTranslations("work.preview");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // The add row folds shut once a link is made or the form is cancelled: a new key mounts it closed.
  const [addRow, setAddRow] = useState(0);
  const [fresh, setFresh] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const run = (call: () => Promise<Result>) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(errorKeyOf(result));
      if (result.ok) router.refresh();
    });

  /** Creating is the one call whose answer matters: it carries the only copy of the link. */
  const create = (input: Record<string, unknown>, form: HTMLFormElement) =>
    startTransition(async () => {
      const result = await createPreviewLinkAction({ taskId, ...input });
      setErrorKey(errorKeyOf(result));
      if (!result.ok) return;
      draftSaved(form);
      setFresh({ url: result.data.url, expiresAt: result.data.expiresAt });
      setCopied(false);
      setAddRow((count) => count + 1);
      router.refresh();
    });

  if (!canManage && links.length === 0) return null;
  const revocable = links.some((link) => link.canRevoke && isLive(link.state));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {t("title")}
        {links.some((link) => isLive(link.state)) ? <Badge variant="secondary">{t("live")}</Badge> : null}
      </h2>
      <p className="text-xs text-muted-foreground">{t("explainer")}</p>

      {fresh ? (
        <Alert variant="success">
          <AlertTitle>{t("copyOnce")}</AlertTitle>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Input readOnly value={fresh.url} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.url).then(() => setCopied(true));
              }}
            >
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("expiresOn", { date: day(fresh.expiresAt) })}</p>
        </Alert>
      ) : null}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("label")}</TableHead>
              <TableHead kind="status">{t("columns.state")}</TableHead>
              <TableHead kind="id">{t("version")}</TableHead>
              <TableHead kind="person">{t("columns.createdBy")}</TableHead>
              <TableHead kind="date">{t("columns.created")}</TableHead>
              <TableHead kind="date">{t("columns.expires")}</TableHead>
              <TableHead kind="number">{t("columns.views")}</TableHead>
              <TableHead kind="date">{t("columns.lastViewed")}</TableHead>
              {revocable ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {links.map((link) => (
              <Fragment key={link.id}>
                <TableRow>
                  <TableCell>
                    <span className="font-medium">{link.label ?? t("noLabel")}</span>
                    {!link.allowDecision ? <span className="ml-2 text-xs text-muted-foreground">{t("viewOnly")}</span> : null}
                  </TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(link.state)}>{t(`states.${link.state}`)}</Badge>
                  </TableCell>
                  <TableCell kind="id">{link.version ? `v${link.version}` : t("currentVersion")}</TableCell>
                  <TableCell>{link.createdByName ? <RecordLink kind="person" id={link.createdByPersonId}>{link.createdByName}</RecordLink> : "—"}</TableCell>
                  <TableCell>{day(link.createdAt)}</TableCell>
                  <TableCell>{day(link.expiresAt)}</TableCell>
                  <TableCell kind="number">{link.viewCount}</TableCell>
                  <TableCell className="text-muted-foreground">{link.viewCount ? (link.lastViewedAt ? when(link.lastViewedAt) : "—") : t("noViews")}</TableCell>
                  {revocable ? (
                    <TableCell kind="actions">
                      {isLive(link.state) && link.canRevoke ? <RevokeButton disabled={pending} onConfirm={() => run(() => revokePreviewLinkAction({ linkId: link.id }))} /> : null}
                    </TableCell>
                  ) : null}
                </TableRow>
                {link.decision ? (
                  <TableRow data-unnumbered>
                    <TableCell colSpan={revocable ? 9 : 8} className="h-auto whitespace-normal">
                      {t("decided", { decision: t(`decisions.${link.decision.decision}` as "decisions.approved"), name: link.decision.decidedByName || "—", at: when(link.decision.at) })}
                      {link.decision.comment ? <span className="block whitespace-pre-wrap text-muted-foreground">{link.decision.comment}</span> : null}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
        {canManage ? (
          versions.length === 0 ? (
            <p className="flex h-12 items-center border-t px-3 text-sm text-muted-foreground">{t("noVersionYet")}</p>
          ) : (
            <TableAddRow key={addRow} label={t("new")}>
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  create(
                    {
                      deliverableId: data.get("deliverableId"),
                      label: data.get("label"),
                      message: data.get("message"),
                      allowDecision: data.get("allowDecision") ?? false,
                      days: data.get("days"),
                    },
                    event.currentTarget,
                  );
                }}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="preview-version">{t("version")}</Label>
                    <Select id="preview-version" name="deliverableId" defaultValue="">
                      <option value="">{t("currentVersion")}</option>
                      {versions.map((row) => (
                        <option key={row.id} value={row.id}>
                          v{row.version} {row.frozen ? `· ${t("frozen")}` : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="preview-label">{t("label")}</Label>
                    <Input id="preview-label" name="label" maxLength={PREVIEW_LABEL_MAX} placeholder={t("labelPlaceholder")} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="preview-days">{t("days")}</Label>
                    <Input id="preview-days" name="days" type="number" min={PREVIEW_MIN_DAYS} max={PREVIEW_MAX_DAYS} defaultValue={PREVIEW_DEFAULT_DAYS} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="preview-message">{t("message")}</Label>
                  <NoteEditor id="preview-message" name="message" rows={3} maxLength={PREVIEW_MESSAGE_MAX} placeholder={t("messagePlaceholder")} />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="allowDecision" defaultChecked className="mt-0.5" />
                  {t("allowDecision")}
                </label>
                <p className="text-xs text-muted-foreground">{t("privacyNote")}</p>
                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>
                    {t("create")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setAddRow((count) => count + 1)}>
                    {t("cancel")}
                  </Button>
                </div>
              </form>
            </TableAddRow>
          )
        ) : null}
      </TableCard>

      <DeliveryError errorKey={errorKey} />
    </section>
  );
}

export type ProjectPreviewLinkItem = {
  id: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  label: string | null;
  allowDecision: boolean;
  version: number | null;
  state: PreviewState;
  expiresAt: string;
  viewCount: number;
  createdByPersonId: string | null;
  createdByName: string | null;
  createdAt: string;
  /** What the client answered on it, when they have. */
  decision: string | null;
};

/**
 * A project's links that are still out there, across all its tasks (R14): which work, which
 * version, who it went to, who made it, when it runs out, whether the client has looked or
 * answered — and revoke, for the ones a client can still open. Shown to the people who may make a
 * link on this project (`canSeeProjectPreviewLinks`), each of whom may revoke every row. Links are
 * made on the task, where the version is; this list only watches them and takes them back.
 */
export function ProjectPreviewLinks({ links }: { links: ProjectPreviewLinkItem[] }) {
  const t = useTranslations("work.preview");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const revoke = (linkId: string) =>
    startTransition(async () => {
      const result: Result = await revokePreviewLinkAction({ linkId });
      setErrorKey(errorKeyOf(result));
      if (result.ok) router.refresh();
    });
  const revocable = links.some((link) => isLive(link.state));

  return (
    <Section title={t("project.title")} count={links.length || undefined} description={t("project.explainer")}>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("project.task")}</TableHead>
              <TableHead kind="id">{t("project.version")}</TableHead>
              <TableHead kind="text">{t("label")}</TableHead>
              <TableHead kind="status">{t("columns.state")}</TableHead>
              <TableHead kind="person">{t("columns.createdBy")}</TableHead>
              <TableHead kind="date">{t("columns.created")}</TableHead>
              <TableHead kind="date">{t("columns.expires")}</TableHead>
              <TableHead kind="number">{t("columns.views")}</TableHead>
              {revocable ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.length === 0 ? <TableEmpty>{t("project.none")}</TableEmpty> : null}
            {links.map((link) => (
              <TableRow key={link.id}>
                <TableCell>
                  <RecordLink kind="task" id={link.taskId} className="font-medium">
                    <span className="font-mono text-xs text-muted-foreground">{link.taskKey}</span> {link.taskTitle}
                  </RecordLink>
                </TableCell>
                <TableCell kind="id">{link.version ? `v${link.version}` : "—"}</TableCell>
                <TableCell>
                  {link.label ?? <span className="text-muted-foreground">{t("noLabel")}</span>}
                  {!link.allowDecision ? <span className="ml-2 text-xs text-muted-foreground">{t("viewOnly")}</span> : null}
                </TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(link.state)}>
                    {link.decision && t.has(`decisions.${link.decision}`) ? t(`decisions.${link.decision}` as "decisions.approved") : t(`states.${link.state}`)}
                  </Badge>
                </TableCell>
                <TableCell>{link.createdByName ? <RecordLink kind="person" id={link.createdByPersonId}>{link.createdByName}</RecordLink> : "—"}</TableCell>
                <TableCell>{day(link.createdAt)}</TableCell>
                <TableCell>{day(link.expiresAt)}</TableCell>
                <TableCell kind="number">{link.viewCount}</TableCell>
                {revocable ? <TableCell kind="actions">{isLive(link.state) ? <RevokeButton disabled={pending} onConfirm={() => revoke(link.id)} /> : null}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <DeliveryError errorKey={errorKey} />
    </Section>
  );
}
