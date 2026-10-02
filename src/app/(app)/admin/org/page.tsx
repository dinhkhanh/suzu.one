import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { cn } from "cn";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { commitDepartmentImportAction, stageDepartmentImportAction } from "@/modules/platform/org/actions";
import { flattenTree, type TreeNode } from "@/modules/platform/org/engine/tree";
import { departmentTemplate } from "@/modules/platform/org/import";
import { listEntities, orgUnitTree } from "@/modules/platform/org/service";
import { OrgUnitForm } from "@/modules/platform/org/ui/org-forms";
import { UnitPicker } from "@/modules/platform/org/ui/unit-picker";
import { can } from "@/modules/platform/rbac/policy";
import { listRoleAssignments } from "@/modules/platform/rbac/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("orgUnits");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The tree, one row per unit: 30px tall, 16px further in for every level down, a chevron on the
// ones that hold others, the count of what they hold in mono. The open unit is washed in the accent.
function TreeRows({ nodes, selected, depth = 0 }: { nodes: TreeNode[]; selected: string; depth?: number }) {
  return (
    <>
      {nodes.map((node) => {
        const open = node.id === selected;
        const Chevron = node.children.length ? (node.path.includes(selected) ? ChevronDownIcon : ChevronRightIcon) : null;
        return (
          <li key={node.id}>
            <Link
              href={`/admin/org?unit=${node.id}`}
              aria-current={open ? "page" : undefined}
              className={cn(
                "press flex h-[30px] items-center gap-1.5 rounded-[7px] pr-2 text-[0.8125rem] transition-colors duration-100",
                open ? "bg-primary/8 font-medium text-primary" : "text-foreground hover:bg-canvas",
                !node.isActive && !open && "text-faint",
              )}
              style={{ paddingInlineStart: `${depth * 16 + 6}px` }}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-faint [&_svg]:size-3.5">{Chevron ? <Chevron aria-hidden /> : null}</span>
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {node.children.length ? <span className={cn("font-mono text-[0.6875rem] tabular-nums", open ? "text-primary/70" : "text-faint")}>{node.children.length}</span> : null}
            </Link>
            {node.children.length ? (
              <ul>
                <TreeRows nodes={node.children} selected={selected} depth={depth + 1} />
              </ul>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

export default async function OrgPage(props: PageProps<"/admin/org">) {
  const user = await requireUser();
  if (!can(user.principal, "org:read")) notFound();

  const [t, roleName, tRbac, format] = await Promise.all([getTranslations("org"), getTranslations("roles"), getTranslations("rbac"), getFormatter()]);
  const [tree, entities] = await Promise.all([orgUnitTree(), listEntities()]);
  const units = flattenTree(tree);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const query = await props.searchParams;
  const wanted = typeof query.unit === "string" && UUID.test(query.unit) ? byId.get(query.unit) : undefined;
  const unit = wanted ?? units[0];

  // A shared unit belongs to the group; an entity's own to whoever manages that entity — and a
  // grant over a unit reaches everything below it.
  const canManage = (target: { entityId: string | null; path: readonly string[] }) => can(user.principal, "org:manage", target.entityId ? { entityId: target.entityId, unitPath: target.path } : { unitPath: target.path });
  const manageableEntities = entities.filter((entity) => can(user.principal, "org:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const canShare = can(user.principal, "org:manage", {});
  const canAdd = canShare || manageableEntities.length > 0;
  const parents = units.filter((item) => item.isActive).map(({ id, name, depth, path }) => ({ id, name, depth, path }));
  const canSeeRoles = can(user.principal, "rbac:manage", {});
  // The grants that name this unit as their scope.
  const grants = unit && canSeeRoles ? (await listRoleAssignments()).filter((grant) => grant.scopeType === "unit" && grant.scopeId === unit.id) : [];
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });

  const addRow = (parentId?: string) =>
    canAdd ? (
      <TableAddRow label={parentId && unit ? t("addInside", { name: unit.name }) : t("addUnit")} open={units.length === 0}>
        <OrgUnitForm parents={parents} entities={manageableEntities} canShare={canShare} defaultParentId={parentId} />
      </TableAddRow>
    ) : null;

  const treePane = (
    <nav aria-label={t("tree")} className="flex min-w-0 flex-col gap-2">
      <p className="section-label px-1.5">{t("tree")}</p>
      <ul className="flex flex-col gap-px">
        <TreeRows nodes={tree} selected={unit?.id ?? ""} />
      </ul>
      {canAdd ? (
        <TableCard className="mt-2">
          {addRow()}
        </TableCard>
      ) : null}
    </nav>
  );

  if (!unit) {
    return (
      <Page>
        <PageHeader title={t("title")} description={t("description")} />
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("code")}</TableHead>
                <TableHead kind="org">{t("name")}</TableHead>
                <TableHead kind="select">{t("kind")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableEmpty>{t("empty")}</TableEmpty>
            </TableBody>
          </Table>
          {addRow()}
        </TableCard>
        {canShare ? <ImportWizard title={t("importTitle")} template={{ fileName: "departments.csv", csv: departmentTemplate() }} stageAction={stageDepartmentImportAction} commitAction={commitDepartmentImportAction} /> : null}
      </Page>
    );
  }

  const ancestors = unit.path.slice(0, -1).map((id) => byId.get(id)).filter((item): item is TreeNode => !!item);
  const parent = ancestors.at(-1);
  const manage = canManage(unit);
  const inside = flattenTree(unit.children).length;
  const facts: { label: string; value: ReactNode }[] = [
    { label: t("code"), value: unit.code ? <span className="font-mono text-[0.8125rem]">{unit.code}</span> : <span className="text-faint">—</span> },
    { label: t("kind"), value: <Badge variant="outline">{t(`kinds.${unit.kind}`)}</Badge> },
    { label: t("parent"), value: parent ? <Link href={`/admin/org?unit=${parent.id}`} className="text-link hover:underline">{parent.name}</Link> : <span className="text-muted-foreground">{t("noParent")}</span> },
    { label: t("belongsTo"), value: unit.entityId ? <RecordLink kind="entity" id={unit.entityId}>{entityName.get(unit.entityId) ?? "—"}</RecordLink> : <Badge variant="secondary">{t("shared")}</Badge> },
    { label: t("path"), value: <span className="font-mono text-xs text-faint">{[...ancestors, unit].map((item) => item.code ?? item.name).join(" / ")}</span> },
    { label: t("unitsInside"), value: <span className="font-mono text-[0.8125rem] tabular-nums">{unit.children.length}</span> },
  ];

  const unitPage = (
    <div className="flex min-w-0 flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground">
          <span>{t("title")}</span>
          {ancestors.map((item) => (
            <span key={item.id} className="contents">
              <span className="text-faint">›</span>
              <Link href={`/admin/org?unit=${item.id}`} className="hover:text-foreground">
                {item.name}
              </Link>
            </span>
          ))}
        </p>
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted font-mono text-[0.6875rem] font-medium tracking-tight text-muted-foreground">{unit.code ?? unit.name.slice(0, 2).toUpperCase()}</span>
          <h1 className="min-w-0 flex-1 truncate">{unit.name}</h1>
          <Badge dot variant={unit.isActive ? "success" : "outline"}>{unit.isActive ? t("active") : t("inactive")}</Badge>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Table numbered={false}>
          <TableBody>
            {facts.map((fact) => (
              <TableRow key={fact.label}>
                <TableCell className="w-40 text-xs font-medium text-muted-foreground">{fact.label}</TableCell>
                <TableCell className="whitespace-normal">{fact.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("reach.title")}</CardTitle>
            <CardDescription>{t("reach.body", { name: unit.name, count: inside })}</CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {t.rich("reach.optOut", { code: (chunks) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">{chunks}</code>, id: `unit_only:${unit.code ?? unit.id}` })}
          </CardContent>
        </Card>
      </div>

      <Section title={t("unitsInside")} count={unit.children.length}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("code")}</TableHead>
                <TableHead kind="org">{t("name")}</TableHead>
                <TableHead kind="select">{t("kind")}</TableHead>
                <TableHead kind="number">{t("unitsInside")}</TableHead>
                <TableHead kind="status">{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unit.children.length === 0 ? <TableEmpty>{t("noChildren")}</TableEmpty> : null}
              {unit.children.map((child) => (
                <TableRow key={child.id}>
                  <TableCell kind="id">{child.code ?? "—"}</TableCell>
                  <TableCell>
                    <Link href={`/admin/org?unit=${child.id}`} className="font-medium hover:underline">
                      {child.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`kinds.${child.kind}`)}</Badge>
                  </TableCell>
                  <TableCell kind="number">{child.children.length || <span className="text-faint">—</span>}</TableCell>
                  <TableCell>
                    <Badge dot variant={child.isActive ? "success" : "outline"}>{child.isActive ? t("active") : t("inactive")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {manage ? addRow(unit.id) : null}
        </TableCard>
      </Section>

      {canSeeRoles ? (
        <Section title={t("rolesOnUnit")} count={grants.length} action={<Link href="/admin/roles">{tRbac("title")}</Link>}>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="person">{tRbac("person")}</TableHead>
                  <TableHead kind="select">{tRbac("role")}</TableHead>
                  <TableHead kind="date">{tRbac("period")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.length === 0 ? <TableEmpty>{t("noRoles")}</TableEmpty> : null}
                {grants.map((grant) => (
                  <TableRow key={grant.id}>
                    <TableCell>
                      <RecordLink kind="person" id={grant.personId} className="font-medium">
                        {grant.personName}
                      </RecordLink>
                    </TableCell>
                    <TableCell>{roleName.has(grant.role) ? roleName(grant.role) : grant.role}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {day(grant.validFrom)} → {grant.validTo ? day(grant.validTo) : "…"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      {manage ? (
        <Section title={t("edit")}>
          <Card>
            <CardContent>
              <OrgUnitForm unit={unit} parents={parents} entities={manageableEntities} />
            </CardContent>
          </Card>
        </Section>
      ) : null}

      {canShare ? <ImportWizard title={t("importTitle")} template={{ fileName: "departments.csv", csv: departmentTemplate() }} stageAction={stageDepartmentImportAction} commitAction={commitDepartmentImportAction} /> : null}
    </div>
  );

  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="md:hidden">
        <UnitPicker units={units.map(({ id, name, depth, path }) => ({ id, name, depth, path }))} value={unit.id} />
      </div>
      <div className="grid gap-8 md:grid-cols-[300px_minmax(0,1fr)] md:gap-10">
        <div className="hidden md:block">{treePane}</div>
        {unitPage}
      </div>
      {canAdd ? <TableCard className="md:hidden">{addRow()}</TableCard> : null}
    </Page>
  );
}
