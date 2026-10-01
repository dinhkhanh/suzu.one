import { CheckIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";
import { type Permission, ROLE_DEFINITIONS, ROLES } from "@/modules/platform/rbac/roles";
import { listRoleAssignments } from "@/modules/platform/rbac/service";
import { GrantRoleForm, RevokeRoleButton } from "@/modules/platform/rbac/ui/role-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("access");

// Every permission any role lists, in one order, so the matrix reads the same each time.
const PERMISSIONS = [...new Set(ROLES.flatMap((role) => ROLE_DEFINITIONS[role].permissions).filter((permission): permission is Exclude<Permission, "*"> => permission !== "*"))].sort();

type Hold = "everywhere" | "scoped" | "none";
const holdOf = (role: (typeof ROLES)[number], permission: Permission): Hold => {
  const { permissions } = ROLE_DEFINITIONS[role];
  if (permissions.includes("*")) return "everywhere";
  return permissions.includes(permission) ? "scoped" : "none";
};

// The three marks of the matrix: a filled square for "everywhere", a tinted "S" for "within the
// grant's scope", a faint dot for "no".
function Mark({ hold, label }: { hold: Hold; label: string }) {
  if (hold === "everywhere")
    return (
      <span title={label} className="mx-auto flex size-5 items-center justify-center rounded-[5px] bg-primary text-primary-foreground [&_svg]:size-3.5">
        <CheckIcon aria-hidden strokeWidth={3} />
        <span className="sr-only">{label}</span>
      </span>
    );
  if (hold === "scoped")
    return (
      <span title={label} className="mx-auto flex size-5 items-center justify-center rounded-[5px] bg-primary/10 font-mono text-[0.6875rem] font-semibold text-primary">
        S<span className="sr-only"> {label}</span>
      </span>
    );
  return (
    <span title={label} className="mx-auto flex size-5 items-center justify-center">
      <span aria-hidden className="size-1.5 rounded-full bg-faint/50" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default async function RolesPage() {
  const user = await requireUser();
  if (!can(user.principal, "rbac:manage", {})) notFound();

  const [t, roleName, tiers, format] = await Promise.all([getTranslations("rbac"), getTranslations("roles"), getTranslations("documents.tier"), getFormatter()]);
  const [grants, people, entities, units] = await Promise.all([listRoleAssignments(), listPersonNames(), listEntities(), unitChoices()]);
  const today = todayInVietnam();
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const holdLabel = (hold: Hold) => t(`matrix.${hold}`);

  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />

      <Section title={t("grants")} count={grants.length}>
        <TableCard>
          <Table className="min-w-[52rem]">
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
              {grants.length === 0 ? <TableEmpty>{t("noGrants")}</TableEmpty> : null}
              {grants.map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell className="max-w-64">
                    <Link href={`/people/${grant.personId}`} className="block truncate font-medium hover:underline">
                      {grant.personName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{grant.workEmail ?? t("noAccess")}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{roleName.has(grant.role) ? roleName(grant.role) : grant.role}</Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate">
                    {t(`scope.${grant.scopeType}`)}
                    {grant.scopeType === "group" ? null : <span className="text-muted-foreground"> · {grant.scopeName ?? "?"}</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                    {day(grant.validFrom)} → {grant.validTo ? day(grant.validTo) : "…"}
                    {grant.validFrom > today ? <Badge variant="warning" className="ml-2 font-sans">{t("notYet")}</Badge> : null}
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
      </Section>

      <Section title={t("matrix.title")} action={<span className="font-normal text-muted-foreground">{t("matrix.hint")}</span>}>
        <TableCard>
          <Table numbered={false} className="min-w-[64rem]">
            <TableHeader>
              <TableRow>
                <TableHead kind="id" className="sticky left-0 z-10 bg-canvas">{t("matrix.permission")}</TableHead>
                {ROLES.map((role) => (
                  <TableHead key={role} className="px-2 text-center align-bottom whitespace-normal">
                    <span className="flex flex-col items-center gap-0.5">
                      <span className="max-w-20 text-xs leading-tight font-medium text-foreground">{roleName(role)}</span>
                      <span className="text-[0.625rem] font-normal text-faint">{tiers(ROLE_DEFINITIONS[role].maxTier)}</span>
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map((permission) => {
                const [resource, action] = permission.split(":");
                return (
                  <TableRow key={permission}>
                    <TableCell className="sticky left-0 z-10 h-10 bg-background py-1">
                      <span className="font-mono text-xs">{resource}</span>
                      <span className="font-mono text-xs text-faint">:{action}</span>
                    </TableCell>
                    {ROLES.map((role) => {
                      const hold = holdOf(role, permission);
                      return (
                        <TableCell key={role} className="h-10 px-2 py-1 text-center">
                          <Mark hold={hold} label={`${roleName(role)} · ${holdLabel(hold)}`} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-canvas px-4 py-2.5 text-xs text-muted-foreground">
            {(["everywhere", "scoped", "none"] as const).map((hold) => (
              <span key={hold} className="flex items-center gap-2">
                <Mark hold={hold} label={holdLabel(hold)} />
                {holdLabel(hold)}
              </span>
            ))}
            <span className="ml-auto text-faint">{t("matrix.tierHint")}</span>
          </div>
        </TableCard>
      </Section>
    </Page>
  );
}
