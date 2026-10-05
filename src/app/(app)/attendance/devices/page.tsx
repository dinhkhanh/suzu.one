import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { listDevices, listProfiles } from "@/modules/attendance/devices";
import { listLocations } from "@/modules/attendance/locations";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { DeviceForm } from "@/modules/attendance/ui/device-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { configOptions } from "../settings/options";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("timeClocks");

export default async function DevicesPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.devices");
  const format = await getFormatter();
  const [devices, profiles, locations, options] = await Promise.all([listDevices(user.principal), listProfiles(), listLocations(), configOptions(user.principal)]);
  const formOptions = { entities: options.entities, profiles: profiles.filter((profile) => profile.isActive).map((profile) => ({ id: profile.id, name: profile.name, entityId: profile.entityId })), locations: locations.map((location) => ({ id: location.id, name: location.name, entityId: location.entityId })) };

  return (
    <section className="flex flex-col gap-3">
      <TableCard>
        <List>
          {devices.length === 0 ? <ListEmpty>{t("device.empty")}</ListEmpty> : null}
          {devices.map((device) => (
            <ListItem key={device.id} className="block">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <RecordLink kind="device" id={device.id} className="font-medium">
                  {device.name}
                </RecordLink>
                <span className="text-xs text-muted-foreground">{[device.entityName, ...device.alsoServes.map((entity) => entity.name)].join(" + ")}</span>
                <Badge variant="secondary">{device.profileName}</Badge>
                <span className="text-muted-foreground">{t("device.mapped", { count: device.mapped })}</span>
                {device.unmapped > 0 ? <Badge variant="destructive">{t("device.unmapped", { count: device.unmapped })}</Badge> : null}
                <span className="text-xs text-muted-foreground">{device.lastPunchAt ? t("device.lastPunch", { at: format.dateTime(device.lastPunchAt, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) }) : t("device.noPunches")}</span>
                {device.pushTokenHash ? <Badge variant="outline">{device.lastSeenAt ? t("push.lastSeen", { at: format.dateTime(device.lastSeenAt, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) }) : t("push.neverSeen")}</Badge> : null}
                {device.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">{t("device.edit")}</summary>
                <div className="mt-3">
                  <DeviceForm device={{ id: device.id, entityId: device.entityId, name: device.name, model: device.model, serialNumber: device.serialNumber, locationId: device.locationId, profileId: device.profileId, isActive: device.isActive, alsoServes: device.alsoServes }} {...formOptions} />
                </div>
              </details>
            </ListItem>
          ))}
        </List>
        {options.entities.length > 0 ? (
          <TableAddRow label={t("device.add")}>
            <DeviceForm {...formOptions} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </section>
  );
}
