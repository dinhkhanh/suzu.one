"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { reviewObligationTemplateAction, saveObligationTemplateAction, syncObligationsAction } from "../actions";
import { AUTHORITIES, EVENT_TYPES, EVIDENCE_KEYS, OBLIGATION_CATEGORIES, RECURRENCES, SHIFTS } from "../enums";

export type TemplateFormValue = {
  id: string | null;
  code: string;
  name: string;
  category: string;
  authority: string;
  recurrence: string;
  dueRule: { type: "after_period"; monthsAfter: number; day: number | "last" } | { type: "in_period"; month: number; day: number | "last" } | { type: "after_event"; days: number };
  shift: string;
  eventType: string | null;
  entityIds: string[] | null;
  ownerRule: string;
  ownerPersonId: string | null;
  reviewerRule: string;
  reviewerPersonId: string | null;
  checklist: string[];
  guidance: string | null;
  links: { url: string; title: string }[];
  reminderLeadDays: number[];
  escalation: { managerAfterDays: number; executiveAfterDays: number };
  evidence: Record<(typeof EVIDENCE_KEYS)[number], boolean>;
  penaltyNote: string | null;
  isActive: boolean;
};

export type LibraryOptions = { entities: { id: string; code: string }[]; people: { id: string; fullName: string }[]; roles: string[]; permissions: string[] };

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";
const splitRule = (rule: string): [string, string] => (rule.startsWith("permission:") ? ["permission", rule.slice(11)] : rule.startsWith("role:") ? ["role", rule.slice(5)] : [rule, ""]);

export function TemplateForm({ value, options }: { value: TemplateFormValue; options: LibraryOptions }) {
  const t = useTranslations("ops.library");
  const tEnum = useTranslations("ops.enums");
  const tRoles = useTranslations("roles");
  const router = useRouter();
  const form = useActionForm(saveObligationTemplateAction, { extra: { templateId: value.id ?? "" }, onSuccess: () => router.refresh() });
  const [recurrence, setRecurrence] = useState(value.recurrence);
  const [ruleType, setRuleType] = useState<string>(value.dueRule.type);
  const [ownerKind, ownerValue] = splitRule(value.ownerRule);
  const [reviewerKind, reviewerValue] = splitRule(value.reviewerRule);
  const rule = value.dueRule;

  const party = (prefix: "owner" | "reviewer", kind: string, current: string, personId: string | null) => (
    <div className="grid gap-2 sm:grid-cols-3">
      <Field name={`${prefix}Kind`} label={t(`${prefix}Kind`)}>
        <Select id={`${prefix}Kind`} name={`${prefix}Kind`} defaultValue={kind}>
          {(prefix === "owner" ? ["permission", "role", "person"] : ["none", "permission", "role", "person"]).map((option) => (
            <option key={option} value={option}>
              {t(`party.${option}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field name={`${prefix}Value`} label={t("partyValue")}>
        <Select id={`${prefix}Value`} name={`${prefix}Value`} defaultValue={current}>
          <option value="">—</option>
          <optgroup label={t("party.role")}>
            {options.roles.map((role) => (
              <option key={role} value={role}>
                {tRoles(role)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("party.permission")}>
            {options.permissions.map((permission) => (
              <option key={permission} value={permission}>
                {permission}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <Field name={`${prefix}PersonId`} label={t("party.person")}>
        <Select id={`${prefix}PersonId`} name={`${prefix}PersonId`} defaultValue={personId ?? ""}>
          <option value="">—</option>
          {options.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4 p-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="code" label={t("code")}>
            <Input id="code" name="code" defaultValue={value.code} required maxLength={40} />
          </Field>
          <div className="sm:col-span-3">
            <Field name="name" label={t("name")}>
              <Input id="name" name="name" defaultValue={value.name} required maxLength={200} />
            </Field>
          </div>
          <Field name="category" label={t("category")}>
            <Select id="category" name="category" defaultValue={value.category}>
              {OBLIGATION_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {tEnum(`category.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="authority" label={t("authority")}>
            <Select id="authority" name="authority" defaultValue={value.authority}>
              {AUTHORITIES.map((option) => (
                <option key={option} value={option}>
                  {tEnum(`authority.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="recurrence" label={t("recurrence")}>
            <Select
              id="recurrence"
              name="recurrence"
              value={recurrence}
              onChange={(event) => {
                setRecurrence(event.target.value);
                setRuleType(event.target.value === "event" ? "after_event" : ruleType === "after_event" ? "after_period" : ruleType);
              }}
            >
              {RECURRENCES.map((option) => (
                <option key={option} value={option}>
                  {tEnum(`recurrence.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="shift" label={t("shift")}>
            <Select id="shift" name="shift" defaultValue={value.shift}>
              {SHIFTS.map((option) => (
                <option key={option} value={option}>
                  {tEnum(`shift.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="ruleType" label={t("ruleType")}>
            <Select id="ruleType" name="ruleType" value={ruleType} onChange={(event) => setRuleType(event.target.value)}>
              {(recurrence === "event" ? ["after_event"] : ["after_period", "in_period"]).map((option) => (
                <option key={option} value={option}>
                  {tEnum(`rule.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          {ruleType === "after_event" ? (
            <>
              <Field name="eventType" label={t("eventType")}>
                <Select id="eventType" name="eventType" defaultValue={value.eventType ?? "hire"}>
                  {EVENT_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {tEnum(`event.${option}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="days" label={t("days")}>
                <Input id="days" name="days" type="number" min={-366} max={366} defaultValue={rule.type === "after_event" ? rule.days : 0} />
              </Field>
            </>
          ) : (
            <>
              {ruleType === "after_period" ? (
                <Field name="monthsAfter" label={t("monthsAfter")}>
                  <Input id="monthsAfter" name="monthsAfter" type="number" min={0} max={12} defaultValue={rule.type === "after_period" ? rule.monthsAfter : 1} />
                </Field>
              ) : (
                <Field name="month" label={t("month")}>
                  <Input id="month" name="month" type="number" min={1} max={12} defaultValue={rule.type === "in_period" ? rule.month : 1} />
                </Field>
              )}
              <Field name="day" label={t("day")}>
                <Input id="day" name="day" defaultValue={rule.type === "after_event" ? "" : String(rule.day)} placeholder="20 / last" required />
              </Field>
            </>
          )}
        </div>

        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="mb-1 text-sm font-medium">{t("entities")}</legend>
          {options.entities.map((entity) => (
            <label key={entity.id} className="flex items-center gap-1.5">
              <input type="checkbox" name="entityIds[]" value={entity.id} defaultChecked={value.entityIds?.includes(entity.id) ?? false} />
              {entity.code}
            </label>
          ))}
          <span className="text-xs text-muted-foreground">{t("entitiesHint")}</span>
        </fieldset>

        {party("owner", ownerKind, ownerValue, value.ownerPersonId)}
        {party("reviewer", reviewerKind, reviewerValue, value.reviewerPersonId)}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="checklist" label={t("checklist")}>
            <textarea id="checklist" name="checklist" rows={4} defaultValue={value.checklist.join("\n")} className={textarea} />
          </Field>
          <Field name="guidance" label={t("guidance")}>
            <textarea id="guidance" name="guidance" rows={4} defaultValue={value.guidance ?? ""} className={textarea} />
          </Field>
          <Field name="links" label={t("links")}>
            <textarea id="links" name="links" rows={2} defaultValue={value.links.map((link) => `${link.title} | ${link.url}`).join("\n")} placeholder="Quy trình | https://…" className={textarea} />
          </Field>
          <Field name="penaltyNote" label={t("penaltyNote")}>
            <textarea id="penaltyNote" name="penaltyNote" rows={2} defaultValue={value.penaltyNote ?? ""} className={textarea} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="reminderLeadDays" label={t("reminderLeadDays")}>
            <Input id="reminderLeadDays" name="reminderLeadDays" defaultValue={value.reminderLeadDays.join(", ")} placeholder="7, 3, 1" />
          </Field>
          <Field name="managerAfterDays" label={t("managerAfterDays")}>
            <Input id="managerAfterDays" name="managerAfterDays" type="number" min={0} max={90} defaultValue={value.escalation.managerAfterDays} />
          </Field>
          <Field name="executiveAfterDays" label={t("executiveAfterDays")}>
            <Input id="executiveAfterDays" name="executiveAfterDays" type="number" min={0} max={180} defaultValue={value.escalation.executiveAfterDays} />
          </Field>
        </div>

        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="mb-1 text-sm font-medium">{t("evidenceRequired")}</legend>
          {EVIDENCE_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1.5">
              <input type="checkbox" name={`evidence.${key}`} defaultChecked={value.evidence[key]} />
              {tEnum(`evidence.${key}`)}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="isActive" defaultChecked={value.isActive} />
            {t("isActive")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="markReviewed" />
            {t("markReviewed")}
          </label>
          <Button type="submit" disabled={form.pending}>
            {value.id ? t("save") : t("create")}
          </Button>
          {form.saved ? <span className="text-muted-foreground">{t("saved")}</span> : null}
        </div>
        <FormError namespace="ops.errors" errorKey={form.errorKey} />
      </FieldErrors>
    </form>
  );
}

export function ReviewButton({ templateId, reviewed }: { templateId: string; reviewed: boolean }) {
  const t = useTranslations("ops.library");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <Button
      size="sm"
      variant={reviewed ? "ghost" : "outline"}
      className={failed ? "text-destructive" : undefined}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await reviewObligationTemplateAction({ templateId, reviewed: !reviewed });
          setFailed(!result.ok);
          router.refresh();
        })
      }
    >
      {reviewed ? t("markUnreviewed") : t("markReviewedNow")}
    </Button>
  );
}

export function SyncButton() {
  const t = useTranslations("ops");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await syncObligationsAction({});
            setMessage(result.ok ? t("synced", { created: result.data.created, cancelled: result.data.cancelled + result.data.autoCompleted }) : t("errors.generic"));
            router.refresh();
          })
        }
      >
        {t("sync")}
      </Button>
      {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
    </span>
  );
}
