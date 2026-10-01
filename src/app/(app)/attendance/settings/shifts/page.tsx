import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { canManageAttendanceConfig, canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { listRoster, listShifts } from "@/modules/attendance/schedules";
import { RosterForm, ShiftForm } from "@/modules/attendance/ui/settings-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { matchesReach, permissionReach } from "@/modules/platform/rbac/policy";
import { configOptions } from "../options";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("shifts");

export default async function ShiftsSettingsPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.settings");
  const format = await getFormatter();
  const today = todayInVietnam();
  const [shifts, everyRoster, options, people] = await Promise.all([listShifts(), listRoster(addDays(today, -7), addDays(today, 30)), configOptions(user.principal), listPersonNames()]);
  // HR sees the roster of the people whose attendance they manage.
  const reach = permissionReach(user.principal, "attendance:manage");
  const roster = everyRoster.filter((row) => matchesReach(reach, row));

  return (
    <div className="flex flex-col gap-8">
      <TableCard>
        <TableCardHeader title={t("shifts.title")} count={shifts.length || null} />
        <List>
          {shifts.length === 0 ? <ListEmpty>{t("shifts.empty")}</ListEmpty> : null}
          {shifts.map((shift) => (
            <ListItem key={shift.id} className="block">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{shift.code}</Badge>
                  <span className="font-medium">{shift.name}</span>
                  <span className="text-muted-foreground">{shift.segments.map((segment) => `${segment.start}–${segment.end}`).join(" · ")}</span>
                  <span className="text-xs text-muted-foreground">{shift.entityName ?? t("everyEntity")}</span>
                  {shift.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                </summary>
                {canManageAttendanceConfig(user.principal, shift.entityId) ? (
                  <div className="mt-4">
                    <ShiftForm shift={{ id: shift.id, entityId: shift.entityId, code: shift.code, name: shift.name, segments: shift.segments, breakMinutes: shift.breakMinutes, isActive: shift.isActive }} {...options} />
                  </div>
                ) : null}
              </details>
            </ListItem>
          ))}
        </List>
        {options.entities.length > 0 || options.canGroup ? (
          <TableAddRow label={t("shifts.add")}>
            <ShiftForm {...options} />
          </TableAddRow>
        ) : null}
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("roster.title")} count={roster.length || null} description={t("roster.hint")} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("calendar.date")}</TableHead>
              <TableHead kind="person">{t("assignments.person")}</TableHead>
              <TableHead kind="select">{t("roster.shift")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roster.length === 0 ? <TableEmpty>{t("roster.empty")}</TableEmpty> : null}
            {roster.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{format.dateTime(new Date(`${row.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</TableCell>
                <TableCell className="font-medium">{row.personName}</TableCell>
                <TableCell className="text-muted-foreground">{row.shiftCode ? `${row.shiftCode} · ${row.shiftName}` : t("roster.off")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("roster.set")} open={roster.length === 0}>
          <RosterForm people={people.map((person) => ({ id: person.id, name: person.fullName }))} shifts={shifts.filter((shift) => shift.isActive).map((shift) => ({ id: shift.id, name: `${shift.code} · ${shift.name}` }))} today={today} />
        </TableAddRow>
      </TableCard>
    </div>
  );
}
