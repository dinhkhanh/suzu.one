"use client";
// The editor of a configured flow (FR-PLT-20, 21): the steps drawn as boxes joined left to right,
// the chosen step's rules — its approvers, an optional condition on the request's data, "opens
// together with the previous step" — as a property sheet under them.
import { PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "cn";
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

/** One line of a property sheet: the name on the left, the control on the right. */
function Row({ label, children, align = "middle" }: { label: ReactNode; children: ReactNode; align?: "middle" | "top" }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className={cn("w-36 text-xs font-medium whitespace-normal text-muted-foreground md:w-44", align === "top" && "align-top pt-3.5")}>{label}</TableCell>
      <TableCell className="py-2 whitespace-normal">{children}</TableCell>
    </TableRow>
  );
}

/** A step box of the diagram and the 72px line that joins it to the next. */
function Connector({ parallel, label }: { parallel: boolean; label: string }) {
  return (
    <div className="flex w-[72px] shrink-0 items-center" aria-hidden>
      <span className="h-px flex-1 bg-input" />
      {parallel ? <span className="px-1 font-mono text-[0.625rem] text-faint" title={label}>‖</span> : null}
      <span className="h-px flex-1 bg-input" />
      <span className="border-y-4 border-l-[6px] border-y-transparent border-l-input" />
    </div>
  );
}

export function FlowEditor({ options, flow }: { options: Options; flow?: { id: string; requestType: string; entityId: string | null; active: boolean; definition: FlowDefinition } }) {
  const t = useTranslations("approvals.flows");
  const tRoles = useTranslations("roles");
  const tTypes = useTranslations("approvals.types");
  const [requestType, setRequestType] = useState(flow?.requestType ?? options.requestTypes[0]?.type ?? "");
  const [entityId, setEntityId] = useState(flow?.entityId ?? (options.canGroup ? "" : (options.entities[0]?.id ?? "")));
  const [active, setActive] = useState(flow?.active ?? true);
  const [steps, setSteps] = useState<EditableStep[]>(() => (flow ? flow.definition.steps.map((step) => ({ ...step, approvers: [...step.approvers] })) : [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }]));
  const [selected, setSelected] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const fields = options.requestTypes.find((entry) => entry.type === requestType)?.conditionFields ?? [];
  const index = Math.min(selected, steps.length - 1);
  const step = steps[index];

  const patch = (at: number, change: Partial<EditableStep>) => setSteps((current) => current.map((item, position) => (position === at ? { ...item, ...change } : item)));
  const patchRule = (at: number, ruleIndex: number, rule: ApproverRule) => patch(at, { approvers: steps[at].approvers.map((existing, position) => (position === ruleIndex ? rule : existing)) });
  const ruleName = (rule: ApproverRule) => {
    if (rule.rule === "manager_level") return `${t("rules.manager_level")} (${rule.level})`;
    if (rule.rule === "permission") return rule.permission;
    if (rule.rule === "role") return tRoles.has(rule.role) ? tRoles(rule.role as "owner") : rule.role;
    if (rule.rule === "person") return options.people.find((person) => person.id === rule.personId)?.fullName ?? t("rules.person");
    return t(`rules.${rule.rule}`);
  };

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
        definition: JSON.stringify({ steps: steps.map((item, at) => ({ key: item.key, mode: item.mode, approvers: item.approvers, ...(item.condition ? { condition: item.condition } : {}), ...(item.parallel && at > 0 ? { parallel: true } : {}) })) }),
      }),
    );
  const addStep = () => {
    setSteps([...steps, { key: `step_${steps.length + 1}`, mode: "any", approvers: [{ rule: "department_head" }] }]);
    setSelected(steps.length);
  };
  const removeStep = (at: number) => {
    setSteps(steps.filter((_, position) => position !== at));
    setSelected(Math.max(0, at - 1));
  };

  return (
    <div className="flex flex-col gap-4">
      <Table numbered={false}>
        <TableBody>
          <Row label={t("requestType")}>
            <Select value={requestType} disabled={!!flow} onChange={(event) => setRequestType(event.target.value)} className="md:max-w-sm">
              {options.requestTypes.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.name ?? (tTypes.has(entry.type) ? tTypes(entry.type as "profile_change") : entry.type)}
                </option>
              ))}
            </Select>
          </Row>
          <Row label={t("entity")}>
            <Select value={entityId} disabled={!!flow} onChange={(event) => setEntityId(event.target.value)} className="md:max-w-sm">
              {options.canGroup ? <option value="">{t("group")}</option> : null}
              {options.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Row>
          <Row label={t("active")}>
            <Label className="h-9 cursor-pointer gap-2.5 font-normal">
              <Checkbox checked={active} onCheckedChange={(on) => setActive(on)} />
              {active ? t("activeOn") : t("off")}
            </Label>
          </Row>
        </TableBody>
      </Table>

      <div className="rounded-[14px] border border-border bg-canvas">
        <ol className="flex items-stretch overflow-x-auto p-4">
          {steps.map((item, at) => {
            const on = at === index;
            return (
              <li key={at} className="flex shrink-0 items-center">
                {at > 0 ? <Connector parallel={!!item.parallel} label={t("parallel")} /> : null}
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected(at)}
                  className={cn(
                    "press flex h-full w-[200px] flex-col gap-1 rounded-[10px] border bg-background p-3.5 text-left transition-[border-color,box-shadow] duration-100",
                    on ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-input",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
                    <span className="font-mono text-[0.6875rem] font-medium text-faint">{at + 1}</span>
                    <span className="truncate">{item.key || t("stepKey", { number: at + 1 })}</span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{item.approvers.map(ruleName).join(item.mode === "all" ? " + " : " / ")}</span>
                  {item.condition ? <span className="truncate font-mono text-[0.6875rem] text-faint">{`${item.condition.field} ${t(`ops.${item.condition.op}`)} ${Array.isArray(item.condition.value) ? item.condition.value.join(", ") : String(item.condition.value)}`}</span> : null}
                </button>
              </li>
            );
          })}
          {steps.length < 8 ? (
            <li className="flex shrink-0 items-center">
              <Connector parallel={false} label="" />
              <button type="button" onClick={addStep} className="press flex h-full min-h-[4.5rem] w-[200px] items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-input text-[0.8125rem] font-medium text-muted-foreground hover:bg-background hover:text-foreground [&_svg]:size-4">
                <PlusIcon aria-hidden />
                {t("addStep")}
              </button>
            </li>
          ) : null}
        </ol>
      </div>

      {step ? (
        <Table numbered={false}>
          <TableBody>
            <Row label={t("stepKey", { number: index + 1 })}>
              <Input value={step.key} maxLength={40} onChange={(event) => patch(index, { key: event.target.value })} className="font-mono md:max-w-xs" />
            </Row>
            <Row label={t("mode")}>
              <Select value={step.mode} onChange={(event) => patch(index, { mode: event.target.value as "any" | "all" })} className="md:max-w-xs">
                <option value="any">{t("modeAny")}</option>
                <option value="all">{t("modeAll")}</option>
              </Select>
            </Row>
            {index > 0 ? (
              <Row label={t("parallel")}>
                <Label className="h-9 cursor-pointer gap-2.5 font-normal">
                  <Checkbox checked={!!step.parallel} onCheckedChange={(on) => patch(index, { parallel: on })} />
                  {step.parallel ? t("yes") : t("no")}
                </Label>
              </Row>
            ) : null}
            <Row label={t("approvers")} align="top">
              <div className="flex flex-col gap-2">
                {step.approvers.map((rule, ruleIndex) => (
                  <div key={ruleIndex} className="flex flex-wrap items-center gap-2">
                    <Select className="w-full sm:w-56" value={rule.rule} onChange={(event) => patchRule(index, ruleIndex, blankRule(event.target.value as (typeof RULES)[number], options))}>
                      {RULES.map((name) => (
                        <option key={name} value={name}>
                          {t(`rules.${name}`)}
                        </option>
                      ))}
                    </Select>
                    {rule.rule === "manager_level" ? <Input className="w-20 font-mono" type="number" min={1} max={6} value={rule.level} onChange={(event) => patchRule(index, ruleIndex, { rule: "manager_level", level: Number(event.target.value) })} /> : null}
                    {rule.rule === "permission" ? (
                      <Select className="w-full sm:w-56" value={rule.permission} onChange={(event) => patchRule(index, ruleIndex, { rule: "permission", permission: event.target.value })}>
                        {options.permissions.map((permission) => (
                          <option key={permission}>{permission}</option>
                        ))}
                      </Select>
                    ) : null}
                    {rule.rule === "role" ? (
                      <Select className="w-full sm:w-56" value={rule.role} onChange={(event) => patchRule(index, ruleIndex, { rule: "role", role: event.target.value })}>
                        {options.roles.map((role) => (
                          <option key={role} value={role}>
                            {tRoles.has(role) ? tRoles(role as "owner") : role}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    {rule.rule === "person" ? (
                      <Select className="w-full sm:w-64" value={rule.personId} onChange={(event) => patchRule(index, ruleIndex, { rule: "person", personId: event.target.value })}>
                        {options.people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.fullName}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    {step.approvers.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("remove")} onClick={() => patch(index, { approvers: step.approvers.filter((_, position) => position !== ruleIndex) })}>
                        <XIcon aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <div>
                  <Button type="button" variant="outline" size="xs" onClick={() => patch(index, { approvers: [...step.approvers, { rule: "department_head" }] })}>
                    <PlusIcon aria-hidden />
                    {t("addApprover")}
                  </Button>
                </div>
              </div>
            </Row>
            <Row label={t("condition")} align="top">
              <div className="flex flex-col gap-2">
                <Label className="h-9 cursor-pointer gap-2.5 font-normal">
                  <Checkbox checked={!!step.condition} onCheckedChange={(on) => patch(index, { condition: on ? { field: fields[0] ?? "days", op: "gt", value: 3 } : undefined })} />
                  {step.condition ? t("conditionOn") : t("conditionOff")}
                </Label>
                {step.condition ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="w-36 font-mono" list={`fields-${index}`} value={step.condition.field} onChange={(event) => patch(index, { condition: { ...step.condition!, field: event.target.value } })} />
                    <datalist id={`fields-${index}`}>
                      {fields.map((field) => (
                        <option key={field} value={field} />
                      ))}
                    </datalist>
                    <Select className="w-28" value={step.condition.op} onChange={(event) => patch(index, { condition: { ...step.condition!, op: event.target.value as Condition["op"], value: conditionValue(event.target.value as Condition["op"], String(step.condition!.value)) } })}>
                      {OPS.map((op) => (
                        <option key={op} value={op}>
                          {t(`ops.${op}`)}
                        </option>
                      ))}
                    </Select>
                    <Input className="w-36 font-mono" defaultValue={Array.isArray(step.condition.value) ? step.condition.value.join(", ") : String(step.condition.value)} onChange={(event) => patch(index, { condition: { ...step.condition!, value: conditionValue(step.condition!.op, event.target.value) } })} />
                  </div>
                ) : null}
              </div>
            </Row>
            {steps.length > 1 ? (
              <Row label="">
                <Button type="button" variant="destructive" size="xs" onClick={() => removeStep(index)}>
                  {t("removeStep")}
                </Button>
              </Row>
            ) : null}
          </TableBody>
        </Table>
      ) : null}

      {errorKey ? <Alert variant="destructive">{t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}` as "errors.generic") : t("errors.generic")}</Alert> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved ? <span className="mr-auto text-xs text-success">{t("saved")}</span> : null}
        {flow ? (
          <ConfirmButton variant="outline" disabled={pending} label={t("delete")} question={t("deleteConfirm")} onConfirm={() => run(() => deleteFlowAction({ id: flow.id }))} />
        ) : null}
        <Button type="button" disabled={pending} onClick={save}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
