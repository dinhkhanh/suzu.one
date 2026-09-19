import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PERSON_STATUSES, WORKFORCE_TYPES } from "@/modules/core-hr/enums";
import { canBrowsePeople, canFilterByPersonalFacts } from "@/modules/core-hr/policy";
import { listPeople, listSavedViews, type PeopleFilters } from "@/modules/core-hr/service";
import { SavedViews } from "@/modules/core-hr/ui/saved-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listDepartments, listEntities } from "@/modules/platform/org/service";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "People" };

const STATUSES = [...PERSON_STATUSES, "all"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PeoplePage(props: PageProps<"/people">) {
  const user = await requireUser();
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
    workforceType: personalFacts ? WORKFORCE_TYPES.find((value) => value === one("workforceType")) : undefined,
    status: personalFacts ? STATUSES.find((value) => value === one("status")) : undefined,
    page: Number.parseInt(one("page") ?? "1", 10) || 1,
  };
  // What a saved view stores, and what the pager carries from page to page.
  const activeFilters = Object.fromEntries(
    Object.entries({ ...filters, page: undefined }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  const [{ rows, total, pageSize }, entities, departments, views] = await Promise.all([
    listPeople(user.principal, filters),
    listEntities(),
    listDepartments(),
    listSavedViews(user.person.id, "people"),
  ]);
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (target: number) => `/people?${new URLSearchParams({ ...activeFilters, page: String(target) })}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
        </div>
        {can(user.principal, "person:manage") ? (
          <Link href="/people/new" className={buttonVariants()}>
            {t("hire.title")}
          </Link>
        ) : null}
      </header>

      <Form action="/people" className="flex flex-wrap items-end gap-2">
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
          <Link href="/people" className={buttonVariants({ variant: "ghost" })}>
            {t("filters.clear")}
          </Link>
        ) : null}
      </Form>

      <SavedViews views={views.map(({ id, name, filters }) => ({ id, name, filters }))} currentFilters={activeFilters} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("fields.employeeCode")}</TableHead>
            <TableHead>{t("fields.fullName")}</TableHead>
            <TableHead>{t("fields.position")}</TableHead>
            <TableHead>{t("fields.department")}</TableHead>
            <TableHead>{t("fields.entity")}</TableHead>
            <TableHead>{t("fields.managerId")}</TableHead>
            {personalFacts ? <TableHead>{t("fields.workforceType")}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={personalFacts ? 7 : 6} className="text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.employeeCode ?? "—"}</TableCell>
                <TableCell>
                  <Link href={`/people/${row.id}`} className="font-medium hover:underline">
                    {row.fullName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{row.workEmail ?? "—"}</p>
                </TableCell>
                <TableCell>{row.positionName ?? "—"}</TableCell>
                <TableCell>{row.departmentName ?? "—"}</TableCell>
                <TableCell>{row.entityName ?? "—"}</TableCell>
                <TableCell>{row.managerName ?? "—"}</TableCell>
                {personalFacts ? (
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {row.workforceType ? <Badge variant="secondary">{t(`workforceType.${row.workforceType}`)}</Badge> : "—"}
                      {row.status && row.status !== "active" ? <Badge variant="outline">{t(`status.${row.status}`)}</Badge> : null}
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pageCount > 1 ? (
        <nav className="flex items-center gap-2 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("pager.previous")}
            </Link>
          ) : null}
          <span className="text-muted-foreground">{t("pager.page", { page, pageCount })}</span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("pager.next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
