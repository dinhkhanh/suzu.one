"use client";
// The editor of a configured flow (FR-PLT-20, 21): steps in order, each with its approver rules,
// an optional condition on the request's data and "opens together with the previous step".
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { deleteFlowAction, saveFlowAction } from "../actions";
import type { ApproverRule, Condition, FlowDefinition, StepDefinition } from "../engine/flow";

type Options = {
  /** `name` is set for the request builder's types, which are named in the database rather than the message bundle. */
  requestTypes: { type: string; conditionFields: readonly string[]; name?: string }[];
  entities: { id: string; name: string }[];
  canGroup: boolean;
  people: { id: string; fullName: string }[];
  roles: readonly string[];
  permissions: readonly string[];
};
type EditableStep = Omit<StepDefinition, "approvers" | "condition"> & { approvers: ApproverRule[]; condition?: Condition };
const RULES = ["line_manager", "department_head", "manager_level", "permission", "role", "person"] as const;
const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in"] as const;

function blankRule(rule: (typeof RULES)[number], options: Options): ApproverRule {
  if (rule === "manager_level") return { rule, level: 2 };
  if (rule === "permission") return { rule, permission: options.permissions[0] ?? "" };
  if (rule === "role") return { rule, role: options.roles[0] ?? "" };
  if (rule === "person") return { rule, personId: options.people[0]?.id ?? "" };
  return { rule };
}

// What was typed as a condition's value, as the type the engine compares with.
function conditionValue(op: Condition["op"], text: string): Condition["value"] {
  const one = (part: string) => (part.trim() !== "" && !Number.isNaN(Number(part)) ? Number(part) : part.trim());
  if (op === "in") return text.split(",").map(one);
  if (text === "true" || text === "false") return text === "true";
  return one(text);
}

export function FlowEditor({ options, flow }: { options: Options; flow?: { id: string; requestType: string; entityId: string | null; active: boolean; definition: FlowDefinition } }) {
  const t = useTranslations("approvals.flows");
  const tRoles = useTranslations("roles");
  const tTypes = useTranslations("approvals.types");
  const [requestType, setRequestType] = useState(flow?.requestType ?? options.requestTypes[0]?.type ?? "");
  const [entityId, setEntityId] = useState(flow?.entityId ?? (options.canGroup ? "" : (options.entities[0]?.id ?? "")));
  const [active, setActive] = useState(flow?.active ?? true);
  const [steps, setSteps] = useState<EditableStep[]>(() => (flow ? flow.definition.steps.map((step) => ({ ...step, approvers: [...step.approvers] })) : [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }]));
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const fields = options.requestTypes.find((entry) => entry.type === requestType)?.conditionFields ?? [];

  const patch = (index: number, change: Partial<EditableStep>) => setSteps((current) => current.map((step, position) => (position === index ? { ...step, ...change } : step)));
  const patchRule = (index: number, ruleIndex: number, rule: ApproverRule) => patch(index, { approvers: steps[index].approvers.map((existing, position) => (position === ruleIndex ? rule : existing)) });

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setSaved(false);
    startTransition(async () => {
      const result = await action();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      setSaved(result.ok);
    });
  }
  const save = () =>
    run(() =>
      saveFlowAction({
        requestType,
        entityId,
        active,
        definition: JSON.stringify({ steps: steps.map((step, index) => ({ key: step.key, mode: step.mode, approvers: step.approvers, ...(step.condition ? { condition: step.condition } : {}), ...(step.parallel && index > 0 ? { parallel: true } : {}) })) }),
      }),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          {t("requestType")}
          <Select value={requestType} disabled={!!flow} onChange={(event) => setRequestType(event.target.value)}>
            {options.requestTypes.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.name ?? (tTypes.has(entry.type) ? tTypes(entry.type as "profile_change") : entry.type)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t("entity")}
          <Select value={entityId} disabled={!!flow} onChange={(event) => setEntityId(event.target.value)}>
            {options.canGroup ? <option value="">{t("group")}</option> : null}
            {options.entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" className="size-4" checked={active} onChange={(event) => setActive(event.target.checked)} />
          {t("active")}
        </label>
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={index} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1.5 text-sm">
                {t("stepKey", { number: index + 1 })}
                <Input value={step.key} maxLength={40} onChange={(event) => patch(index, { key: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                {t("mode")}
                <Select value={step.mode} onChange={(event) => patch(index, { mode: event.target.value as "any" | "all" })}>
                  <option value="any">{t("modeAny")}</option>
                  <option value="all">{t("modeAll")}</option>
                </Select>
              </label>
              {index > 0 ? (
                <label className="flex items-center gap-2 self-end text-sm sm:col-span-2">
                  <input type="checkbox" className="size-4" checked={!!step.parallel} onChange={(event) => patch(index, { parallel: event.target.checked })} />
                  {t("parallel")}
                </label>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">{t("approvers")}</p>
              {step.approvers.map((rule, ruleIndex) => (
                <div key={ruleIndex} className="flex flex-wrap items-center gap-2">
                  <Select className="w-auto" value={rule.rule} onChange={(event) => patchRule(index, ruleIndex, blankRule(event.target.value as (typeof RULES)[number], options))}>
                    {RULES.map((name) => (
                      <option key={name} value={name}>
                        {t(`rules.${name}`)}
                      </option>
                    ))}
                  </Select>
                  {rule.rule === "manager_level" ? <Input className="w-20" type="number" min={1} max={6} value={rule.level} onChange={(event) => patchRule(index, ruleIndex, { rule: "manager_level", level: Number(event.target.value) })} /> : null}
                  {rule.rule === "permission" ? (
                    <Select className="w-auto" value={rule.permission} onChange={(event) => patchRule(index, ruleIndex, { rule: "permission", permission: event.target.value })}>
                      {options.permissions.map((permission) => (
                        <option key={permission}>{permission}</option>
                      ))}
                    </Select>
                  ) : null}
                  {rule.rule === "role" ? (
                    <Select className="w-auto" value={rule.role} onChange={(event) => patchRule(index, ruleIndex, { rule: "role", role: event.target.value })}>
                      {options.roles.map((role) => (
                        <option key={role} value={role}>
                          {tRoles.has(role) ? tRoles(role as "owner") : role}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {rule.rule === "person" ? (
                    <Select className="w-auto" value={rule.personId} onChange={(event) => patchRule(index, ruleIndex, { rule: "person", personId: event.target.value })}>
                      {options.people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.fullName}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {step.approvers.length > 1 ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => patch(index, { approvers: step.approvers.filter((_, position) => position !== ruleIndex) })}>
                      {t("remove")}
                    </Button>
                  ) : null}
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => patch(index, { approvers: [...step.approvers, { rule: "department_head" }] })}>
                  {t("addApprover")}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={!!step.condition} onChange={(event) => patch(index, { condition: event.target.checked ? { field: fields[0] ?? "days", op: "gt", value: 3 } : undefined })} />
                {t("condition")}
              </label>
              {step.condition ? (
                <>
                  <Input className="w-32" list={`fields-${index}`} value={step.condition.field} onChange={(event) => patch(index, { condition: { ...step.condition!, field: event.target.value } })} />
                  <datalist id={`fields-${index}`}>
                    {fields.map((field) => (
                      <option key={field} value={field} />
                    ))}
                  </datalist>
                  <Select className="w-auto" value={step.condition.op} onChange={(event) => patch(index, { condition: { ...step.condition!, op: event.target.value as Condition["op"], value: conditionValue(event.target.value as Condition["op"], String(step.condition!.value)) } })}>
                    {OPS.map((op) => (
                      <option key={op} value={op}>
                        {t(`ops.${op}`)}
                      </option>
                    ))}
                  </Select>
                  <Input className="w-32" defaultValue={Array.isArray(step.condition.value) ? step.condition.value.join(", ") : String(step.condition.value)} onChange={(event) => patch(index, { condition: { ...step.condition!, value: conditionValue(step.condition!.op, event.target.value) } })} />
                </>
              ) : null}
              {steps.length > 1 ? (
                <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setSteps(steps.filter((_, position) => position !== index))}>
                  {t("removeStep")}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}` as "errors.generic") : t("errors.generic")}
        </p>
      ) : null}
      {saved ? <p className="text-sm text-muted-foreground">{t("saved")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={steps.length >= 8} onClick={() => setSteps([...steps, { key: `step_${steps.length + 1}`, mode: "any", approvers: [{ rule: "department_head" }] }])}>
          {t("addStep")}
        </Button>
        <Button type="button" disabled={pending} onClick={save}>
          {t("save")}
        </Button>
        {flow ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => window.confirm(t("deleteConfirm")) && run(() => deleteFlowAction({ id: flow.id }))}>
            {t("delete")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
