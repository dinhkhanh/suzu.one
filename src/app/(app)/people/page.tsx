import { getLocale, getTranslations } from "next-intl/server";
import Form from "next/form";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { statusTone } from "@/components/ui/tone";
import { PERSON_STATUSES, WORKFORCE_TYPES } from "@/modules/core-hr/enums";
import { canBrowsePeople, canFilterByPersonalFacts } from "@/modules/core-hr/policy";
import { competencyChoices, listPeople, listSavedViews, type PeopleFilters, peopleModuleOpen } from "@/modules/core-hr/service";
import { PersonAvatar } from "@/modules/core-hr/ui/person-avatar";
import { SavedViews } from "@/modules/core-hr/ui/saved-views";
import { exportPeopleAction } from "@/modules/core-hr/export-actions";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";
import { jobTitle } from "@/lib/job-levels";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("people");

const STATUSES = [...PERSON_STATUSES, "all"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PeoplePage(props: PageProps<"/people">) {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user))) notFound();
  // Collaborators have no directory; their own profile is the whole module for them.
  if (!canBrowsePeople(user.principal)) redirect(`/people/${user.person.id}`);

  const t = await getTranslations("people");
  const query = await props.searchParams;
  const one = (key: string) => (typeof query[key] === "string" && query[key] !== "" ? (query[key] as string) : undefined);
  const personalFacts = canFilterByPersonalFacts(user.principal);

  const filters: PeopleFilters = {
    q: one("q")?.slice(0, 100),
    entityId: UUID.test(one("entityId") ?? "") ? one("entityId") : undefined,
    departmentId: UUID.test(one("departmentId") ?? "") ? one("departmentId") : undefined,
    competencyId: UUID.test(one("competencyId") ?? "") ? one("competencyId") : undefined,
    workforceType: personalFacts ? WORKFORCE_TYPES.find((value) => value === one("workforceType")) : undefined,
    status: personalFacts ? STATUSES.find((value) => value === one("status")) : undefined,
    page: Number.parseInt(one("page") ?? "1", 10) || 1,
  };
  // What a saved view stores, and what the pager carries from page to page.
  const activeFilters = Object.fromEntries(
    Object.entries({ ...filters, page: undefined }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  const [{ rows, total, pageSize }, entities, departments, views, competencies] = await Promise.all([
    listPeople(user.principal, filters),
    listEntities(),
    unitChoices(),
    listSavedViews(user.person.id, "people"),
    competencyChoices(),
  ]);
  const page = filters.page ?? 1;
  const [te, locale] = await Promise.all([getTranslations("exports"), getLocale()]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (target: number) => `/people?${new URLSearchParams({ ...activeFilters, page: String(target) })}`;

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("count", { count: total })}
        actions={
          <>
            <ExportButton action={exportPeopleAction} input={{ ...activeFilters, locale }} label={te("button")} failedLabel={te("failed")} truncatedLabel={te("truncated")} />
            <Link href="/people/org-chart" className={cn(buttonVariants({ variant: "outline" }))}>
              {t("orgChart.title")}
            </Link>
            {can(user.principal, "person:manage") ? (
              <>
                <Link href="/people/competencies" className={cn(buttonVariants({ variant: "outline" }))}>
                  {t("competencies.title")}
                </Link>
                <Link href="/people/import" className={cn(buttonVariants({ variant: "outline" }))}>
                  {t("import.title")}
                </Link>
                <Link href="/people/new" className={cn(buttonVariants())}>
                  {t("hire.title")}
                </Link>
              </>
            ) : null}
          </>
        }
      />

      <Form action="/people" className="toolbar">
        <Input name="q" defaultValue={filters.q} placeholder={t("filters.search")} aria-label={t("filters.search")} className="w-full sm:w-64" />
        <Select name="entityId" defaultValue={filters.entityId ?? ""} aria-label={t("fields.entity")} className="w-auto">
          <option value="">{t("filters.allEntities")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName}
            </option>
          ))}
        </Select>
        <Select name="departmentId" defaultValue={filters.departmentId ?? ""} aria-label={t("fields.department")} className="w-auto">
          <option value="">{t("filters.allDepartments")}</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        {competencies.profession.length + competencies.skill.length > 0 ? (
          <Select name="competencyId" defaultValue={filters.competencyId ?? ""} aria-label={t("competencies.title")} className="w-auto" searchable>
            <option value="">{t("filters.allCompetencies")}</option>
            <optgroup label={t("competencies.profession")}>
              {competencies.profession.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("competencies.skill")}>
              {competencies.skill.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </Select>
        ) : null}
        {personalFacts ? (
          <>
            <Select name="workforceType" defaultValue={filters.workforceType ?? ""} aria-label={t("fields.workforceType")} className="w-auto">
              <option value="">{t("filters.allTypes")}</option>
              {WORKFORCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`workforceType.${value}`)}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={filters.status && filters.status !== "active" ? filters.status : ""} aria-label={t("fields.status")} className="w-auto">
              {STATUSES.map((value) => (
                <option key={value} value={value === "active" ? "" : value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <Button type="submit" variant="outline">
          {t("filters.apply")}
        </Button>
        {Object.keys(activeFilters).length > 0 ? (
          <Link href="/people" className={cn(buttonVariants({ variant: "ghost" }))}>
            {t("filters.clear")}
          </Link>
        ) : null}
      </Form>

      <SavedViews views={views.map(({ id, name, filters }) => ({ id, name, filters }))} currentFilters={activeFilters} />

      <TableCard>
        <Table numberFrom={(page - 1) * pageSize + 1}>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("fields.employeeCode")}</TableHead>
              <TableHead kind="text">{t("fields.fullName")}</TableHead>
              <TableHead kind="text">{t("fields.jobTitle")}</TableHead>
              <TableHead kind="text">{t("fields.position")}</TableHead>
              <TableHead kind="org">{t("fields.department")}</TableHead>
              <TableHead kind="org">{t("fields.entity")}</TableHead>
              <TableHead kind="person">{t("fields.managerId")}</TableHead>
              {personalFacts ? <TableHead kind="select">{t("fields.workforceType")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell kind="id">{row.employeeCode ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <PersonAvatar person={row} />
                    <div className="min-w-0 leading-tight">
                      <RecordLink kind="person" id={row.id} className="font-medium">
                        {row.fullName}
                      </RecordLink>
                      <p className="truncate text-xs text-faint">{row.workEmail ?? "—"}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{jobTitle(t, row) ?? "—"}</TableCell>
                <TableCell>{row.positionName ?? "—"}</TableCell>
                <TableCell>{row.departmentName ? <RecordLink kind="unit" id={row.departmentId}>{row.departmentName}</RecordLink> : "—"}</TableCell>
                <TableCell>{row.entityName ? <RecordLink kind="entity" id={row.entityId}>{row.entityName}</RecordLink> : "—"}</TableCell>
                <TableCell>{row.managerName ? <RecordLink kind="person" id={row.managerId}>{row.managerName}</RecordLink> : "—"}</TableCell>
                {personalFacts ? (
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {row.workforceType ? <Badge variant="secondary">{t(`workforceType.${row.workforceType}`)}</Badge> : "—"}
                      {row.status && row.status !== "active" ? <Badge dot variant={statusTone(row.status)}>{t(`status.${row.status}`)}</Badge> : null}
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {can(user.principal, "person:manage") ? <TableAddRow label={t("hire.title")} href="/people/new" /> : null}
      </TableCard>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t("pager.page", { page, pageCount })}</span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {t("pager.previous")}
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link href={pageHref(page + 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {t("pager.next")}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </Page>
  );
}
