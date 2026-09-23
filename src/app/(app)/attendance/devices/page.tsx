import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { listDevices, listProfiles } from "@/modules/attendance/devices";
import { listLocations } from "@/modules/attendance/locations";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { DeviceForm } from "@/modules/attendance/ui/device-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { configOptions } from "../settings/options";
import { pageTitle } from "@/i18n/page-title";

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
      {devices.length === 0 ? <p className="text-sm text-muted-foreground">{t("device.empty")}</p> : null}
      <ul className="flex flex-col gap-3">
        {devices.map((device) => (
          <li key={device.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/attendance/devices/${device.id}`} className="font-medium underline-offset-4 hover:underline">
                {device.name}
              </Link>
              <span className="text-xs text-muted-foreground">{device.entityName}</span>
              <Badge variant="secondary">{device.profileName}</Badge>
              <span className="text-muted-foreground">{t("device.mapped", { count: device.mapped })}</span>
              {device.unmapped > 0 ? <Badge variant="destructive">{t("device.unmapped", { count: device.unmapped })}</Badge> : null}
              <span className="text-xs text-muted-foreground">{device.lastPunchAt ? t("device.lastPunch", { at: format.dateTime(device.lastPunchAt, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) }) : t("device.noPunches")}</span>
              {device.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted-foreground">{t("device.edit")}</summary>
              <div className="mt-3">
                <DeviceForm device={{ id: device.id, entityId: device.entityId, name: device.name, model: device.model, serialNumber: device.serialNumber, locationId: device.locationId, profileId: device.profileId, isActive: device.isActive }} {...formOptions} />
              </div>
            </details>
          </li>
        ))}
      </ul>
      {options.entities.length > 0 ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("device.add")}</summary>
          <div className="mt-4">
            <DeviceForm {...formOptions} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
