import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { FlowDefinition } from "@/modules/platform/approvals/engine/flow";
import { FLOW_PERMISSIONS, listFlows } from "@/modules/platform/approvals/flows";
import { FlowEditor } from "@/modules/platform/approvals/ui/flow-editor";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";
import { ROLES } from "@/modules/platform/rbac/roles";
import { REQUEST_TYPES } from "../../approvals/registry";

export const metadata: Metadata = { title: "Approval flows" };

// Who approves what (FR-PLT-20, 21). Every request type ships a default flow; a flow saved here
// replaces it for one entity or for the group. Requests already sent keep the flow they started with.
export default async function ApprovalFlowsPage() {
  const user = await requireUser();
  if (!can(user.principal, "org:manage")) notFound();
  const t = await getTranslations("approvals");
  const [flows, entities, people] = await Promise.all([listFlows(), listEntities(), listPersonNames()]);
  const options = {
    requestTypes: [...REQUEST_TYPES.values()].map(({ definition }) => ({ type: definition.type, conditionFields: definition.conditionFields ?? [] })),
    entities: entities.filter((entity) => can(user.principal, "org:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName })),
    canGroup: can(user.principal, "org:manage", {}),
    people,
    roles: ROLES,
    permissions: FLOW_PERMISSIONS,
  };
  const describe = (flow: FlowDefinition) =>
    flow.steps
      .map((step, index) => `${index === 0 ? "" : step.parallel ? " ‖ " : " → "}${step.approvers.map((rule) => t(`flows.rules.${rule.rule}` as "flows.rules.line_manager")).join(" + ")}${step.condition ? ` (${step.condition.field} ${t(`flows.ops.${step.condition.op}` as "flows.ops.eq")} ${String(step.condition.value)})` : ""}`)
      .join("");

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("flows.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("flows.description")}</p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("flows.defaults")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {[...REQUEST_TYPES.values()].map(({ definition }) => (
            <li key={definition.type} className="flex flex-wrap items-center gap-2 p-3">
              <span className="font-medium">{t.has(`types.${definition.type}`) ? t(`types.${definition.type}` as "types.profile_change") : definition.type}</span>
              <span className="text-muted-foreground">{describe(definition.flow)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("flows.configured")}</h2>
        {flows.length === 0 ? <p className="text-sm text-muted-foreground">{t("flows.none")}</p> : null}
        <ul className="flex flex-col gap-3">
          {flows.map((flow) => {
            const definition = flow.definition as FlowDefinition;
            const manage = can(user.principal, "org:manage", flow.entityId ? { entityId: flow.entityId } : {});
            return (
              <li key={flow.id} className="rounded-xl border p-4">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{t.has(`types.${flow.requestType}`) ? t(`types.${flow.requestType}` as "types.profile_change") : flow.requestType}</span>
                    <Badge variant="secondary">{flow.entityName ?? t("flows.group")}</Badge>
                    {flow.active ? null : <Badge variant="outline">{t("flows.off")}</Badge>}
                    <span className="text-muted-foreground">{describe(definition)}</span>
                  </summary>
                  {manage ? (
                    <div className="mt-4">
                      <FlowEditor options={options} flow={{ id: flow.id, requestType: flow.requestType, entityId: flow.entityId, active: flow.active, definition }} />
                    </div>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-medium">{t("flows.add")}</h2>
        <FlowEditor options={options} />
      </section>
    </div>
  );
}
