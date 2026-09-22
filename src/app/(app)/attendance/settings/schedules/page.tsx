import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import type { DayRule, Weekday } from "@/modules/attendance/engine/calendar";
import { canAssignSchedule, canManageAttendanceConfig } from "@/modules/attendance/policy";
import { listAssignments, listSchedules } from "@/modules/attendance/schedules";
import { AssignmentForm, RowAction, ScheduleForm } from "@/modules/attendance/ui/settings-forms";
import { getPersonTargets } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { unitChoices, unitPathsOf } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { configOptions } from "../options";

export const metadata: Metadata = { title: "Work schedules" };

export default async function SchedulesSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations("attendance.settings");
  const format = await getFormatter();
  const today = todayInVietnam();
  const [schedules, assignments, options, departments, people] = await Promise.all([listSchedules(), listAssignments(), configOptions(user.principal), unitChoices(), listPersonNames()]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const ruleText = (rule: DayRule) => (rule.type === "working" ? rule.segments.map((segment) => `${segment.start}–${segment.end}`).join(" · ") : t(`schedules.dayTypes.${rule.type}`));
  // Whether the viewer may remove a person's assignment depends on where that person sits.
  const personTargets = await getPersonTargets(assignments.flatMap((row) => (row.personId ? [row.personId] : [])));
  // A unit assignment is judged against that unit's whole chain: a grant above it covers it.
  const unitPaths = await unitPathsOf(assignments.flatMap((row) => (row.departmentId ? [row.departmentId] : [])));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("schedules.title")}</h2>
        {schedules.length === 0 ? <p className="text-sm text-muted-foreground">{t("schedules.empty")}</p> : null}
        <ul className="flex flex-col gap-3">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="rounded-xl border p-4">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{schedule.name}</span>
                  <Badge variant="secondary">{t(`schedules.kinds.${schedule.kind}`)}</Badge>
                  <span className="text-muted-foreground">{schedule.entityName ?? t("everyEntity")}</span>
                  {schedule.isDefault ? <Badge variant="outline">{t("schedules.default")}</Badge> : null}
                  {schedule.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                  <span className="text-xs text-muted-foreground">{([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday) => `${t(`weekdaysShort.${weekday}`)} ${ruleText(schedule.pattern.days[weekday])}`).join(" | ")}</span>
                </summary>
                {canManageAttendanceConfig(user.principal, schedule.entityId) ? (
                  <div className="mt-4">
                    <ScheduleForm schedule={{ id: schedule.id, entityId: schedule.entityId, name: schedule.name, kind: schedule.kind, pattern: schedule.pattern, isDefault: schedule.isDefault, isActive: schedule.isActive }} {...options} />
                  </div>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
        {options.entities.length > 0 || options.canGroup ? (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("schedules.add")}</summary>
            <div className="mt-4">
              <ScheduleForm {...options} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("assignments.title")}</h2>
        {assignments.length === 0 ? <p className="text-sm text-muted-foreground">{t("assignments.empty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {assignments.map((row) => {
            const state = row.validTo && row.validTo < today ? "ended" : row.validFrom > today ? "upcoming" : "active";
            const who = row.scope === "person" ? row.personName : row.scope === "department" ? `${row.departmentName} · ${row.entityName ?? t("everyEntity")}` : row.entityName;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <Badge variant="secondary">{t(`assignments.scopes.${row.scope}`)}</Badge>
                <span className="font-medium">{who}</span>
                <span>→ {row.scheduleName}</span>
                <span className="text-xs text-muted-foreground">
                  {day(row.validFrom)} → {row.validTo ? day(row.validTo) : "…"}
                  {row.note ? ` · ${row.note}` : ""}
                </span>
                <Badge variant="outline" className="ml-auto">
                  {t(`assignments.state.${state}`)}
                </Badge>
                {canAssignSchedule(user.principal, { ...row, unitPath: (row.departmentId ? unitPaths.get(row.departmentId) : null) ?? [] }, row.personId ? (personTargets.get(row.personId) ?? null) : null) ? <RowAction action="removeAssignment" id={row.id} label={t("remove")} confirm={t("removeConfirm")} /> : null}
              </li>
            );
          })}
        </ul>
        <AssignmentForm
          schedules={schedules.filter((schedule) => schedule.isActive).map((schedule) => ({ id: schedule.id, name: schedule.name }))}
          entities={options.entities}
          departments={departments}
          people={people.map((person) => ({ id: person.id, name: person.fullName }))}
          today={today}
        />
      </section>
    </div>
  );
}
