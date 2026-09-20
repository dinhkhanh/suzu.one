"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import type { DayRule, SchedulePattern, Weekday } from "../engine/calendar";
import { assignScheduleAction, confirmCalendarDayAction, deleteCalendarDayAction, removeAssignmentAction, saveCalendarDayAction, saveScheduleAction, saveShiftAction, setRosterAction } from "../settings-actions";

type Option = { id: string; name: string };
const ERRORS = "attendance.settings.errors";

function EntitySelect({ entities, canGroup, label, groupLabel, defaultValue, disabled }: { entities: Option[]; canGroup: boolean; label: string; groupLabel: string; defaultValue?: string | null; disabled?: boolean }) {
  return (
    <Field name="entityId" label={label}>
      <Select id="entityId" name="entityId" defaultValue={defaultValue ?? (canGroup ? "" : entities[0]?.id)} disabled={disabled}>
        {canGroup ? <option value="">{groupLabel}</option> : null}
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function CalendarDayForm({ entities, canGroup }: { entities: Option[]; canGroup: boolean }) {
  const t = useTranslations("attendance.settings");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveCalendarDayAction);
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("calendar.add")}</h2>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="date" label={t("calendar.date")}>
            <Input id="date" name="date" type="date" required />
          </Field>
          <Field name="kind" label={t("calendar.kind")}>
            <Select id="kind" name="kind" defaultValue="public_holiday">
              {(["public_holiday", "compensatory_off", "company_off", "working_override"] as const).map((kind) => (
                <option key={kind} value={kind}>
                  {t(`calendar.kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="name" label={t("calendar.name")}>
            <Input id="name" name="name" required maxLength={120} />
          </Field>
          <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} />
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

const ROW_ACTIONS = { confirmDay: confirmCalendarDayAction, deleteDay: deleteCalendarDayAction, removeAssignment: removeAssignmentAction } as const;

/** A one-click row action (confirm a seeded holiday, remove a row). */
export function RowAction({ action, id, label, confirm }: { action: keyof typeof ROW_ACTIONS; id: string; label: string; confirm?: string }) {
  const { onSubmit, pending, errorKey } = useActionForm(ROW_ACTIONS[action] as (input: unknown) => Promise<ActionResult<unknown>>, { extra: { id } });
  return (
    <form
      onSubmit={(event) => {
        if (!confirm || window.confirm(confirm)) onSubmit(event);
        else event.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {label}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

export type ShiftFormValue = { id: string; entityId: string | null; code: string; name: string; segments: { start: string; end: string }[]; breakMinutes: number; isActive: boolean };

export function ShiftForm({ shift, entities, canGroup }: { shift?: ShiftFormValue; entities: Option[]; canGroup: boolean }) {
  const t = useTranslations("attendance.settings");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveShiftAction, { extra: shift ? { id: shift.id, entityId: shift.entityId ?? "" } : {} });
  return (
    <form onSubmit={onSubmit} key={!shift && saved ? "saved" : "open"} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="code" label={t("shifts.code")}>
            <Input id="code" name="code" required maxLength={20} defaultValue={shift?.code} />
          </Field>
          <Field name="name" label={t("shifts.name")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={shift?.name} />
          </Field>
          {shift ? null : <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} />}
          <Field name="breakMinutes" label={t("breakMinutes")}>
            <Input id="breakMinutes" name="breakMinutes" type="number" min={0} max={600} required defaultValue={shift?.breakMinutes ?? 0} />
          </Field>
          <Field name="start" label={t("shifts.start")}>
            <Input id="start" name="start" type="time" required defaultValue={shift?.segments[0]?.start} />
          </Field>
          <Field name="end" label={t("shifts.end")}>
            <Input id="end" name="end" type="time" required defaultValue={shift?.segments[0]?.end} />
          </Field>
          <Field name="start2" label={t("shifts.start2")}>
            <Input id="start2" name="start2" type="time" defaultValue={shift?.segments[1]?.start} />
          </Field>
          <Field name="end2" label={t("shifts.end2")}>
            <Input id="end2" name="end2" type="time" defaultValue={shift?.segments[1]?.end} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" className="size-4" defaultChecked={shift?.isActive ?? true} />
          {t("active")}
        </label>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("shifts.overnightHint")}</p>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      {saved ? <p className="text-sm text-muted-foreground">{t("saved")}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

// ── The weekly pattern ──────────────────────────────────────────────────────────────────────

type EditableDay = { type: DayRule["type"]; start: string; end: string; start2: string; end2: string; breakMinutes: number; requiredMinutes: number; creditMinutes: number };
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as Weekday[];

const toEditable = (rule: DayRule | undefined): EditableDay => ({
  type: rule?.type ?? "off",
  start: rule?.type === "working" ? (rule.segments[0]?.start ?? "08:30") : "08:30",
  end: rule?.type === "working" ? (rule.segments[0]?.end ?? "17:30") : "17:30",
  start2: rule?.type === "working" ? (rule.segments[1]?.start ?? "") : "",
  end2: rule?.type === "working" ? (rule.segments[1]?.end ?? "") : "",
  breakMinutes: rule?.type === "working" ? rule.breakMinutes : 60,
  requiredMinutes: rule?.type === "working" ? (rule.requiredMinutes ?? 480) : 480,
  creditMinutes: rule?.type === "untracked" ? rule.creditMinutes : 480,
});

const toRule = (day: EditableDay, flexible: boolean): DayRule =>
  day.type === "off"
    ? { type: "off" }
    : day.type === "untracked"
      ? { type: "untracked", creditMinutes: day.creditMinutes }
      : { type: "working", segments: [{ start: day.start, end: day.end }, ...(day.start2 && day.end2 ? [{ start: day.start2, end: day.end2 }] : [])], breakMinutes: day.breakMinutes, ...(flexible ? { flexible: true, requiredMinutes: day.requiredMinutes } : {}) };

export type ScheduleFormValue = { id: string; entityId: string | null; name: string; kind: "fixed" | "flexible" | "shift"; pattern: SchedulePattern; isDefault: boolean; isActive: boolean };

const OFFICE_WEEK: SchedulePattern = {
  days: { 1: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 }, 2: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 }, 3: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 }, 4: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 }, 5: { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 }, 6: { type: "untracked", creditMinutes: 480 }, 7: { type: "off" } },
};

export function ScheduleForm({ schedule, entities, canGroup }: { schedule?: ScheduleFormValue; entities: Option[]; canGroup: boolean }) {
  const t = useTranslations("attendance.settings");
  const pattern = schedule?.pattern ?? OFFICE_WEEK;
  const saturdayAlternate = pattern.alternate?.find((entry) => entry.weekday === 6);
  const [kind, setKind] = useState(schedule?.kind ?? "fixed");
  const [days, setDays] = useState<EditableDay[]>(() => WEEKDAYS.map((weekday) => toEditable(pattern.days[weekday])));
  const [alternate, setAlternate] = useState(!!saturdayAlternate);
  const [anchor, setAnchor] = useState(saturdayAlternate?.anchor ?? "");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const patch = (index: number, change: Partial<EditableDay>) => setDays((current) => current.map((day, position) => (position === index ? { ...day, ...change } : day)));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const built: SchedulePattern = {
      days: Object.fromEntries(WEEKDAYS.map((weekday, index) => [weekday, toRule(days[index], kind === "flexible")])) as SchedulePattern["days"],
      // Other alternate rules (none can be made here) are kept as they were.
      alternate: [...(pattern.alternate ?? []).filter((entry) => entry.weekday !== 6), ...(alternate && anchor ? [{ weekday: 6 as Weekday, anchor, rule: { type: "off" as const } }] : [])],
    };
    setSaved(false);
    startTransition(async () => {
      const result = await saveScheduleAction({ id: schedule?.id ?? "", entityId: schedule ? (schedule.entityId ?? "") : form.get("entityId"), name: form.get("name"), kind, pattern: JSON.stringify(built), isDefault: form.get("isDefault") === "on", isActive: form.get("isActive") === "on" });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      setSaved(result.ok);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="name" label={t("schedules.name")}>
          <Input id="name" name="name" required maxLength={120} defaultValue={schedule?.name} />
        </Field>
        <Field name="kind" label={t("schedules.kind")}>
          <Select id="kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            {(["fixed", "flexible", "shift"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`schedules.kinds.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        {schedule ? null : <EntitySelect entities={entities} canGroup={canGroup} label={t("appliesTo")} groupLabel={t("everyEntity")} />}
      </div>
      <p className="text-xs text-muted-foreground">{t(`schedules.kindHints.${kind}`)}</p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {WEEKDAYS.map((weekday, index) => {
          const day = days[index];
          return (
            <li key={weekday} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <span className="w-24 font-medium">{t(`weekdays.${weekday}`)}</span>
              <Select className="w-auto" aria-label={t("schedules.dayType")} value={day.type} onChange={(event) => patch(index, { type: event.target.value as DayRule["type"] })}>
                {(["working", "untracked", "off"] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`schedules.dayTypes.${type}`)}
                  </option>
                ))}
              </Select>
              {day.type === "working" ? (
                <>
                  <Input className="w-28" type="time" aria-label={t("shifts.start")} value={day.start} onChange={(event) => patch(index, { start: event.target.value })} />
                  <Input className="w-28" type="time" aria-label={t("shifts.end")} value={day.end} onChange={(event) => patch(index, { end: event.target.value })} />
                  <Input className="w-28" type="time" aria-label={t("shifts.start2")} value={day.start2} onChange={(event) => patch(index, { start2: event.target.value })} />
                  <Input className="w-28" type="time" aria-label={t("shifts.end2")} value={day.end2} onChange={(event) => patch(index, { end2: event.target.value })} />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    {t("breakMinutes")}
                    <Input className="w-20" type="number" min={0} max={600} value={day.breakMinutes} onChange={(event) => patch(index, { breakMinutes: Number(event.target.value) })} />
                  </label>
                  {kind === "flexible" ? (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      {t("schedules.requiredMinutes")}
                      <Input className="w-20" type="number" min={1} max={1440} value={day.requiredMinutes} onChange={(event) => patch(index, { requiredMinutes: Number(event.target.value) })} />
                    </label>
                  ) : null}
                </>
              ) : null}
              {day.type === "untracked" ? (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  {t("schedules.creditMinutes")}
                  <Input className="w-20" type="number" min={0} max={1440} value={day.creditMinutes} onChange={(event) => patch(index, { creditMinutes: Number(event.target.value) })} />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={alternate} onChange={(event) => setAlternate(event.target.checked)} />
          {t("schedules.alternateSaturday")}
        </label>
        {alternate ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("schedules.anchor")}
            <Input className="w-40" type="date" required value={anchor} onChange={(event) => setAnchor(event.target.value)} />
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isActive" className="size-4" defaultChecked={schedule?.isActive ?? true} />
          {t("active")}
        </label>
        {canGroup && !(schedule && schedule.entityId) ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isDefault" className="size-4" defaultChecked={schedule?.isDefault ?? false} />
            {t("schedules.isDefault")}
          </label>
        ) : null}
      </div>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      {saved ? <p className="text-sm text-muted-foreground">{t("saved")}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

export function AssignmentForm({ schedules, entities, departments, people, today }: { schedules: Option[]; entities: Option[]; departments: Option[]; people: Option[]; today: string }) {
  const t = useTranslations("attendance.settings");
  const [scope, setScope] = useState<"entity" | "department" | "person">("entity");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(assignScheduleAction);
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("assignments.add")}</h2>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="scope" label={t("assignments.scope")}>
            <Select id="scope" name="scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
              {(["entity", "department", "person"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`assignments.scopes.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          {scope === "department" ? (
            <Field name="departmentId" label={t("assignments.department")}>
              <Select id="departmentId" name="departmentId" required>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {scope !== "person" ? (
            <Field name="entityId" label={t("assignments.entity")}>
              <Select id="entityId" name="entityId" defaultValue={scope === "entity" ? entities[0]?.id : ""}>
                {scope === "department" ? <option value="">{t("everyEntity")}</option> : null}
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field name="personId" label={t("assignments.person")}>
              <Select id="personId" name="personId" required>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field name="scheduleId" label={t("assignments.schedule")}>
            <Select id="scheduleId" name="scheduleId" required>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="validFrom" label={t("assignments.from")}>
            <Input id="validFrom" name="validFrom" type="date" required defaultValue={today} />
          </Field>
          <Field name="validTo" label={t("assignments.until")}>
            <Input id="validTo" name="validTo" type="date" />
          </Field>
        </div>
        <Field name="note" label={t("assignments.note")}>
          <Input id="note" name="note" maxLength={300} />
        </Field>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("assignments.hint")}</p>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("assignments.submit")}
        </Button>
      </div>
    </form>
  );
}

export function RosterForm({ people, shifts, today }: { people: Option[]; shifts: Option[]; today: string }) {
  const t = useTranslations("attendance.settings");
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(setRosterAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("roster.set")}</h2>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="personId" label={t("assignments.person")}>
            <Select id="personId" name="personId" required>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="shiftId" label={t("roster.shift")}>
            <Select id="shiftId" name="shiftId" required>
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name}
                </option>
              ))}
              <option value="off">{t("roster.off")}</option>
              <option value="clear">{t("roster.clear")}</option>
            </Select>
          </Field>
          <Field name="from" label={t("assignments.from")}>
            <Input id="from" name="from" type="date" required defaultValue={today} />
          </Field>
          <Field name="to" label={t("assignments.until")}>
            <Input id="to" name="to" type="date" required defaultValue={today} />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      {saved ? <p className="text-sm text-muted-foreground">{t("saved")}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
