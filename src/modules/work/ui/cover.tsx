"use client";
// Leave cover on screen (FR-PJM-44): the person's plan (a cover per item or one for all, and the
// note), the cover's acknowledgement, the hand-back — and the quiet check My work runs for the
// person's own leave.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Note } from "../engine/handoff";
import { acknowledgeCoverAction, checkMyCoverPlansAction, handBackCoverAction, saveCoverPlanAction, submitCoverPlanAction } from "../handoff-actions";
import { HandoffNoteFields, HandoffNoteView, readNote } from "./handoff";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };
export type CoverItemRow = { id: string; itemType: "task" | "review" | "recurrence" | "booking"; label: string; detail: string | null; href: string | null; coverPersonId: string | null; effectiveCoverName: string | null; acknowledgedAt: string | null; handedBackAt: string | null; handoffStatus: string | null };
export type CoverPlanData = { id: string; status: string; personName: string; fromDate: string; toDate: string; defaultCoverPersonId: string | null; defaultCoverName: string | null; note: Note; appliedAt: string | null; items: CoverItemRow[] };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (call: () => Promise<Result>, after?: (result: Result) => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.(result);
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

function ErrorLine({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("work");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
    </p>
  );
}

/** The plan: a draft to fill (for whoever may submit it), or where things stand. */
export function CoverPlanForm({ plan, people, canSubmit, canAcknowledge, canHandBack, selfId }: { plan: CoverPlanData; people: { id: string; fullName: string }[]; canSubmit: boolean; canAcknowledge: boolean; canHandBack: boolean; selfId: string }) {
  const t = useTranslations("work.cover");
  const format = useFormatter();
  const { run, pending, errorKey } = useRun();
  const draft = plan.status === "draft" && canSubmit;
  const choices = people;
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const mineToAcknowledge = plan.items.filter((item) => !item.acknowledgedAt && item.itemType !== "booking" && (item.coverPersonId ?? plan.defaultCoverPersonId) === selfId).length;

  function collect(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      planId: plan.id,
      defaultCoverPersonId: String(data.get("defaultCoverPersonId") ?? ""),
      items: plan.items.filter((item) => item.itemType !== "booking").map((item) => ({ id: item.id, coverPersonId: String(data.get(`cover.${item.id}`) ?? "") })),
      note: readNote(data),
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("absence", { name: plan.personName, from: day(plan.fromDate), to: day(plan.toDate) })}</p>
      {plan.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("nothing")}</p> : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const input = collect(event.currentTarget);
          run(() => submitCoverPlanAction(input));
        }}
      >
        {draft ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default-cover">{t("defaultCover")}</Label>
            <Select id="default-cover" name="defaultCoverPersonId" defaultValue={plan.defaultCoverPersonId ?? ""}>
              <option value="">{t("noDefault")}</option>
              {choices.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t("defaultHint")}</p>
          </div>
        ) : plan.defaultCoverName ? (
          <p className="text-sm">{t("coveredBy", { name: plan.defaultCoverName })}</p>
        ) : null}

        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {plan.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
              <Badge variant="outline">{t(`types.${item.itemType}`)}</Badge>
              <div className="min-w-0 flex-1">
                {item.href ? (
                  <Link href={item.href} className="font-medium hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="font-medium">{item.label}</span>
                )}
                {item.detail ? <p className="text-xs text-muted-foreground">{item.itemType === "task" ? t("due", { date: item.detail }) : item.detail}</p> : null}
              </div>
              {item.itemType === "booking" ? (
                <span className="text-xs text-muted-foreground">{t("bookingInfo")}</span>
              ) : draft ? (
                <Select name={`cover.${item.id}`} aria-label={t("coverFor", { label: item.label })} defaultValue={item.coverPersonId ?? ""} className="w-48">
                  <option value="">{t("useDefault")}</option>
                  {choices.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="flex items-center gap-2 text-xs">
                  {item.effectiveCoverName ?? t("uncovered")}
                  {item.handedBackAt ? <Badge variant="outline">{t("handedBack")}</Badge> : item.acknowledgedAt ? <Badge>{t("acknowledged")}</Badge> : plan.status === "submitted" ? <Badge variant="secondary">{t("waitingAck")}</Badge> : null}
                </span>
              )}
            </li>
          ))}
        </ul>

        {draft ? <HandoffNoteFields defaultValue={plan.note} /> : <HandoffNoteView note={plan.note} />}
        <ErrorLine errorKey={errorKey} />
        {draft ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {t("submit")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={(event) => {
                const input = collect(event.currentTarget.form!);
                run(() => saveCoverPlanAction(input));
              }}>
              {t("saveDraft")}
            </Button>
          </div>
        ) : null}
      </form>

      {plan.status === "submitted" ? (
        <div className="flex flex-wrap gap-2">
          {canAcknowledge && mineToAcknowledge > 0 ? (
            <Button disabled={pending} onClick={() => run(() => acknowledgeCoverAction({ planId: plan.id }))}>
              {t("acknowledge", { count: mineToAcknowledge })}
            </Button>
          ) : null}
          {canHandBack ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (window.confirm(plan.appliedAt ? t("handBackConfirm") : t("withdrawConfirm"))) run(() => handBackCoverAction({ planId: plan.id }));
              }}
            >
              {plan.appliedAt ? t("handBack") : t("withdraw")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The on-demand check (FR-PJM-44): My work asks once per visit whether the person's own leave
 * needs a plan, instead of waiting for the night's job, and shows the draft as soon as it exists.
 */
export function CoverCheck() {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    checkMyCoverPlansAction({}).then((result) => {
      const data = result.ok ? (result.data as { drafted: number; cancelled: number }) : null;
      if (data && (data.drafted > 0 || data.cancelled > 0)) router.refresh();
    });
  }, [router]);
  return null;
}
