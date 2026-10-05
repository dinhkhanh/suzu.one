import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportUnmappedAction } from "@/modules/attendance/device-actions";
import { getDevice, listUnmapped, listUserMap, servedEntityIds } from "@/modules/attendance/devices";
import { canManageDevices } from "@/modules/attendance/policy";
import { BulkMapForm, MapUserForm, PushTokenPanel, UnmapButton } from "@/modules/attendance/ui/device-forms";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";
import { appOrigin } from "@/lib/site";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("deviceUsers");

// Whose ID is whose on one clock, and the log lines still waiting for an owner.
export default async function DeviceUsersPage({ params }: PageProps<"/attendance/devices/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const device = await getDevice(id);
  if (!device || !canManageDevices(user.principal, device.entityId)) notFound();
  const t = await getTranslations("attendance.devices");
  const format = await getFormatter();
  const served = await servedEntityIds(device);
  const [map, unmapped, facts, entities] = await Promise.all([listUserMap(id), listUnmapped(id), listEmploymentFacts({ entityIds: served }), listEntities()]);
  // A clock serving several entities names each person's, since an employee code is unique only within one.
  const entityName = new Map(served.length > 1 ? entities.map((entity) => [entity.id, entity.shortName]) : []);
  const people = facts
    .filter((fact) => fact.status !== "offboarded" && can(user.principal, "attendance:manage", fact))
    .map((fact) => ({ id: fact.personId, name: [fact.fullName, fact.employeeCode, fact.entityId ? entityName.get(fact.entityId) : null].filter(Boolean).join(" · ") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const when = (at: Date) => format.dateTime(at, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

  return (
    <div className="flex flex-col gap-8">
      <h2>{device.name}</h2>

      {unmapped.length > 0 ? (
        <TableCard className="border-destructive/40">
          <TableCardHeader title={t("map.unmappedTitle", { count: unmapped.length })} description={t("map.unmappedHint")} actions={<ExportButton action={exportUnmappedAction} input={{ deviceId: id }} label={t("map.export")} failedLabel={t("errors.generic")} truncatedLabel={t("map.exportTruncated")} />} />
          <List>
            {unmapped.map((row) => (
              <ListItem key={row.deviceUserId} className="flex-wrap items-end justify-between">
                <span>
                  <span className="font-mono font-medium">{row.deviceUserId}</span> · {t("map.lines", { count: row.lines })} · {when(row.firstAt)} → {when(row.lastAt)}
                </span>
                <MapUserForm deviceId={id} deviceUserId={row.deviceUserId} people={people} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      <TableCard>
        <TableCardHeader title={t("map.title", { count: map.length })} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("map.deviceUserId")}</TableHead>
              <TableHead kind="person">{t("map.person")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {map.length === 0 ? <TableEmpty>{t("map.empty")}</TableEmpty> : null}
            {map.map((row) => (
              <TableRow key={row.id}>
                <TableCell kind="id" className="font-medium text-foreground">{row.deviceUserId}</TableCell>
                <TableCell>
                  <RecordLink kind="person" id={row.personId}>{row.fullName}</RecordLink>
                  {row.employeeCode ? <span className="text-muted-foreground"> · {row.employeeCode}</span> : null}
                </TableCell>
                <TableCell kind="actions">
                  <UnmapButton id={row.id} label={t("map.remove")} confirm={t("map.removeConfirm")} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("map.add")} open={map.length === 0}>
          <MapUserForm deviceId={id} people={people} />
        </TableAddRow>
      </TableCard>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{t("map.bulkTitle")}</h3>
        <BulkMapForm deviceId={id} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{t("push.title")}</h3>
        {device.pushTokenHash ? (
          <p className="text-sm">
            {t("push.issuedAt", { at: when(device.pushTokenIssuedAt!) })} · {device.lastSeenAt ? t("push.lastSeen", { at: when(device.lastSeenAt) }) : t("push.neverSeen")}
          </p>
        ) : null}
        <PushTokenPanel deviceId={id} hasToken={!!device.pushTokenHash} appOrigin={appOrigin()} />
      </section>
    </div>
  );
}
