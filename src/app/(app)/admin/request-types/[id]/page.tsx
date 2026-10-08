import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import type { FlowDefinition } from "@/modules/platform/approvals/engine/flow";
import { FLOW_PERMISSIONS, listFlows } from "@/modules/platform/approvals/flows";
import { FlowEditor } from "@/modules/platform/approvals/ui/flow-editor";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";
import { ROLES } from "@/modules/platform/rbac/roles";
import { conditionFieldsOf } from "@/modules/requests/engine/form";
import { canManageRequestTypes } from "@/modules/requests/policy";
import { approvalTypeOf, findRequestType, listRequestTypes } from "@/modules/requests/service";
import { TypeDesigner } from "@/modules/requests/ui/type-designer";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("requestType");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One request type: its form, and — on the same screen — the flow it runs, edited by the approval
// engine's own editor against an ordinary `approval_flow` row.
export default async function RequestTypePage(props: PageProps<"/admin/request-types/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const type = UUID.test(id) ? await findRequestType(id) : null;
  if (!type || !canManageRequestTypes(user.principal, type.entityId)) notFound();

  const [t, entities, people, flows, types] = await Promise.all([getTranslations("requests.designer"), listEntities(), listPersonNames(), listFlows(), listRequestTypes()]);
  const approvalType = approvalTypeOf(type.code);
  const mine = flows.filter((flow) => flow.requestType === approvalType);
  const manageable = entities.filter((entity) => can(user.principal, "org:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const options = {
    requestTypes: [{ type: approvalType, conditionFields: conditionFieldsOf(type.form), name: type.nameVi }],
    entities: manageable,
    canGroup: can(user.principal, "org:manage", {}),
    people,
    roles: ROLES,
    permissions: FLOW_PERMISSIONS,
  };

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/admin/request-types" className="hover:text-foreground">
            {t("title")}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <span className="min-w-0 truncate">{type.nameVi}</span>
            <Badge dot variant={type.active ? "success" : "outline"}>
              {type.active ? t("on") : t("off")}
            </Badge>
          </span>
        }
        description={
          <>
            <span className="font-mono text-xs">{type.code}</span> · {t("editHint")}
          </>
        }
      />

      <TypeDesigner
        draft={{ ...type, form: type.form, slaEscalateTo: type.slaEscalateTo ?? null }}
        entities={manageable}
        canGroup={can(user.principal, "org:manage", {})}
        catalogue={types.map((row) => ({ code: row.code, nameVi: row.nameVi, nameEn: row.nameEn, followUps: row.followUps }))}
      />

      <Section title={t("flow")} count={mine.length}>
        <p className="-mt-1 text-sm text-muted-foreground">{t("flowHint")}</p>
        {mine.map((flow) => (
          <Card key={flow.id}>
            <CardHeader>
              <CardTitle>
                {flow.entityName ? (
                  <RecordLink kind="entity" id={flow.entityId}>
                    {flow.entityName}
                  </RecordLink>
                ) : (
                  t("wholeGroup")
                )}
              </CardTitle>
              <CardDescription>{flow.active ? t("flowOn") : t("off")}</CardDescription>
            </CardHeader>
            <CardContent>
              <FlowEditor options={options} flow={{ id: flow.id, requestType: flow.requestType, entityId: flow.entityId, active: flow.active, definition: flow.definition as FlowDefinition }} />
            </CardContent>
          </Card>
        ))}
        <TableCard>
          <TableAddRow label={t("addFlow")} open={mine.length === 0} className="border-t-0">
            <FlowEditor options={options} />
          </TableAddRow>
        </TableCard>
      </Section>
    </Page>
  );
}
