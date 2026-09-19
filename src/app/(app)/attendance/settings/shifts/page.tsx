import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { addDays, todayInVietnam } from "@/lib/dates";
import { canManageAttendanceConfig } from "@/modules/attendance/policy";
import { listRoster, listShifts } from "@/modules/attendance/schedules";
import { RosterForm, ShiftForm } from "@/modules/attendance/ui/settings-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { matchesReach, permissionReach } from "@/modules/platform/rbac/policy";
import { configOptions } from "../options";

export const metadata: Metadata = { title: "Shifts" };

export default async function ShiftsSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations("attendance.settings");
  const format = await getFormatter();
  const today = todayInVietnam();
  const [shifts, everyRoster, options, people] = await Promise.all([listShifts(), listRoster(addDays(today, -7), addDays(today, 30)), configOptions(user.principal), listPersonNames()]);
  // HR sees the roster of the people whose attendance they manage.
  const reach = permissionReach(user.principal, "attendance:manage");
  const roster = everyRoster.filter((row) => matchesReach(reach, row));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("shifts.title")}</h2>
        {shifts.length === 0 ? <p className="text-sm text-muted-foreground">{t("shifts.empty")}</p> : null}
        <ul className="flex flex-col gap-3">
          {shifts.map((shift) => (
            <li key={shift.id} className="rounded-xl border p-4">
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
            </li>
          ))}
        </ul>
        {options.entities.length > 0 || options.canGroup ? (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("shifts.add")}</summary>
            <div className="mt-4">
              <ShiftForm {...options} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("roster.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("roster.hint")}</p>
        {roster.length === 0 ? <p className="text-sm text-muted-foreground">{t("roster.empty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {roster.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 p-2 text-sm">
              <span className="w-36">{format.dateTime(new Date(`${row.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric" })}</span>
              <span className="font-medium">{row.personName}</span>
              <span className="text-muted-foreground">{row.shiftCode ? `${row.shiftCode} · ${row.shiftName}` : t("roster.off")}</span>
            </li>
          ))}
        </ul>
        <RosterForm people={people.map((person) => ({ id: person.id, name: person.fullName }))} shifts={shifts.filter((shift) => shift.isActive).map((shift) => ({ id: shift.id, name: `${shift.code} · ${shift.name}` }))} today={today} />
      </section>
    </div>
  );
}
