"use client";
// A team's daily rules (FR-PJM-21, 22, 24, 25, 44, 10): kept by its lead. A person in several
// teams follows the strictest of them.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveTeamRulesAction } from "../actions";
import { RULE_MODES, WEEKDAYS } from "../enums";

type Rules = { planMode: string; reportMode: string; reportDays: readonly number[]; planCutoff: string; reportDeadline: string; timeMode: string; timesheetApproval: boolean; coverMinDays: number; cycleWeeks: number | null; cycleStart: string | null };

export function TeamRulesForm({ teamId, rules, canManage }: { teamId: string; rules: Rules; canManage: boolean }) {
  const t = useTranslations("daily.rules");
  const tDaily = useTranslations("daily");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveTeamRulesAction, { extra: { teamId }, onSuccess: () => router.refresh() });
  const mode = (name: "planMode" | "reportMode" | "timeMode", value: string) => (
    <Field name={name} label={t(`fields.${name}`)}>
      <Select id={name} name={name} defaultValue={value} disabled={!canManage}>
        {RULE_MODES.map((option) => (
          <option key={option} value={option}>
            {t(`modes.${option}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mode("planMode", rules.planMode)}
          {mode("reportMode", rules.reportMode)}
          {mode("timeMode", rules.timeMode)}
          <Field name="planCutoff" label={t("fields.planCutoff")}>
            <Input id="planCutoff" name="planCutoff" type="time" required defaultValue={rules.planCutoff} disabled={!canManage} />
          </Field>
          <Field name="reportDeadline" label={t("fields.reportDeadline")}>
            <Input id="reportDeadline" name="reportDeadline" type="time" required defaultValue={rules.reportDeadline} disabled={!canManage} />
          </Field>
          <Field name="coverMinDays" label={t("fields.coverMinDays")}>
            <Input id="coverMinDays" name="coverMinDays" type="number" min={1} max={30} required defaultValue={rules.coverMinDays} disabled={!canManage} />
          </Field>
          <fieldset className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <legend className="text-sm font-medium">{t("fields.reportDays")}</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {WEEKDAYS.map((day) => (
                <label key={day} className="flex items-center gap-1.5">
                  <input type="checkbox" name="reportDays[]" value={day} defaultChecked={rules.reportDays.includes(day)} disabled={!canManage} /> {t(`weekdays.${day}`)}
                </label>
              ))}
            </div>
            {/* Nothing ticked is the default and the normal case: everyone follows their own working calendar. */}
            <p className="text-xs text-muted-foreground">{t("reportDaysHint")}</p>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="timesheetApproval" defaultChecked={rules.timesheetApproval} disabled={!canManage} /> {t("fields.timesheetApproval")}
          </label>
          <Field name="cycleWeeks" label={t("fields.cycleWeeks")}>
            <Select id="cycleWeeks" name="cycleWeeks" defaultValue={rules.cycleWeeks?.toString() ?? ""} disabled={!canManage}>
              <option value="">{t("noCycles")}</option>
              {[1, 2, 3, 4].map((weeks) => (
                <option key={weeks} value={weeks}>
                  {t("weeks", { count: weeks })}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="cycleStart" label={t("fields.cycleStart")}>
            <Input id="cycleStart" name="cycleStart" type="date" defaultValue={rules.cycleStart ?? ""} disabled={!canManage} />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace="daily.errors" errorKey={errorKey} />
      {canManage ? (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {tDaily("save")}
          </Button>
          {saved ? <span className="text-sm text-muted-foreground">{tDaily("saved")}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
