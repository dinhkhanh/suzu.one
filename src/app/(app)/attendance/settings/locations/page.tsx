import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { TableAddRow, TableCard, TableCardHeader } from "@/components/ui/table";
import { listLocations } from "@/modules/attendance/locations";
import { canManageLocation, canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { LocationForm } from "@/modules/attendance/ui/location-form";
import { requireUser } from "@/modules/platform/auth/session";
import { configOptions } from "../options";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("workLocations");

// Where people may check in (FR-ATT-04). HR sees and edits the locations of the entities they keep attendance for.
export default async function LocationsSettingsPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.settings");
  const [locations, options] = await Promise.all([listLocations(), configOptions(user.principal)]);
  const mine = locations.filter((location) => canManageLocation(user.principal, location.entityId));

  return (
    <section className="flex flex-col gap-3">
      <TableCard>
        <TableCardHeader title={t("locations.title")} count={mine.length || null} description={t("locations.hint")} />
        <List>
          {mine.length === 0 ? <ListEmpty>{t("locations.empty")}</ListEmpty> : null}
          {mine.map((location) => (
            <ListItem key={location.id} className="block">
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
                  <LocationForm
                    location={{
                      id: location.id,
                      entityId: location.entityId,
                      name: location.name,
                      address: location.address,
                      latitude: location.latitude,
                      longitude: location.longitude,
                      radiusM: location.radiusM,
                      accuracyLimitM: location.accuracyLimitM,
                      ipAllowlist: location.ipAllowlist,
                      rule: location.rule,
                      mode: location.mode,
                      isActive: location.isActive,
                    }}
                    entities={options.entities}
                  />
                </div>
              </details>
            </ListItem>
          ))}
        </List>
        {options.entities.length > 0 ? (
          <TableAddRow label={t("locations.add")}>
            <LocationForm entities={options.entities} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </section>
  );
}
