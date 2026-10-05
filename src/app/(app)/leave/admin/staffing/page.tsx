import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageLeaveConfig, canOpenLeaveAdmin } from "@/modules/leave/policy";
import { listStaffingRules } from "@/modules/leave/types";
import { DeleteStaffingRuleButton, StaffingRuleForm } from "@/modules/leave/ui/admin-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { unitChoices } from "@/modules/platform/org/service";
import { leaveConfigOptions } from "../options";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("minimumStaffing");

// Minimum staffing per team or department (FR-LVE-05): breaking it warns the requester and the approver.
export default async function StaffingPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenLeaveAdmin(user.principal)) notFound();
  const t = await getTranslations("leave.admin");
  const [rules, options, units] = await Promise.all([listStaffingRules(), leaveConfigOptions(user.principal), unitChoices()]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("staffing.hint")}</p>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="org">{t("appliesTo")}</TableHead>
              <TableHead kind="number">{t("staffing.minPresent")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? <TableEmpty>{t("staffing.none")}</TableEmpty> : null}
            {rules.map(({ rule, entityName, departmentName, teamName }) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">
                  {teamName ? (
                    <>
                      <RecordLink kind="unit" id={rule.teamId}>{teamName}</RecordLink> ·{" "}
                    </>
                  ) : null}
                  {departmentName ? (
                    <>
                      <RecordLink kind="unit" id={rule.departmentId}>{departmentName}</RecordLink> ·{" "}
                    </>
                  ) : null}
                  {entityName ? <RecordLink kind="entity" id={rule.entityId}>{entityName}</RecordLink> : t("everyEntity")}
                </TableCell>
                <TableCell kind="number">{rule.minPresent}</TableCell>
                <TableCell kind="actions">{canManageLeaveConfig(user.principal, rule.entityId) ? <DeleteStaffingRuleButton id={rule.id} label={t("remove")} confirm={t("removeConfirm")} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {options.entities.length > 0 || options.canGroup ? (
          <TableAddRow label={t("staffing.add")} open={rules.length === 0}>
            <StaffingRuleForm {...options} departments={units} teams={units} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}
