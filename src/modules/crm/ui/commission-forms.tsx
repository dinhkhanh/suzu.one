"use client";
// Sales commission (FR-CRM-45): the scheme form (the sales director or C&B propose, the owner
// decides) and the month's buttons (C&B work the month out and confirm each statement).
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { DatePicker, MonthPicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { computeCommissionAction, confirmCommissionStatementAction, decideCommissionSchemeAction, proposeCommissionSchemeAction } from "../commission-actions";
import { COMMISSION_EARNERS } from "../enums";
import { CrmButton, CrmForm, type Named } from "./common";

const TIER_ROWS = 4;

export function CommissionSchemeForm({ entities, today }: { entities: Named[]; today: string }) {
  const t = useTranslations("crm.commission");
  return (
    <CrmForm action={proposeCommissionSchemeAction} submit={t("propose")}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="name" label={t("fields.name")}>
          <Input id="cs-name" name="name" required maxLength={120} />
        </Field>
        <Field name="entityId" label={t("fields.entity")}>
          <Select id="cs-entity" name="entityId" defaultValue="">
            <option value="">{t("group")}</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="validFrom" label={t("fields.validFrom")}>
          <DatePicker id="cs-from" name="validFrom" required defaultValue={today} />
        </Field>
        <Field name="earner" label={t("fields.earner")}>
          <Select id="cs-earner" name="earner" defaultValue="deal_owner">
            {COMMISSION_EARNERS.map((earner) => (
              <option key={earner} value={earner}>
                {t(`earners.${earner}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="splitOwnerPercent" label={t("fields.splitOwner")}>
          <Input id="cs-split" name="splitOwnerPercent" inputMode="decimal" defaultValue="70" />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-medium">{t("fields.tiers")}</legend>
        <p className="text-xs text-muted-foreground">{t("tiersHint")}</p>
        {Array.from({ length: TIER_ROWS }, (_, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 sm:max-w-md">
            <Input name="tierFrom[]" inputMode="numeric" aria-label={t("fields.tierFrom")} placeholder={index === 0 ? "0" : t("fields.tierFrom")} defaultValue={index === 0 ? "0" : ""} />
            <Input name="tierRate[]" inputMode="decimal" aria-label={t("fields.tierRate")} placeholder={t("fields.tierRate")} />
          </div>
        ))}
      </fieldset>
    </CrmForm>
  );
}

export function SchemeDecision({ schemeId }: { schemeId: string }) {
  const t = useTranslations("crm.commission");
  return (
    <span className="flex flex-wrap gap-2">
      <CrmButton action={decideCommissionSchemeAction} input={{ id: schemeId, decision: "approved" }} label={t("approve")} variant="default" />
      <CrmButton action={decideCommissionSchemeAction} input={{ id: schemeId, decision: "rejected" }} label={t("reject")} variant="ghost" />
    </span>
  );
}

/** The month shown: a picker that navigates. */
export function CommissionMonthPicker({ month }: { month: string }) {
  const t = useTranslations("crm.commission");
  const router = useRouter();
  return <MonthPicker id="commission-month" name="month" aria-label={t("month")} defaultValue={month} onChange={(event) => event.target.value && router.push(`/crm/commission?month=${event.target.value}`)} />;
}

export function ComputeButton({ month }: { month: string }) {
  const t = useTranslations("crm.commission");
  return <CrmButton action={computeCommissionAction} input={{ month }} label={t("compute")} variant="default" />;
}

export function ConfirmStatementButton({ statementId }: { statementId: string }) {
  const t = useTranslations("crm.commission");
  return <CrmButton action={confirmCommissionStatementAction} input={{ id: statementId }} label={t("confirm")} confirm={t("confirmPrompt")} />;
}
