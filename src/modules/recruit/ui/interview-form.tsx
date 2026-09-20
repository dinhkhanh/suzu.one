"use client";
// Booking an interview, and moving one that is already booked.
//
// The one thing worth reading here is how the time is sent. A `datetime-local` input yields
// "2026-09-24T09:30" with **no zone at all**, and handing that to the server means the server's
// zone decides what it meant — which on a machine running in UTC is seven hours away from what the
// recruiter typed. So the instant is built here, in the browser, where the typed time genuinely is
// local, and what crosses the wire is an ISO string with a zone on it.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { INTERVIEW_KINDS, INTERVIEW_MODES } from "../enums";
import { rescheduleInterviewAction, scheduleInterviewAction } from "../interview-actions";

export type InterviewerOption = { personId: string; fullName: string };

/** "2026-09-24" + "09:30" → the instant that is, in the reader's own zone. */
function instantOf(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const at = new Date(`${date}T${time}`);
  return Number.isNaN(at.getTime()) ? null : at;
}

const DURATIONS = [30, 45, 60, 90, 120];

function TimeFields({ date, time, minutes, onChange }: { date: string; time: string; minutes: number; onChange: (next: { date?: string; time?: string; minutes?: number }) => void }) {
  const t = useTranslations("recruit.interview");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="interview-date">{t("date")}</Label>
        <Input id="interview-date" type="date" value={date} onChange={(event) => onChange({ date: event.target.value })} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="interview-time">{t("time")}</Label>
        <Input id="interview-time" type="time" value={time} onChange={(event) => onChange({ time: event.target.value })} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="interview-minutes">{t("duration")}</Label>
        <Select id="interview-minutes" value={String(minutes)} onChange={(event) => onChange({ minutes: Number(event.target.value) })}>
          {DURATIONS.map((option) => (
            <option key={option} value={option}>
              {t("minutes", { count: option })}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function Interviewers({ options, selected, onToggle }: { options: InterviewerOption[]; selected: string[]; onToggle: (personId: string) => void }) {
  const t = useTranslations("recruit.interview");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t("interviewers")}</legend>
      <p className="text-xs text-muted-foreground">{t("interviewersHint")}</p>
      <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.personId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="interviewerPersonIds[]" value={option.personId} checked={selected.includes(option.personId)} onChange={() => onToggle(option.personId)} />
            <span>{option.fullName}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ScheduleInterview({ applicationId, stages, options }: { applicationId: string; stages: { id: string; name: string }[]; options: InterviewerOption[] }) {
  const t = useTranslations("recruit.interview");
  const router = useRouter();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [minutes, setMinutes] = useState(60);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const start = instantOf(date, time);
  const form = useActionForm(scheduleInterviewAction, {
    extra: { applicationId, startAt: start?.toISOString() ?? "", endAt: start ? new Date(start.getTime() + minutes * 60_000).toISOString() : "" },
    onSuccess: () => {
      setOpen(false);
      setSelected([]);
      router.refresh();
    },
  });

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("schedule")}
      </Button>
    );
  }

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">{t("schedule")}</h3>
      <FieldErrors value={form.fieldErrors}>
        <Field name="title" label={t("title")}>
          <Input id="interview-title" name="title" required maxLength={200} defaultValue={t("defaultTitle")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="kind" label={t("kind")}>
            <Select id="interview-kind" name="kind" defaultValue="hiring_manager">
              {INTERVIEW_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="mode" label={t("mode")}>
            <Select id="interview-mode" name="mode" defaultValue="onsite">
              {INTERVIEW_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`modes.${mode}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <TimeFields
          date={date}
          time={time}
          minutes={minutes}
          onChange={(next) => {
            if (next.date !== undefined) setDate(next.date);
            if (next.time !== undefined) setTime(next.time);
            if (next.minutes !== undefined) setMinutes(next.minutes);
          }}
        />
        <Field name="stageId" label={t("stage")}>
          <Select id="interview-stage" name="stageId" defaultValue="">
            <option value="">—</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="location" label={t("location")}>
          <Input id="interview-location" name="location" maxLength={300} />
        </Field>
        {/* No integration is configured, so a meeting link is typed rather than minted. */}
        <Field name="meetingUrl" label={t("meetingUrl")}>
          <Input id="interview-meeting" name="meetingUrl" type="url" maxLength={500} placeholder="https://" />
        </Field>
        <Field name="notesForCandidate" label={t("notesForCandidate")}>
          <Input id="interview-notes" name="notesForCandidate" maxLength={2000} />
        </Field>
      </FieldErrors>
      <Interviewers options={options} selected={selected} onToggle={(personId) => setSelected((current) => (current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]))} />
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={form.pending || !start || selected.length === 0}>
          {t("schedule")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancelForm")}
        </Button>
      </div>
    </form>
  );
}

export function RescheduleInterview({
  interviewId,
  options,
  current,
}: {
  interviewId: string;
  options: InterviewerOption[];
  current: { date: string; time: string; minutes: number; location: string | null; meetingUrl: string | null; interviewerPersonIds: string[] };
}) {
  const t = useTranslations("recruit.interview");
  const router = useRouter();
  const [date, setDate] = useState(current.date);
  const [time, setTime] = useState(current.time);
  const [minutes, setMinutes] = useState(current.minutes);
  const [selected, setSelected] = useState<string[]>(current.interviewerPersonIds);

  const start = instantOf(date, time);
  const form = useActionForm(rescheduleInterviewAction, {
    extra: { interviewId, startAt: start?.toISOString() ?? "", endAt: start ? new Date(start.getTime() + minutes * 60_000).toISOString() : "" },
    onSuccess: () => router.refresh(),
  });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">{t("reschedule")}</h3>
      <FieldErrors value={form.fieldErrors}>
        <TimeFields
          date={date}
          time={time}
          minutes={minutes}
          onChange={(next) => {
            if (next.date !== undefined) setDate(next.date);
            if (next.time !== undefined) setTime(next.time);
            if (next.minutes !== undefined) setMinutes(next.minutes);
          }}
        />
        <Field name="location" label={t("location")}>
          <Input id="reschedule-location" name="location" maxLength={300} defaultValue={current.location ?? ""} />
        </Field>
        <Field name="meetingUrl" label={t("meetingUrl")}>
          <Input id="reschedule-meeting" name="meetingUrl" type="url" maxLength={500} defaultValue={current.meetingUrl ?? ""} />
        </Field>
      </FieldErrors>
      <Interviewers options={options} selected={selected} onToggle={(personId) => setSelected((c) => (c.includes(personId) ? c.filter((id) => id !== personId) : [...c, personId]))} />
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <Button type="submit" size="sm" disabled={form.pending || !start || selected.length === 0}>
        {t("reschedule")}
      </Button>
    </form>
  );
}
