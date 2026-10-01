import { CpuIcon, XIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { AUDIT_PAGE_SIZE, type AuditFilters, listAuditEntries, listAuditResourceTypes } from "@/modules/platform/audit/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { entityReach } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("auditLog");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// One colour per kind of entry, read before the action's name is: what went wrong in crimson,
// what was made in green, a job's run in grey, a borrowed identity in amber, a change in blue.
function actionTone(action: string): BadgeVariant {
  if (/\.(denied|rejected|refused|failed|error)$/.test(action)) return "destructive";
  if (action.startsWith("job.")) return "secondary";
  if (/impersonat/.test(action)) return "warning";
  if (/\.(create|created|grant|granted|hire|hired|add|added|propose|proposed)$/.test(action)) return "success";
  return "info";
}

type DiffRow = { field: string; before: string | null; after: string | null; changed: boolean };

const asText = (value: unknown): string | null => (value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value));
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The two snapshots side by side, field by field; the whole value as one row when they are not objects. */
function diffOf(before: unknown, after: unknown): DiffRow[] {
  if (isRecord(before) || isRecord(after)) {
    const left = isRecord(before) ? before : {};
    const right = isRecord(after) ? after : {};
    const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return fields.map((field) => {
      const a = asText(left[field]);
      const b = asText(right[field]);
      return { field, before: a, after: b, changed: a !== b };
    });
  }
  const a = asText(before);
  const b = asText(after);
  return [{ field: "—", before: a, after: b, changed: a !== b }];
}

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
  const selectedId = /^\d{1,19}$/.test(one("entry") ?? "") ? one("entry") : undefined;

  const [{ rows, total }, resourceTypes, allEntities] = await Promise.all([listAuditEntries(reach, filters), listAuditResourceTypes(), listEntities()]);
  const entities = allEntities.filter((entity) => reach.all || reach.entityIds.includes(entity.id));
  const entityName = new Map(allEntities.map((entity) => [entity.id, entity.shortName]));
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const link = (params: Record<string, string | undefined>) => `/admin/audit?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")))}`;
  const pageHref = (target: number) => link({ ...activeFilters, page: String(target) });
  const entryHref = (id: string) => link({ ...activeFilters, page: page > 1 ? String(page) : undefined, entry: id });
  const selected = selectedId ? rows.find((row) => String(row.id) === selectedId) : undefined;

  const chipLabel = (key: string, value: string) => {
    if (key === "entityId") return `${t("filters.entity")}: ${entityName.get(value) ?? value}`;
    if (key === "from" || key === "to") return `${t(`filters.${key}`)}: ${format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" })}`;
    if (key === "resourceId") return `${t("resource")}: ${value}`;
    const name = key === "action" || key === "actor" || key === "resourceType" ? t(`filters.${key}Short`) : key;
    return `${name}: ${value}`;
  };

  const who = (email: string | null) =>
    email ? (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar size="sm">
          <AvatarFallback className="text-[0.625rem] font-medium uppercase">{email.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <span className="truncate">{email}</span>
      </span>
    ) : (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-3.5">
          <CpuIcon aria-hidden />
        </span>
        <span className="truncate">{t("system")}</span>
      </span>
    );

  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />

      <Form action="/admin/audit" className="toolbar">
        <Input name="action" defaultValue={filters.action} placeholder={t("filters.action")} aria-label={t("filters.action")} className="w-full md:w-56" />
        <Input name="actor" defaultValue={filters.actor} placeholder={t("filters.actor")} aria-label={t("filters.actor")} className="w-full md:w-48" />
        <Select name="resourceType" defaultValue={filters.resourceType ?? ""} aria-label={t("filters.resourceType")} className="w-full md:w-48">
          <option value="">{t("filters.anyResource")}</option>
          {resourceTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Select name="entityId" defaultValue={filters.entityId ?? ""} aria-label={t("filters.entity")} className="w-full md:w-44">
          <option value="">{t("filters.anyEntity")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName}
            </option>
          ))}
        </Select>
        <DatePicker name="from" defaultValue={filters.from} aria-label={t("filters.from")} className="w-full md:w-40" />
        <DatePicker name="to" defaultValue={filters.to} aria-label={t("filters.to")} className="w-full md:w-40" />
        {filters.resourceId ? <input type="hidden" name="resourceId" value={filters.resourceId} /> : null}
        <Button type="submit" variant="secondary">{t("filters.apply")}</Button>
      </Form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-faint tabular-nums">{t("count", { count: total })}</span>
        {Object.entries(activeFilters).map(([key, value]) => (
          <Link key={key} href={link({ ...activeFilters, [key]: undefined })} className="press inline-flex h-7 items-center gap-1 rounded-full bg-primary/8 pr-1.5 pl-2.5 text-xs font-medium text-primary ring-1 ring-primary/25 hover:bg-primary/12" aria-label={t("removeFilter", { filter: chipLabel(key, value) })}>
            <span className="max-w-48 truncate">{chipLabel(key, value)}</span>
            <XIcon aria-hidden className="size-3.5" />
          </Link>
        ))}
        {Object.keys(activeFilters).length > 0 ? (
          <Link href="/admin/audit" className={buttonVariants({ variant: "ghost", size: "xs" })}>
            {t("filters.clear")}
          </Link>
        ) : null}
      </div>

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Badge variant={actionTone(selected.action)}>{selected.action}</Badge>
              <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">{format.dateTime(selected.occurredAt, { dateStyle: "medium", timeStyle: "medium" })}</span>
              <Link href={link({ ...activeFilters, page: page > 1 ? String(page) : undefined })} className={buttonVariants({ variant: "ghost", size: "icon-xs", className: "ml-auto" })} aria-label={t("close")}>
                <XIcon aria-hidden />
              </Link>
            </CardTitle>
            {selected.summary ? <CardDescription>{selected.summary}</CardDescription> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {selected.before !== null || selected.after !== null ? (
              <Table numbered={false} className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead kind="id">{t("field")}</TableHead>
                    <TableHead kind="text">{t("before")}</TableHead>
                    <TableHead kind="text">{t("after")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diffOf(selected.before, selected.after).map((row) => (
                    <TableRow key={row.field} className="hover:bg-transparent">
                      <TableCell className="w-44 align-top font-mono text-xs text-faint">{row.field}</TableCell>
                      <TableCell className={cn("w-1/2 align-top break-all whitespace-pre-wrap", row.changed && row.before !== null && "bg-destructive/10 text-destructive line-through decoration-destructive/50")}>
                        <span className="font-mono text-xs">{row.before ?? <span className="text-faint no-underline">—</span>}</span>
                      </TableCell>
                      <TableCell className={cn("w-1/2 align-top break-all whitespace-pre-wrap", row.changed && row.after !== null && "bg-success/10 text-success")}>
                        <span className="font-mono text-xs">{row.after ?? <span className="text-faint">—</span>}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noDiff")}</p>
            )}
            <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t("who"), selected.actorEmail ?? t("system")],
                [t("resource"), selected.resourceType ? `${selected.resourceType} ${selected.resourceId ?? ""}`.trim() : "—"],
                [t("filters.entity"), selected.entityId ? (entityName.get(selected.entityId) ?? selected.entityId) : "—"],
                [t("ipAddress"), selected.ipAddress ?? "—"],
                [t("userAgent"), selected.userAgent ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-faint">{label}</dt>
                  <dd className="truncate font-mono text-foreground/80" title={value}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-faint">{t("appendOnly")}</p>
          </CardContent>
        </Card>
      ) : null}

      <TableCard>
        <Table className="min-w-[56rem]" numberFrom={(page - 1) * AUDIT_PAGE_SIZE + 1}>
          <TableHeader>
            <TableRow>
              <TableHead kind="time" className="text-left">{t("when")}</TableHead>
              <TableHead kind="person">{t("who")}</TableHead>
              <TableHead kind="status">{t("action")}</TableHead>
              <TableHead kind="text">{t("resource")}</TableHead>
              <TableHead kind="org">{t("filters.entity")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {rows.map((row) => {
              const id = String(row.id);
              return (
                <TableRow key={id} data-state={id === selectedId ? "selected" : undefined}>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                    <Link href={entryHref(id)} className="hover:underline">
                      <time dateTime={row.occurredAt.toISOString()}>{format.dateTime(row.occurredAt, { dateStyle: "short", timeStyle: "medium" })}</time>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56">{who(row.actorEmail)}</TableCell>
                  <TableCell>
                    <Link href={entryHref(id)} className="flex items-center gap-2">
                      <Badge variant={actionTone(row.action)} className="font-mono text-[0.6875rem]">{row.action}</Badge>
                      {row.summary ? <span className="hidden max-w-64 truncate text-xs text-muted-foreground xl:inline">{row.summary}</span> : null}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-faint">
                    {row.resourceType ? (
                      <Link className="hover:underline" href={link({ resourceType: row.resourceType, resourceId: row.resourceId ?? undefined })}>
                        {row.resourceType} <span className="font-mono">{row.resourceId}</span>
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{row.entityId ? (entityName.get(row.entityId) ?? row.entityId) : <span className="text-faint">—</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-end gap-3 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("previous")}
            </Link>
          ) : null}
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{t("page", { page, pageCount })}</span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </Page>
  );
}
