import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { canManageLeaveConfig, canOpenLeaveAdmin } from "@/modules/leave/policy";
import { listLeaveTypes, listPolicies } from "@/modules/leave/types";
import { LeavePolicyForm, LeaveTypeForm } from "@/modules/leave/ui/admin-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { leaveConfigOptions } from "../options";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("leaveTypes");

// Leave types and, for the ones that keep a balance, the policy versions behind them.
export default async function LeaveTypesPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenLeaveAdmin(user.principal)) notFound();
  const t = await getTranslations("leave.admin");
  const format = await getFormatter();
  const today = todayInVietnam();
  const [types, policies, options] = await Promise.all([listLeaveTypes(), listPolicies(), leaveConfigOptions(user.principal)]);
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "numeric", year: "numeric" });
  const entityName = (id: string | null) => (id ? (options.entities.find((entity) => entity.id === id)?.name ?? "…") : t("everyEntity"));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("types.hint")}</p>
      <TableCard>
        <List>
          {types.map((type) => {
            const versions = policies.filter((policy) => policy.leaveTypeId === type.id);
            const current = versions.find((policy) => policy.validFrom <= today && (policy.validTo === null || today <= policy.validTo)) ?? null;
            const manage = canManageLeaveConfig(user.principal, type.entityId);
            // An entity's HR may give a group type an entity policy of its own.
            const policyOptions = type.entityId ? { entities: options.entities.filter((entity) => entity.id === type.entityId), canGroup: false } : options;
            return (
              <ListItem key={type.id} className="block p-0">
                <details>
                  <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-muted/40">
                    <span className="w-36 font-mono text-xs text-muted-foreground">{type.code}</span>
                    <span className="min-w-0 flex-1 font-medium">{type.name}</span>
                    <Badge variant="secondary">{t(`treatments.${type.payrollTreatment}`)}</Badge>
                    {type.tracksBalance ? <Badge variant="outline">{t("types.tracksBalance")}</Badge> : null}
                    {type.isLongTerm ? <Badge variant="outline">{t("types.isLongTerm")}</Badge> : null}
                    {type.isActive ? null : <Badge variant="outline">{t("types.inactive")}</Badge>}
                    <span className="text-xs text-muted-foreground">{type.entityName ?? t("everyEntity")}</span>
                  </summary>
                  <div className="flex flex-col gap-6 border-t p-4">
                    {manage ? <LeaveTypeForm type={type} entities={options.entities} canGroup={options.canGroup} /> : <p className="text-sm text-muted-foreground">{t("types.readOnly")}</p>}
                    {type.tracksBalance ? (
                      <TableCard>
                        <TableCardHeader title={t("policy.title")} count={versions.length || null} />
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead kind="date">{t("policy.validFrom")}</TableHead>
                              <TableHead kind="org">{t("appliesTo")}</TableHead>
                              <TableHead kind="select">{t("policy.accrualMethod")}</TableHead>
                              <TableHead kind="text">{t("policy.baseSource")}</TableHead>
                              <TableHead kind="text">{t("policy.carryOverCap")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {versions.length === 0 ? <TableEmpty>{t("policy.none")}</TableEmpty> : null}
                            {versions.map((policy) => (
                              <TableRow key={policy.id}>
                                <TableCell>
                                  {date(policy.validFrom)} – {policy.validTo ? date(policy.validTo) : "…"}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{policy.entityId ? <RecordLink kind="entity" id={policy.entityId}>{entityName(policy.entityId)}</RecordLink> : entityName(null)}</TableCell>
                                <TableCell>{t(`accrual.${policy.accrualMethod}`)}</TableCell>
                                <TableCell>
                                  {policy.baseSource === "statutory_annual" ? t("base.statutory_annual") : days(policy.fixedDaysCenti)}
                                  {policy.extraDaysCenti ? ` + ${days(policy.extraDaysCenti)}` : ""}
                                  {policy.seniorityBonus ? ` + ${t("policy.seniorityShort")}` : ""}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{t("policy.carryShort", { cap: policy.carryOverCapCenti === null ? "∞" : days(policy.carryOverCapCenti), expiry: policy.carryOverExpiry ?? "—" })}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {policyOptions.entities.length > 0 || policyOptions.canGroup ? (
                          <TableAddRow label={t("policy.add")} open={versions.length === 0}>
                            <LeavePolicyForm leaveTypeId={type.id} current={current} entities={policyOptions.entities} canGroup={policyOptions.canGroup} today={today} />
                          </TableAddRow>
                        ) : null}
                      </TableCard>
                    ) : null}
                  </div>
                </details>
              </ListItem>
            );
          })}
        </List>
        {options.entities.length > 0 || options.canGroup ? (
          <TableAddRow label={t("types.add")} open={types.length === 0}>
            <LeaveTypeForm type={null} entities={options.entities} canGroup={options.canGroup} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}
