"use client";
// The account side of the client's review link (D24, FR-PJM-51a): make one, see what has become of
// the ones already out there, copy the URL **once**, revoke.
//
// The one piece of interface design that matters here is the copy: the token exists in this
// response and nowhere else — not in the row, not in the audit log, not in a second request — so
// the panel says so plainly and keeps it on screen until the person navigates away. Losing it costs
// a new link, which is the safe direction and the reason it is built that way.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
  createdByName: string | null;
  createdAt: string;
  decision: { decision: string; decidedByName: string; comment: string | null; at: string } | null;
  canRevoke: boolean;
};

export type PreviewVersion = { id: string; version: number; frozen: boolean };

const textareaClass = "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export function PreviewLinkPanel({ taskId, links, versions, canManage }: { taskId: string; links: PreviewLinkItem[]; versions: PreviewVersion[]; canManage: boolean }) {
  const t = useTranslations("work.preview");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
  const create = (input: Record<string, unknown>) =>
    startTransition(async () => {
      const result = await createPreviewLinkAction({ taskId, ...input });
      setErrorKey(errorKeyOf(result));
      if (!result.ok) return;
      setFresh({ url: `${window.location.origin}${result.data.path}`, expiresAt: result.data.expiresAt });
      setCopied(false);
      setOpen(false);
      router.refresh();
    });

  if (!canManage && links.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {t("title")}
        {links.some((link) => link.state === "active" || link.state === "viewed") ? <Badge variant="secondary">{t("live")}</Badge> : null}
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

      {links.length ? (
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {links.map((link) => (
            <li key={link.id} className="flex flex-col gap-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge dot variant={statusTone(link.state)}>{t(`states.${link.state}`)}</Badge>
                <span className="font-medium">{link.label ?? t("noLabel")}</span>
                <span className="font-mono text-xs">{link.version ? `v${link.version}` : t("currentVersion")}</span>
                {!link.allowDecision ? <span className="text-xs text-muted-foreground">{t("viewOnly")}</span> : null}
                {link.state === "active" || link.state === "viewed" ? (
                  link.canRevoke ? (
                    <Button type="button" size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => window.confirm(t("revokeConfirm")) && run(() => revokePreviewLinkAction({ linkId: link.id }))}>
                      {t("revoke")}
                    </Button>
                  ) : null
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("meta", { name: link.createdByName ?? "—", created: day(link.createdAt), expires: day(link.expiresAt) })}
                {" · "}
                {link.viewCount ? t("views", { count: link.viewCount, last: link.lastViewedAt ? when(link.lastViewedAt) : "—" }) : t("noViews")}
              </p>
              {link.decision ? (
                <p className="text-sm">
                  {t("decided", { decision: t(`decisions.${link.decision.decision}` as "decisions.approved"), name: link.decision.decidedByName || "—", at: when(link.decision.at) })}
                  {link.decision.comment ? <span className="block whitespace-pre-wrap text-muted-foreground">{link.decision.comment}</span> : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <DeliveryError errorKey={errorKey} />

      {canManage ? (
        open ? (
          <form
            className="flex flex-col gap-3 rounded-xl border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              create({
                deliverableId: data.get("deliverableId"),
                label: data.get("label"),
                message: data.get("message"),
                allowDecision: data.get("allowDecision") ?? false,
                days: data.get("days"),
              });
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
              <textarea id="preview-message" name="message" rows={3} maxLength={PREVIEW_MESSAGE_MAX} className={textareaClass} placeholder={t("messagePlaceholder")} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="allowDecision" defaultChecked className="mt-0.5 size-4" />
              {t("allowDecision")}
            </label>
            <p className="text-xs text-muted-foreground">{t("privacyNote")}</p>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {t("create")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="secondary" className="self-start" onClick={() => setOpen(true)} disabled={versions.length === 0}>
            {versions.length === 0 ? t("noVersionYet") : t("new")}
          </Button>
        )
      ) : null}
    </section>
  );
}
