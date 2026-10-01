import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FlowDefinition } from "@/modules/platform/approvals/engine/flow";
import { FLOW_PERMISSIONS, listFlows } from "@/modules/platform/approvals/flows";
import { FlowEditor } from "@/modules/platform/approvals/ui/flow-editor";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";
import { ROLES } from "@/modules/platform/rbac/roles";
import { allRequestTypes } from "../../approvals/registry";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("approvalFlows");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Who approves what (FR-PLT-20, 21). Every request type ships a default flow; a flow saved here
// replaces it for one entity or for the group. Requests already sent keep the flow they started with.
export default async function ApprovalFlowsPage(props: PageProps<"/admin/approval-flows">) {
  const user = await requireUser();
  if (!can(user.principal, "org:manage")) notFound();
  const t = await getTranslations("approvals");
  const [allFlows, entities, people, registered, query] = await Promise.all([listFlows(), listEntities(), listPersonNames(), allRequestTypes(), props.searchParams]);
  // Only the flows this administrator could save: an entity's own admin sees that entity's flows,
  // and the group's need a group grant — the same check as `saveFlowAction`.
  const flows = allFlows.filter((flow) => can(user.principal, "org:manage", flow.entityId ? { entityId: flow.entityId } : {}));
  const selected = typeof query.flow === "string" && UUID.test(query.flow) ? flows.find((flow) => flow.id === query.flow) : undefined;
  // The builder's types carry their own name; the ones in code are named in the message bundle.
  const label = (type: string) => registered.get(type)?.names?.vi ?? (t.has(`types.${type}`) ? t(`types.${type}` as "types.profile_change") : type);
  const options = {
    requestTypes: [...registered.values()].map(({ definition, names }) => ({ type: definition.type, conditionFields: definition.conditionFields ?? [], name: names?.vi })),
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
    <Page>
      <PageHeader title={t("flows.title")} description={t("flows.description")} />

      <Section title={t("flows.configured")} count={flows.length}>
        <TableCard>
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("flows.requestType")}</TableHead>
                <TableHead kind="org">{t("flows.entity")}</TableHead>
                <TableHead kind="text">{t("flows.steps")}</TableHead>
                <TableHead kind="status">{t("flows.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flows.length === 0 ? <TableEmpty>{t("flows.none")}</TableEmpty> : null}
              {flows.map((flow) => {
                const on = flow.id === selected?.id;
                return (
                  <TableRow key={flow.id} data-state={on ? "selected" : undefined}>
                    <TableCell className="font-medium">
                      <Link href={`/admin/approval-flows?flow=${flow.id}#flow`} className="hover:underline">
                        {label(flow.requestType)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={flow.entityId ? "info" : "secondary"}>{flow.entityName ?? t("flows.group")}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground" title={describe(flow.definition as FlowDefinition)}>
                      {describe(flow.definition as FlowDefinition)}
                    </TableCell>
                    <TableCell>
                      <Badge dot variant={flow.active ? "success" : "outline"}>{flow.active ? t("flows.active") : t("flows.off")}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TableAddRow label={t("flows.add")} open={flows.length === 0 && !selected}>
            <FlowEditor options={options} />
          </TableAddRow>
        </TableCard>
      </Section>

      {selected && can(user.principal, "org:manage", selected.entityId ? { entityId: selected.entityId } : {}) ? (
        <Section title={t("flows.edit")} id="flow">
          <Card>
            <CardHeader>
              <CardTitle>{label(selected.requestType)}</CardTitle>
              <CardDescription>{selected.entityName ?? t("flows.group")}</CardDescription>
            </CardHeader>
            <CardContent>
              <FlowEditor key={selected.id} options={options} flow={{ id: selected.id, requestType: selected.requestType, entityId: selected.entityId, active: selected.active, definition: selected.definition as FlowDefinition }} />
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <Section title={t("flows.defaults")} count={registered.size || null}>
        <TableCard>
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("flows.requestType")}</TableHead>
                <TableHead kind="text">{t("flows.steps")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...registered.values()].map(({ definition }) => (
                <TableRow key={definition.type}>
                  <TableCell className="font-medium">{label(definition.type)}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{describe(definition.flow)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>
    </Page>
  );
}
