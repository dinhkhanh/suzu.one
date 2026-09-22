import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
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
import { conditionFieldsOf } from "@/modules/requests/engine/form";
import { canManageRequestTypes } from "@/modules/requests/policy";
import { approvalTypeOf, findRequestType } from "@/modules/requests/service";
import { TypeDesigner } from "@/modules/requests/ui/type-designer";

export const metadata: Metadata = { title: "Request type" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One request type: its form, and — on the same screen — the flow it runs, edited by the approval
// engine's own editor against an ordinary `approval_flow` row.
export default async function RequestTypePage(props: PageProps<"/admin/request-types/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const type = UUID.test(id) ? await findRequestType(id) : null;
  if (!type || !canManageRequestTypes(user.principal, type.entityId)) notFound();

  const [t, entities, people, flows] = await Promise.all([getTranslations("requests.designer"), listEntities(), listPersonNames(), listFlows()]);
  const approvalType = approvalTypeOf(type.code);
  const mine = flows.filter((flow) => flow.requestType === approvalType);
  const options = {
    requestTypes: [{ type: approvalType, conditionFields: conditionFieldsOf(type.form), name: type.nameVi }],
    entities: entities.filter((entity) => can(user.principal, "org:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName })),
    canGroup: can(user.principal, "org:manage", {}),
    people,
    roles: ROLES,
    permissions: FLOW_PERMISSIONS,
  };

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <Link href="/admin/request-types" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1>{type.nameVi}</h1>
          {type.active ? null : <Badge variant="outline">{t("off")}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{t("editHint")}</p>
      </header>

      <TypeDesigner
        draft={{ ...type, form: type.form, slaEscalateTo: type.slaEscalateTo ?? null }}
        entities={entities.filter((entity) => can(user.principal, "org:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }))}
        canGroup={can(user.principal, "org:manage", {})}
      />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("flow")}</h2>
          <p className="text-xs text-muted-foreground">{t("flowHint")}</p>
        </div>
        {mine.map((flow) => (
          <div key={flow.id} className="rounded-xl border p-4">
            <p className="mb-3 text-sm font-medium">{flow.entityName ?? t("wholeGroup")}</p>
            <FlowEditor options={options} flow={{ id: flow.id, requestType: flow.requestType, entityId: flow.entityId, active: flow.active, definition: flow.definition as FlowDefinition }} />
          </div>
        ))}
        <div className="rounded-xl border p-4">
          <p className="mb-3 text-sm font-medium">{t("addFlow")}</p>
          <FlowEditor options={options} />
        </div>
      </section>
    </div>
  );
}
