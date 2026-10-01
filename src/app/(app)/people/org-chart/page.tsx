import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { buildOrgTree, type OrgNode } from "@/modules/core-hr/engine/org-tree";
import { canBrowsePeople } from "@/modules/core-hr/policy";
import { listOrgChartPeople, type OrgChartPerson, peopleModuleOpen } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("orgChart");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Person({ node, dottedLabel, showEntity }: { node: OrgNode<OrgChartPerson>; dottedLabel: (name: string) => string; showEntity: boolean }) {
  const { person } = node;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <Link href={`/people/${person.id}`} className="font-medium hover:underline">
        {person.fullName}
      </Link>
      <span className="text-muted-foreground">{[person.positionName, person.departmentName, showEntity ? person.entityName : null].filter(Boolean).join(" · ")}</span>
      {node.headcount > 0 ? <span className="text-xs text-muted-foreground">({node.headcount})</span> : null}
      {person.dottedManagerName ? <span className="text-xs text-muted-foreground">{dottedLabel(person.dottedManagerName)}</span> : null}
    </span>
  );
}

// Native <details>: collapsible without client JavaScript, and it prints. The first two levels start open.
function Branch({ nodes, depth, ...rest }: { nodes: OrgNode<OrgChartPerson>[]; depth: number; dottedLabel: (name: string) => string; showEntity: boolean }) {
  return (
    <ul className={depth === 0 ? "flex flex-col gap-1" : "ml-3 flex flex-col gap-1 border-l border-border pl-4"}>
      {nodes.map((node) => (
        <li key={node.person.id} className="text-sm">
          {node.reports.length > 0 ? (
            <details open={depth < 2}>
              <summary className="cursor-pointer py-0.5">
                <Person node={node} {...rest} />
              </summary>
              <Branch nodes={node.reports} depth={depth + 1} {...rest} />
            </details>
          ) : (
            <div className="py-0.5 pl-4">
              <Person node={node} {...rest} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function OrgChartPage(props: PageProps<"/people/org-chart">) {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user)) || !canBrowsePeople(user.principal)) notFound();
  const query = await props.searchParams;
  const entityId = typeof query.entityId === "string" && UUID.test(query.entityId) ? query.entityId : undefined;

  const [people, entities, t] = await Promise.all([listOrgChartPeople(user.principal, entityId), listEntities(), getTranslations("people")]);
  const tree = buildOrgTree(people);

  return (
    <Page>
      <PageHeader
        title={t("orgChart.title")}
        description={t("orgChart.description", { count: people.length })}
        actions={
          <Link href="/people" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("orgChart.backToList")}
          </Link>
        }
      />
      <form method="get" className="toolbar">
        <div className="w-64">
          <Select name="entityId" defaultValue={entityId ?? ""} aria-label={t("fields.entity")}>
            <option value="">{t("orgChart.wholeGroup")}</option>
            {entities.filter((entity) => entity.isActive).map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.shortName}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          {t("filters.apply")}
        </Button>
      </form>
      <Card>
        <CardContent>{tree.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : <Branch nodes={tree} depth={0} dottedLabel={(name) => t("orgChart.dottedLine", { name })} showEntity={!entityId} />}</CardContent>
      </Card>
    </Page>
  );
}
