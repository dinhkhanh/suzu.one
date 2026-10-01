import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { listProfiles } from "@/modules/attendance/devices";
import { canManageAttendanceConfig } from "@/modules/attendance/policy";
import { ProfileForm } from "@/modules/attendance/ui/device-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { configOptions } from "../../settings/options";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("mappingProfiles");

// How each device model writes its export: which column is the user ID, the timestamp, the direction.
export default async function ProfilesPage() {
  const user = await requireUser();
  const t = await getTranslations("attendance.devices");
  const [profiles, options] = await Promise.all([listProfiles(), configOptions(user.principal)]);
  const visible = profiles.filter((profile) => profile.entityId === null || canManageAttendanceConfig(user.principal, profile.entityId));
  return (
    <section className="flex flex-col gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("profile.hint")}</p>
      <TableCard>
        <List>
          {visible.map((profile) => (
            <ListItem key={profile.id} className="block">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{profile.name}</span>
                  <Badge variant="secondary">{t(`profile.fileKinds.${profile.fileKind}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{profile.entityName ?? t("everyEntity")}</span>
                  <span className="text-muted-foreground">{profile.mapping.timestampFormat}</span>
                  {profile.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                </summary>
                {canManageAttendanceConfig(user.principal, profile.entityId) ? (
                  <div className="mt-4">
                    <ProfileForm profile={{ id: profile.id, entityId: profile.entityId, name: profile.name, deviceModel: profile.deviceModel, fileKind: profile.fileKind, mapping: profile.mapping, isActive: profile.isActive }} {...options} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">{t("profile.groupOnly")}</p>
                )}
              </details>
            </ListItem>
          ))}
        </List>
        {options.entities.length > 0 || options.canGroup ? (
          <TableAddRow label={t("profile.add")}>
            <ProfileForm {...options} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </section>
  );
}
