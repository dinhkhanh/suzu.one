"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createScheduleAction, deleteScheduleAction, setScheduleActiveAction, updateScheduleAction } from "../actions";
import { CADENCES, DAYS_OF_WEEK } from "../enums";

type Person = { id: string; name: string };
export type ScheduleDraft = { id: string | null; reportKey: string; name: string; cadence: string; dayOfWeek: number | null; dayOfMonth: number | null; locale: string; recipientPersonIds: string[] };

/** Create or edit a schedule. Which reports are offered was decided on the server, by `canSee`. */
export function ScheduleForm({ draft, reports, people }: { draft: ScheduleDraft; reports: { key: string; label: string }[]; people: Person[] }) {
  const t = useTranslations("reports.schedules");
  const router = useRouter();
  const [cadence, setCadence] = useState(draft.cadence);
  const [recipients, setRecipients] = useState<string[]>(draft.recipientPersonIds);
  const [pick, setPick] = useState("");
  const form = useActionForm(draft.id ? updateScheduleAction : createScheduleAction, {
    extra: { ...(draft.id ? { id: draft.id } : {}), recipientPersonIds: recipients },
    onSuccess: () => router.push("/reports/schedules"),
  });
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? id;

  return (
    <form onSubmit={form.onSubmit} className="flex max-w-2xl flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
        <Field name="name" label={t("name")}>
          <Input id="name" name="name" required maxLength={120} defaultValue={draft.name} />
        </Field>
        <Field name="reportKey" label={t("report")}>
          <Select id="reportKey" name="reportKey" defaultValue={draft.reportKey} required>
            {reports.map((report) => (
              <option key={report.key} value={report.key}>
                {report.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="cadence" label={t("cadence")}>
          <Select id="cadence" name="cadence" value={cadence} onChange={(event) => setCadence(event.target.value)}>
            {CADENCES.map((value) => (
              <option key={value} value={value}>
                {t(`cadences.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        {cadence === "weekly" ? (
          <Field name="dayOfWeek" label={t("dayOfWeek")}>
            <Select id="dayOfWeek" name="dayOfWeek" defaultValue={String(draft.dayOfWeek ?? 1)}>
              {DAYS_OF_WEEK.map((day) => (
                <option key={day} value={day}>
                  {t(`days.${day}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {cadence === "monthly" ? (
          <Field name="dayOfMonth" label={t("dayOfMonth")}>
            <Input id="dayOfMonth" name="dayOfMonth" type="number" min={1} max={31} defaultValue={draft.dayOfMonth ?? 1} />
            <p className="text-xs text-muted-foreground">{t("dayOfMonthHint")}</p>
          </Field>
        ) : null}
        <Field name="locale" label={t("locale")}>
          <Select id="locale" name="locale" defaultValue={draft.locale}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field name="recipientPersonIds" label={t("recipients")}>
          <ul className="flex flex-col gap-1">
            {recipients.map((id) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => setRecipients((current) => current.filter((value) => value !== id))}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={pick} onChange={(event) => setPick(event.target.value)} className="w-auto">
              <option value="">—</option>
              {people
                .filter((person) => !recipients.includes(person.id))
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </Select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (pick) setRecipients((current) => [...current, pick]);
                setPick("");
              }}
            >
              +
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("recipientsHint")}</p>
        </Field>
      </FieldErrors>
      <FormError namespace="reports.schedules.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("save")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

/** Pause, resume or delete one schedule from the list. */
export function ScheduleRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const t = useTranslations("reports.schedules");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run(call: () => Promise<{ ok: boolean }>) {
    setPending(true);
    await call();
    setPending(false);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => run(() => setScheduleActiveAction({ id, isActive: !isActive }))}>
        {isActive ? t("pause") : t("resume")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={pending}
        onClick={() => {
          if (confirm(t("deleteConfirm"))) void run(() => deleteScheduleAction({ id }));
        }}
      >
        {t("delete")}
      </Button>
    </span>
  );
}
