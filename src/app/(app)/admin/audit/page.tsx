import { getFormatter, getTranslations } from "next-intl/server";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AUDIT_PAGE_SIZE, type AuditFilters, listAuditEntries, listAuditResourceTypes } from "@/modules/platform/audit/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { entityReach } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("auditLog");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const user = await requireUser();
  const reach = entityReach(user.principal, "audit:read");
  if (!reach.all && reach.entityIds.length === 0) notFound();

  const [t, format] = await Promise.all([getTranslations("audit"), getFormatter()]);
  const query = await props.searchParams;
  const one = (key: string) => (typeof query[key] === "string" && query[key] !== "" ? (query[key] as string) : undefined);

  const filters: AuditFilters = {
    action: one("action")?.slice(0, 80),
    actor: one("actor")?.slice(0, 120),
    resourceType: one("resourceType")?.slice(0, 60),
    resourceId: one("resourceId")?.slice(0, 80),
    entityId: UUID.test(one("entityId") ?? "") ? one("entityId") : undefined,
    from: DAY.test(one("from") ?? "") ? one("from") : undefined,
    to: DAY.test(one("to") ?? "") ? one("to") : undefined,
    page: Number.parseInt(one("page") ?? "1", 10) || 1,
  };
  const activeFilters = Object.fromEntries(Object.entries({ ...filters, page: undefined }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

  const [{ rows, total }, resourceTypes, allEntities] = await Promise.all([listAuditEntries(reach, filters), listAuditResourceTypes(), listEntities()]);
  const entities = allEntities.filter((entity) => reach.all || reach.entityIds.includes(entity.id));
  const entityName = new Map(allEntities.map((entity) => [entity.id, entity.shortName]));
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const pageHref = (target: number) => `/admin/audit?${new URLSearchParams({ ...activeFilters, page: String(target) })}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <Form action="/admin/audit" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input name="action" defaultValue={filters.action} placeholder={t("filters.action")} aria-label={t("filters.action")} />
        <Input name="actor" defaultValue={filters.actor} placeholder={t("filters.actor")} aria-label={t("filters.actor")} />
        <Select name="resourceType" defaultValue={filters.resourceType ?? ""} aria-label={t("filters.resourceType")}>
          <option value="">{t("filters.anyResource")}</option>
          {resourceTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Select name="entityId" defaultValue={filters.entityId ?? ""} aria-label={t("filters.entity")}>
          <option value="">{t("filters.anyEntity")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName}
            </option>
          ))}
        </Select>
        <Input name="from" type="date" defaultValue={filters.from} aria-label={t("filters.from")} />
        <Input name="to" type="date" defaultValue={filters.to} aria-label={t("filters.to")} />
        {filters.resourceId ? <input type="hidden" name="resourceId" value={filters.resourceId} /> : null}
        <div className="flex gap-2">
          <Button type="submit">{t("filters.apply")}</Button>
          <Link href="/admin/audit" className={buttonVariants({ variant: "ghost" })}>
            {t("filters.clear")}
          </Link>
        </div>
      </Form>

      <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>

      <ul className="flex flex-col divide-y rounded-xl border">
        {rows.length === 0 ? <li className="p-4 text-sm text-muted-foreground">{t("empty")}</li> : null}
        {rows.map((row) => {
          const hasDetail = row.before !== null || row.after !== null;
          const denied = row.action.endsWith(".denied") || row.action.endsWith(".rejected") || row.action.endsWith(".failed");
          return (
            <li key={String(row.id)} className="p-3 text-sm">
              <details>
                <summary className="grid cursor-pointer gap-x-4 gap-y-1 sm:grid-cols-[11rem_minmax(0,14rem)_minmax(0,1fr)]">
                  <time className="whitespace-nowrap text-muted-foreground" dateTime={row.occurredAt.toISOString()}>
                    {format.dateTime(row.occurredAt, { dateStyle: "short", timeStyle: "medium" })}
                  </time>
                  <span className={`truncate font-mono text-xs ${denied ? "text-destructive" : ""}`}>{row.action}</span>
                  <span className="truncate">
                    {row.actorEmail ?? t("system")}
                    {row.summary ? <span className="text-muted-foreground"> · {row.summary}</span> : null}
                  </span>
                </summary>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">{t("resource")}</dt>
                    <dd className="break-all">
                      {row.resourceType ? (
                        <Link className="hover:underline" href={`/admin/audit?${new URLSearchParams({ resourceType: row.resourceType, ...(row.resourceId ? { resourceId: row.resourceId } : {}) })}`}>
                          {row.resourceType} {row.resourceId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("filters.entity")}</dt>
                    <dd>{row.entityId ? (entityName.get(row.entityId) ?? row.entityId) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("ipAddress")}</dt>
                    <dd>{row.ipAddress ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("userAgent")}</dt>
                    <dd className="truncate" title={row.userAgent ?? undefined}>
                      {row.userAgent ?? "—"}
                    </dd>
                  </div>
                </dl>
                {hasDetail ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {(["before", "after"] as const).map((side) => (
                      <div key={side} className="min-w-0">
                        <p className="text-xs text-muted-foreground">{t(side)}</p>
                        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-2 text-xs">{row[side] === null ? "—" : JSON.stringify(row[side], null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
            </li>
          );
        })}
      </ul>

      {pageCount > 1 ? (
        <nav className="flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("previous")}
            </Link>
          ) : null}
          <span className="text-muted-foreground">{t("page", { page, pageCount })}</span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
