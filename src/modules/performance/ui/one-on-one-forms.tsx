"use client";
// 1:1 meeting notes (FR-PRF-04). The private-notes box is only ever rendered for the manager who
// holds the meeting — the page decides that, and the service strips the column as well.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { addOneOnOneActionAction, completeOneOnOneActionAction, createOneOnOneAction, shareOneOnOneAction, updateOneOnOneAction } from "../one-on-one-actions";
import { decideOutcomeAction, raiseOutcomeAction } from "../one-on-one-actions";
import { OUTCOME_TYPES } from "../enums";

const ERRORS = "performance.oneOnOnes.errors";

type Person = { id: string; fullName: string };

export function NewOneOnOneForm({ reports, today }: { reports: Person[]; today: string }) {
  const t = useTranslations("performance.oneOnOnes");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(createOneOnOneAction, { onSuccess: (data) => router.push(`/performance/one-on-ones/${(data as { id: string }).id}`) });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("new")}</h2>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="personId" label={t("person")}>
            <Select id="personId" name="personId" required>
              {reports.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="meetingOn" label={t("meetingOn")}>
            <DatePicker id="meetingOn" name="meetingOn" defaultValue={today} required />
          </Field>
        </div>
        <Field name="agenda" label={t("agenda")}>
          <NoteEditor id="agenda" name="agenda" rows={3} maxLength={4000} />
        </Field>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending || reports.length === 0}>
          {pending ? `${t("new")}…` : t("new")}
        </Button>
      </div>
    </form>
  );
}

export function EditOneOnOneForm({ meeting, seesPrivate }: { meeting: { id: string; meetingOn: string; agenda: string | null; sharedNotes: string | null; privateNotes: string | null }; seesPrivate: boolean }) {
  const t = useTranslations("performance.oneOnOnes");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors, saved } = useActionForm(updateOneOnOneAction, { extra: { meetingId: meeting.id }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldErrors value={fieldErrors}>
        <Field name="meetingOn" label={t("meetingOn")}>
          <DatePicker id="meetingOn" name="meetingOn" defaultValue={meeting.meetingOn} required className="max-w-48" />
        </Field>
        <Field name="agenda" label={t("agenda")}>
          <NoteEditor id="agenda" name="agenda" rows={3} maxLength={4000} defaultValue={meeting.agenda ?? ""} />
        </Field>
        <Field name="sharedNotes" label={t("sharedNotes")}>
          <NoteEditor id="sharedNotes" name="sharedNotes" rows={5} maxLength={8000} defaultValue={meeting.sharedNotes ?? ""} />
        </Field>
        {seesPrivate ? (
          <Field name="privateNotes" label={t("privateNotes")}>
            <>
              <NoteEditor id="privateNotes" name="privateNotes" rows={5} maxLength={8000} defaultValue={meeting.privateNotes ?? ""} />
              <p className="text-xs text-muted-foreground">{t("privateHint")}</p>
            </>
          </Field>
        ) : null}
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? `${t("save")}…` : t("save")}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

export function ShareOneOnOneButton({ meetingId }: { meetingId: string }) {
  const t = useTranslations("performance.oneOnOnes");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(shareOneOnOneAction, { extra: { meetingId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? `${t("share")}…` : t("share")}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

export function AddActionForm({ meetingId, people }: { meetingId: string; people: Person[] }) {
  const t = useTranslations("performance.oneOnOnes.actions");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(addOneOnOneActionAction, {
    extra: { meetingId },
    onSuccess: () => {
      form.current?.reset();
      router.refresh();
    },
  });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("add")}</h2>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem_10rem]">
          <Field name="title" label={t("titleField")}>
            <Input id="title" name="title" maxLength={200} required />
          </Field>
          <Field name="assigneePersonId" label={t("assignee")}>
            <Select id="assigneePersonId" name="assigneePersonId" defaultValue="">
              <option value="">—</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="dueOn" label={t("dueOn")}>
            <DatePicker id="dueOn" name="dueOn" />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? `${t("add")}…` : t("add")}
        </Button>
      </div>
    </form>
  );
}

export function CompleteActionButton({ actionId }: { actionId: string }) {
  const t = useTranslations("performance.oneOnOnes.actions");
  const router = useRouter();
  const { onSubmit, pending } = useActionForm(completeOneOnOneActionAction, { extra: { actionId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit}>
      <button type="submit" disabled={pending} className="text-xs text-muted-foreground hover:underline">
        {t("complete")}
      </button>
    </form>
  );
}

// ── Review outcomes (FR-PRF-06) ─────────────────────────────────────────────────────────────

/**
 * A settled result leads to something. A salary adjustment carries the terms payroll will decide,
 * so it — and its figures — is offered only to somebody who may read the person's compensation
 * (`mayProposeSalary`); the action checks the same rule again.
 */
export function RaiseOutcomeForm({ resultId, mayProposeSalary }: { resultId: string; mayProposeSalary: boolean }) {
  const t = useTranslations("performance.oneOnOnes.outcomes");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(raiseOutcomeAction, {
    extra: { resultId },
    onSuccess: () => {
      form.current?.reset();
      router.refresh();
    },
  });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("title")}</h2>
      {mayProposeSalary ? <p className="text-sm text-muted-foreground">{t("salaryHint")}</p> : null}
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="type" label={t("typeLabel")}>
            <Select id="type" name="type" required>
              {OUTCOME_TYPES.filter((type) => mayProposeSalary || type !== "salary_adjustment").map((type) => (
                <option key={type} value={type}>
                  {t(`type.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          {mayProposeSalary ? (
            <>
              <Field name="validFrom" label={t("validFrom")}>
                <DatePicker id="validFrom" name="validFrom" />
              </Field>
              <Field name="baseSalary" label={t("baseSalary")}>
                <MoneyInput id="baseSalary" name="baseSalary" className="text-right" />
              </Field>
              <Field name="insuranceSalary" label={t("insuranceSalary")}>
                <MoneyInput id="insuranceSalary" name="insuranceSalary" className="text-right" />
              </Field>
            </>
          ) : null}
        </div>
        <Field name="note" label={t("note")}>
          <NoteEditor id="note" name="note" rows={2} maxLength={2000} />
        </Field>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? `${t("raise")}…` : t("raise")}
        </Button>
      </div>
    </form>
  );
}

export function OutcomeDecisionButtons({ outcomeId }: { outcomeId: string }) {
  const t = useTranslations("performance.oneOnOnes.outcomes.status");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(decideOutcomeAction, { extra: { outcomeId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="accept" disabled={pending}>
          {t("accepted")}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="outline" disabled={pending}>
          {t("rejected")}
        </Button>
      </div>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}
