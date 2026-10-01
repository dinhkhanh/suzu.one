import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { findEntity, listBranches } from "@/modules/platform/org/service";
import { BranchForm, EditEntityForm } from "@/modules/platform/org/ui/entity-forms";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("entity");

export default async function EntityPage({ params }: PageProps<"/admin/entities/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [entity, allBranches, t] = await Promise.all([findEntity(id), listBranches(), getTranslations("entities")]);
  if (!entity || !can(user.principal, "org:read", { entityId: entity.id })) notFound();

  const canManage = can(user.principal, "org:manage", { entityId: entity.id });
  const branches = allBranches.filter((branch) => branch.entityId === entity.id);
  const facts: [string, string | null, boolean?][] = [
    [t("legalName"), entity.legalName],
    [t("legalRepresentative"), entity.legalRepresentative],
    [t("taxCode"), entity.taxCode, true],
    [t("insuranceUnitCode"), entity.insuranceUnitCode, true],
    [t("wageRegion"), entity.wageRegion ? t("wageRegionValue", { region: entity.wageRegion }) : null],
    [t("address"), entity.address],
  ];

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/admin/entities" className="hover:text-foreground">
            {t("title")}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted font-mono text-[0.6875rem] font-medium tracking-tight text-muted-foreground">{entity.code}</span>
            <span className="min-w-0 truncate">{entity.shortName}</span>
            <Badge dot variant={entity.isActive ? "success" : "outline"}>{entity.isActive ? t("active") : t("inactive")}</Badge>
          </span>
        }
        description={entity.legalName}
      />

      {canManage ? (
        <Section title={t("details")}>
          <Card>
            <CardContent>
              <EditEntityForm entity={entity} />
            </CardContent>
          </Card>
        </Section>
      ) : (
        <Section title={t("details")}>
          <Table numbered={false}>
            <TableBody>
              {facts.map(([label, value, mono]) => (
                <TableRow key={label}>
                  <TableCell className="w-48 text-xs font-medium text-muted-foreground">{label}</TableCell>
                  <TableCell className={mono ? "font-mono text-[0.8125rem]" : "whitespace-normal"}>{value ?? <span className="text-faint">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      <Section title={t("branches")} count={branches.length}>
        <TableCard>
          {canManage ? (
            <List>
              {branches.map((branch) => (
                <ListItem key={branch.id} className="py-3">
                  <BranchForm entityId={entity.id} branch={branch} />
                </ListItem>
              ))}
            </List>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="place">{t("branchName")}</TableHead>
                  <TableHead kind="text">{t("address")}</TableHead>
                  <TableHead kind="status">{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.length === 0 ? <TableEmpty>{t("noBranches")}</TableEmpty> : null}
                {branches.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">{branch.name}</TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{branch.address ?? "—"}</TableCell>
                    <TableCell>
                      <Badge dot variant={branch.isActive ? "success" : "outline"}>{branch.isActive ? t("active") : t("inactive")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canManage && branches.length === 0 ? <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t("noBranches")}</p> : null}
          {canManage ? (
            <TableAddRow label={t("addBranch")} open={branches.length === 0}>
              <BranchForm entityId={entity.id} />
            </TableAddRow>
          ) : null}
        </TableCard>
      </Section>
    </Page>
  );
}
