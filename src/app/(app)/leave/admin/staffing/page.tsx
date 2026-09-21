import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canManageLeaveConfig } from "@/modules/leave/policy";
import { listStaffingRules } from "@/modules/leave/types";
import { DeleteStaffingRuleButton, StaffingRuleForm } from "@/modules/leave/ui/admin-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { unitChoices } from "@/modules/platform/org/service";
import { leaveConfigOptions } from "../options";

export const metadata: Metadata = { title: "Minimum staffing" };

// Minimum staffing per team or department (FR-LVE-05): breaking it warns the requester and the approver.
export default async function StaffingPage() {
  const user = await requireUser();
  const t = await getTranslations("leave.admin");
  const [rules, options, units] = await Promise.all([listStaffingRules(), leaveConfigOptions(user.principal), unitChoices()]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("staffing.hint")}</p>
      {rules.length === 0 ? <p className="text-sm text-muted-foreground">{t("staffing.none")}</p> : null}
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {rules.map(({ rule, entityName, departmentName, teamName }) => (
          <li key={rule.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1 font-medium">{[teamName, departmentName, entityName ?? t("everyEntity")].filter(Boolean).join(" · ")}</span>
            <span>{t("staffing.atLeast", { count: rule.minPresent })}</span>
            {canManageLeaveConfig(user.principal, rule.entityId) ? <DeleteStaffingRuleButton id={rule.id} label={t("remove")} confirm={t("removeConfirm")} /> : null}
          </li>
        ))}
      </ul>
      {options.entities.length > 0 || options.canGroup ? <StaffingRuleForm {...options} departments={units} teams={units} /> : null}
    </div>
  );
}
