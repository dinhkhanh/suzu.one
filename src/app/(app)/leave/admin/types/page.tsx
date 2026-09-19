import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { canManageLeaveConfig } from "@/modules/leave/policy";
import { listLeaveTypes, listPolicies } from "@/modules/leave/types";
import { LeavePolicyForm, LeaveTypeForm } from "@/modules/leave/ui/admin-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { leaveConfigOptions } from "../options";

export const metadata: Metadata = { title: "Leave types" };

// Leave types and, for the ones that keep a balance, the policy versions behind them.
export default async function LeaveTypesPage() {
  const user = await requireUser();
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
      <ul className="flex flex-col gap-3">
        {types.map((type) => {
          const versions = policies.filter((policy) => policy.leaveTypeId === type.id);
          const current = versions.find((policy) => policy.validFrom <= today && (policy.validTo === null || today <= policy.validTo)) ?? null;
          const manage = canManageLeaveConfig(user.principal, type.entityId);
          // An entity's HR may give a group type an entity policy of its own.
          const policyOptions = type.entityId ? { entities: options.entities.filter((entity) => entity.id === type.entityId), canGroup: false } : options;
          return (
            <li key={type.id} className="rounded-xl border">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                  <span className="w-36 font-mono text-xs">{type.code}</span>
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
                    <section className="flex flex-col gap-3">
                      <h3 className="text-sm font-medium">{t("policy.title")}</h3>
                      <ul className="flex flex-col divide-y rounded-lg border text-sm empty:hidden">
                        {versions.map((policy) => (
                          <li key={policy.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
                            <span className="w-52">
                              {date(policy.validFrom)} – {policy.validTo ? date(policy.validTo) : "…"}
                            </span>
                            <span className="text-muted-foreground">{entityName(policy.entityId)}</span>
                            <span>{t(`accrual.${policy.accrualMethod}`)}</span>
                            <span className="text-muted-foreground">
                              {policy.baseSource === "statutory_annual" ? t("base.statutory_annual") : days(policy.fixedDaysCenti)}
                              {policy.extraDaysCenti ? ` + ${days(policy.extraDaysCenti)}` : ""}
                              {policy.seniorityBonus ? ` + ${t("policy.seniorityShort")}` : ""}
                              {" · "}
                              {t("policy.carryShort", { cap: policy.carryOverCapCenti === null ? "∞" : days(policy.carryOverCapCenti), expiry: policy.carryOverExpiry ?? "—" })}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {versions.length === 0 ? <p className="text-sm text-muted-foreground">{t("policy.none")}</p> : null}
                      {policyOptions.entities.length > 0 || policyOptions.canGroup ? <LeavePolicyForm leaveTypeId={type.id} current={current} entities={policyOptions.entities} canGroup={policyOptions.canGroup} today={today} /> : null}
                    </section>
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {options.entities.length > 0 || options.canGroup ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("types.add")}</h2>
          <LeaveTypeForm type={null} entities={options.entities} canGroup={options.canGroup} />
        </section>
      ) : null}
    </div>
  );
}
