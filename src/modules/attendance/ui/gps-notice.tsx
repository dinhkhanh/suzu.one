"use client";
// The GPS notice of the check-in (NFR-PRV-01, 02): what the key will read from the phone, why, who
// sees it, how long it is kept, and that saying no is allowed — shown before the first check-in
// that would read a position, and again whenever its wording changes. The answer is recorded by
// the privacy module's action, handed in by the page (a module's screen does not import another
// module's actions); the words recorded with it are these same messages (`privacy.gpsNotice`).
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action";
import { ConfirmDialog } from "./confirm";

export type GpsConsentState = "unanswered" | "given" | "declined" | "withdrawn";
export type GpsAnswer = "given" | "declined" | "withdrawn";
/** `answerGpsNoticeAction`, passed down by the page. */
export type AnswerGpsNotice = (input: unknown) => Promise<ActionResult<{ decision: string }>>;
export type GpsNotice = { state: GpsConsentState; version: string; days: number };

/** The notice itself, in a sheet on a phone. "Không đồng ý" is offered only where a check-in can go on without it. */
export function GpsNoticeDialog({ open, onOpenChange, days, pending, onAnswer, declineLabel }: { open: boolean; onOpenChange: (open: boolean) => void; days: number; pending: boolean; onAnswer: (decision: "given" | "declined") => void; declineLabel?: string }) {
  const t = useTranslations("privacy.gpsNotice");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          <li>{t("what")}</li>
          <li>{t("why")}</li>
          <li>{t("who")}</li>
          <li>{t("howLong", { days })}</li>
          <li>{t("choice")}</li>
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => (declineLabel ? onAnswer("declined") : onOpenChange(false))}>
            {declineLabel ?? t("notNow")}
          </Button>
          <Button type="button" disabled={pending} onClick={() => onAnswer("given")}>
            {t("agree")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The answer on the person's own page: where they stand, and the one key that changes it — allow
 * (the notice again, then yes) or withdraw (asked once). Withdrawing is as easy as agreeing.
 */
export function MyGpsConsent({ notice, since, answer }: { notice: GpsNotice; since: string | null; answer: AnswerGpsNotice }) {
  const t = useTranslations("privacy.gpsNotice");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState<"notice" | "withdraw" | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const send = (decision: GpsAnswer) =>
    start(async () => {
      const result = await answer({ decision, version: notice.version, locale });
      setOpen(null);
      setFailed(!result.ok);
      if (result.ok) router.refresh();
    });
  const allowed = notice.state === "given";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{allowed ? t("stateGiven", { date: since ?? "" }) : t(`state.${notice.state}`)}</p>
      <p className="text-sm text-muted-foreground">{t("withoutIt")}</p>
      <div>
        {allowed ? (
          <Button type="button" variant="outline" className="text-destructive" disabled={pending} onClick={() => setOpen("withdraw")}>
            {t("withdraw")}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen("notice")}>
            {t("allow")}
          </Button>
        )}
      </div>
      <GpsNoticeDialog open={open === "notice"} onOpenChange={(value) => setOpen(value ? "notice" : null)} days={notice.days} pending={pending} onAnswer={(decision) => (decision === "given" ? send("given") : setOpen(null))} />
      <ConfirmDialog open={open === "withdraw"} onOpenChange={(value) => setOpen(value ? "withdraw" : null)} question={t("withdrawConfirm")} detail={t("withdrawDetail", { days: notice.days })} confirmLabel={t("withdraw")} destructive pending={pending} onConfirm={() => send("withdrawn")} />
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          {t("failed")}
        </p>
      ) : null}
    </div>
  );
}
