import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";
import { listRoleAssignments } from "@/modules/platform/rbac/service";
import { GrantRoleForm, RevokeRoleButton } from "@/modules/platform/rbac/ui/role-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("access");

export default async function RolesPage() {
  const user = await requireUser();
  if (!can(user.principal, "rbac:manage", {})) notFound();

  const [t, roleName, format] = await Promise.all([getTranslations("rbac"), getTranslations("roles"), getFormatter()]);
  const [grants, people, entities, units] = await Promise.all([listRoleAssignments(), listPersonNames(), listEntities(), unitChoices()]);
  const today = todayInVietnam();
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("person")}</TableHead>
              <TableHead kind="select">{t("role")}</TableHead>
              <TableHead kind="org">{t("scopeType")}</TableHead>
              <TableHead kind="date">{t("period")}</TableHead>
              <TableHead kind="person">{t("grantedBy")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell>
                  <Link href={`/people/${grant.personId}`} className="font-medium hover:underline">
                    {grant.personName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{grant.workEmail ?? t("noAccess")}</p>
                </TableCell>
                <TableCell>{roleName.has(grant.role) ? roleName(grant.role) : grant.role}</TableCell>
                <TableCell>
                  {t(`scope.${grant.scopeType}`)}
                  {grant.scopeType === "group" ? null : <span className="text-muted-foreground"> · {grant.scopeName ?? "?"}</span>}
                </TableCell>
                <TableCell>
                  {day(grant.validFrom)} → {grant.validTo ? day(grant.validTo) : "…"}
                  {grant.validFrom > today ? <Badge variant="outline" className="ml-2">{t("notYet")}</Badge> : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{grant.grantedByName ?? t("system")}</TableCell>
                <TableCell kind="actions">
                  <RevokeRoleButton id={grant.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("grant")}>
          <GrantRoleForm
            today={today}
            people={people.map((person) => ({ id: person.id, name: person.fullName }))}
            scopes={{
              entity: entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName })),
              unit: units,
            }}
          />
        </TableAddRow>
      </TableCard>
    </div>
  );
}
