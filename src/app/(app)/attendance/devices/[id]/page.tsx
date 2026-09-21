import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { exportUnmappedAction } from "@/modules/attendance/device-actions";
import { getDevice, listUnmapped, listUserMap } from "@/modules/attendance/devices";
import { canManageDevices } from "@/modules/attendance/policy";
import { BulkMapForm, MapUserForm, UnmapButton } from "@/modules/attendance/ui/device-forms";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Device users" };

// Whose ID is whose on one clock, and the log lines still waiting for an owner.
export default async function DeviceUsersPage({ params }: PageProps<"/attendance/devices/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const device = await getDevice(id);
  if (!device || !canManageDevices(user.principal, device.entityId)) notFound();
  const t = await getTranslations("attendance.devices");
  const format = await getFormatter();
  const [map, unmapped, facts] = await Promise.all([listUserMap(id), listUnmapped(id), listEmploymentFacts({ entityIds: [device.entityId] })]);
  const people = facts
    .filter((fact) => fact.status !== "offboarded" && can(user.principal, "attendance:manage", fact))
    .map((fact) => ({ id: fact.personId, name: `${fact.fullName}${fact.employeeCode ? ` · ${fact.employeeCode}` : ""}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const when = (at: Date) => format.dateTime(at, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

  return (
    <div className="flex flex-col gap-8">
      <h2>{device.name}</h2>

      {unmapped.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("map.unmappedTitle", { count: unmapped.length })}</h3>
            <ExportButton action={exportUnmappedAction} input={{ deviceId: id }} label={t("map.export")} failedLabel={t("errors.generic")} truncatedLabel={t("map.exportTruncated")} />
          </div>
          <p className="text-sm text-muted-foreground">{t("map.unmappedHint")}</p>
          <ul className="flex flex-col divide-y">
            {unmapped.map((row) => (
              <li key={row.deviceUserId} className="flex flex-wrap items-end justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-mono font-medium">{row.deviceUserId}</span> · {t("map.lines", { count: row.lines })} · {when(row.firstAt)} → {when(row.lastAt)}
                </span>
                <MapUserForm deviceId={id} deviceUserId={row.deviceUserId} people={people} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{t("map.title", { count: map.length })}</h3>
        {map.length === 0 ? <p className="text-sm text-muted-foreground">{t("map.empty")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {map.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-2 text-sm">
              <span>
                <span className="inline-block w-16 font-mono font-medium">{row.deviceUserId}</span>
                {row.fullName}
                {row.employeeCode ? <span className="text-muted-foreground"> · {row.employeeCode}</span> : null}
              </span>
              <UnmapButton id={row.id} label={t("map.remove")} confirm={t("map.removeConfirm")} />
            </li>
          ))}
        </ul>
        <MapUserForm deviceId={id} people={people} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{t("map.bulkTitle")}</h3>
        <BulkMapForm deviceId={id} />
      </section>
    </div>
  );
}
