import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { listLocations } from "@/modules/attendance/locations";
import { canManageLocation } from "@/modules/attendance/policy";
import { LocationForm } from "@/modules/attendance/ui/location-form";
import { requireUser } from "@/modules/platform/auth/session";
import { configOptions } from "../options";

export const metadata: Metadata = { title: "Work locations" };

// Where people may check in (FR-ATT-04). HR sees and edits the locations of the entities they keep attendance for.
export default async function LocationsSettingsPage() {
  const user = await requireUser();
  const t = await getTranslations("attendance.settings");
  const [locations, options] = await Promise.all([listLocations(), configOptions(user.principal)]);
  const mine = locations.filter((location) => canManageLocation(user.principal, location.entityId));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("locations.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("locations.hint")}</p>
      {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("locations.empty")}</p> : null}
      <ul className="flex flex-col gap-3">
        {mine.map((location) => (
          <li key={location.id} className="rounded-xl border p-4">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{location.name}</span>
                <span className="text-xs text-muted-foreground">{location.entityName}</span>
                <Badge variant="secondary">{t(`locations.rules.${location.rule}`)}</Badge>
                <Badge variant={location.mode === "block" ? "destructive" : "outline"}>{t(`locations.modes.${location.mode}`)}</Badge>
                {location.radiusM ? <span className="text-muted-foreground">{t("locations.radiusValue", { metres: location.radiusM })}</span> : null}
                {location.ipAllowlist.length ? <span className="text-muted-foreground">{t("locations.networks", { count: location.ipAllowlist.length })}</span> : null}
                {location.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
              </summary>
              <div className="mt-4">
                <LocationForm location={{ id: location.id, entityId: location.entityId, name: location.name, address: location.address, latitude: location.latitude, longitude: location.longitude, radiusM: location.radiusM, accuracyLimitM: location.accuracyLimitM, ipAllowlist: location.ipAllowlist, rule: location.rule, mode: location.mode, isActive: location.isActive }} entities={options.entities} />
              </div>
            </details>
          </li>
        ))}
      </ul>
      {options.entities.length > 0 ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("locations.add")}</summary>
          <div className="mt-4">
            <LocationForm entities={options.entities} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
