import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { listPolicies } from "@/modules/attendance/attendance-policies";
import { canManageAttendanceConfig, canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { PolicyForm } from "@/modules/attendance/ui/device-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { configOptions } from "../options";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("attendancePolicy");

// Company practice the timesheet follows (FR-ATT-08): merge rule, grace, rounding, overtime
// thresholds, correction cap. Versions are effective-dated; legal values are statutory parameters.
export default async function PolicySettingsPage() {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.policy");
  const today = todayInVietnam();
  const [policies, options] = await Promise.all([listPolicies(), configOptions(user.principal)]);
  const visible = policies.filter((policy) => policy.entityId === null || canManageAttendanceConfig(user.principal, policy.entityId));
  const current = visible.filter((policy) => policy.validFrom <= today && (policy.validTo === null || policy.validTo >= today));

  return (
    <section className="flex flex-col gap-3">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("hint")}</p>
      {visible.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-3">
        {visible.map((policy) => (
          <li key={policy.id} className="rounded-xl border p-4">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{policy.entityName ?? t("everyEntity")}</span>
                <span className="text-muted-foreground">
                  {policy.validFrom} → {policy.validTo ?? "…"}
                </span>
                <Badge variant="secondary">{t(`mergeRules.${policy.mergeRule}`)}</Badge>
                <span className="text-muted-foreground">{t("summary", { late: policy.graceLateMinutes, early: policy.graceEarlyMinutes, rounding: policy.roundingMinutes, ot: policy.otMinMinutes })}</span>
                {current.includes(policy) ? <Badge>{t("inForce")}</Badge> : null}
              </summary>
              {policy.validTo === null && canManageAttendanceConfig(user.principal, policy.entityId) ? (
                <div className="mt-4">
                  <PolicyForm policy={policy} {...options} today={today} />
                </div>
              ) : null}
            </details>
          </li>
        ))}
      </ul>
      {options.entities.length > 0 || options.canGroup ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("add")}</summary>
          <div className="mt-4">
            <PolicyForm {...options} today={today} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
