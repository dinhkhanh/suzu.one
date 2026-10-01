import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import type { DayRule, Weekday } from "@/modules/attendance/engine/calendar";
import { canAssignSchedule, canManageAttendanceConfig, canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { listAssignments, listSchedules } from "@/modules/attendance/schedules";
import { AssignmentForm, RowAction, ScheduleForm } from "@/modules/attendance/ui/settings-forms";
import { getPersonTargets } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { unitChoices, unitPathsOf } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { configOptions } from "../options";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("workSchedules");

export default async function SchedulesSettingsPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenAttendanceSettings(user.principal)) notFound();
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
      <TableCard>
        <TableCardHeader title={t("schedules.title")} count={schedules.length || null} />
        <List>
          {schedules.length === 0 ? <ListEmpty>{t("schedules.empty")}</ListEmpty> : null}
          {schedules.map((schedule) => (
            <ListItem key={schedule.id} className="block">
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
            </ListItem>
          ))}
        </List>
        {options.entities.length > 0 || options.canGroup ? (
          <TableAddRow label={t("schedules.add")}>
            <ScheduleForm {...options} />
          </TableAddRow>
        ) : null}
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("assignments.title")} count={assignments.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("assignments.scope")}</TableHead>
              <TableHead kind="select">{t("assignments.schedule")}</TableHead>
              <TableHead kind="date">{t("assignments.from")}</TableHead>
              <TableHead kind="date">{t("assignments.until")}</TableHead>
              <TableHead kind="text">{t("assignments.note")}</TableHead>
              <TableHead kind="status">{t("assignments.status")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.length === 0 ? <TableEmpty>{t("assignments.empty")}</TableEmpty> : null}
            {assignments.map((row) => {
              const state = row.validTo && row.validTo < today ? "ended" : row.validFrom > today ? "upcoming" : "active";
              const who = row.scope === "person" ? row.personName : row.scope === "department" ? `${row.departmentName} · ${row.entityName ?? t("everyEntity")}` : row.entityName;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">{t(`assignments.scopes.${row.scope}`)}</Badge>
                      <span className="font-medium">{who}</span>
                    </span>
                  </TableCell>
                  <TableCell>{row.scheduleName}</TableCell>
                  <TableCell>{day(row.validFrom)}</TableCell>
                  <TableCell>{row.validTo ? day(row.validTo) : "…"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.note ?? ""}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`assignments.state.${state}`)}</Badge>
                  </TableCell>
                  <TableCell kind="actions">{canAssignSchedule(user.principal, { ...row, unitPath: (row.departmentId ? unitPaths.get(row.departmentId) : null) ?? [] }, row.personId ? (personTargets.get(row.personId) ?? null) : null) ? <RowAction action="removeAssignment" id={row.id} label={t("remove")} confirm={t("removeConfirm")} /> : null}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TableAddRow label={t("assignments.add")} open={assignments.length === 0}>
          <AssignmentForm
            schedules={schedules.filter((schedule) => schedule.isActive).map((schedule) => ({ id: schedule.id, name: schedule.name }))}
            entities={options.entities}
            departments={departments}
            people={people.map((person) => ({ id: person.id, name: person.fullName }))}
            today={today}
          />
        </TableAddRow>
      </TableCard>
    </div>
  );
}
