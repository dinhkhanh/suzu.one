import { CalendarIcon, SearchIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { todayInVietnam } from "@/lib/dates";
import { toSearchKey } from "@/lib/text";
import { requireUser } from "@/modules/platform/auth/session";
import { can } from "@/modules/platform/rbac/policy";
import { isParameterKey, PARAMETER_KEYS, type ParameterKey } from "@/modules/platform/statutory/catalogue";
import { versionOn } from "@/modules/platform/statutory/engine/versions";
import { listParameterVersions, type ParameterRow } from "@/modules/platform/statutory/service";
import { DecisionButtons, ProposeParameterForm } from "@/modules/platform/statutory/ui/rule-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("statutoryParameters");

type Format = (amount: number, unit: "rate" | "plain") => string;
const RATE_KEY = /rate|bhxh|bhyt|bhtn|fund|dues|resident|withoutContract$|Bp$/i;

// Rates are stored as basis points and shown as percents; amounts get thousands separators.
function show(key: string, item: unknown, format: Format): string {
  if (item === null) return "∞";
  if (typeof item === "number") return format(item, RATE_KEY.test(key) ? "rate" : "plain");
  if (Array.isArray(item)) return item.map((inner) => show(key, inner, format)).join(", ");
  if (typeof item === "object") return Object.entries(item as Record<string, unknown>).map(([innerKey, inner]) => `${innerKey}: ${show(innerKey, inner, format)}`).join(" · ");
  return String(item);
}

/** The whole value on one line, for the table's value column. */
function summarize(value: unknown, format: Format): string {
  if (Array.isArray(value)) return value.map((item, index) => `${index + 1}. ${show(String(index), item, format)}`).join("  ");
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key} ${show(key, item, format)}`).join(" · ");
  return String(value ?? "—");
}

function ValueTable({ value, format }: { value: unknown; format: Format }) {
  const rows: [string, unknown][] = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value as Record<string, unknown>);
  return (
    <Table numbered={false} containerClassName="rounded-[10px]">
      <TableBody>
        {rows.map(([key, item]) => (
          <TableRow key={key}>
            <TableCell className="h-9 py-1 font-mono text-xs text-muted-foreground">{key}</TableCell>
            <TableCell kind="number" className="h-9 py-1 whitespace-normal">{show(key, item, format)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// The parameters fall into the families their keys begin with: insurance, union, pit, wage…
const groupOf = (key: string) => key.split(".")[0];

export default async function RulesPage(props: PageProps<"/admin/rules">) {
  const user = await requireUser();
  const canPropose = can(user.principal, "rules:propose", {});
  const canDecide = can(user.principal, "payroll:rules", {});
  if (!canPropose && !canDecide && !can(user.principal, "payroll:read", {})) notFound();

  const [t, formatter, versions, query] = await Promise.all([getTranslations("rules"), getFormatter(), listParameterVersions(), props.searchParams]);
  const today = todayInVietnam();
  const day = (value: string) => formatter.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const format: Format = (amount, unit) => (unit === "rate" ? `${formatter.number(amount / 100, { maximumFractionDigits: 2 })}%` : formatter.number(amount));
  const label = (key: string) => (t.has(`parameters.${key.replace(".", "_")}`) ? t(`parameters.${key.replace(".", "_")}`) : key);
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const selectedKey = typeof query.key === "string" && isParameterKey(query.key) ? query.key : null;

  const byKey = Map.groupBy(versions, (version) => version.key);
  const approvedOf = (key: string) => (byKey.get(key) ?? []).filter((version) => version.status === "approved");
  const current: Partial<Record<ParameterKey, unknown>> = {};
  for (const key of PARAMETER_KEYS) current[key] = versionOn(approvedOf(key), today)?.value;
  const proposals = versions.filter((version) => version.status === "proposed");
  const proposedKeys = new Set(proposals.map((proposal) => proposal.key));

  const keys = search ? PARAMETER_KEYS.filter((key) => toSearchKey(`${label(key)} ${key}`).includes(toSearchKey(search))) : PARAMETER_KEYS;
  const groups = Map.groupBy(keys, groupOf);
  const groupLabel = (group: string) => (t.has(`groups.${group}`) ? t(`groups.${group}`) : group);

  const href = (key: string) => `/admin/rules?${new URLSearchParams({ ...(search ? { q: search } : {}), key })}`;

  const meta = (version: ParameterRow) => (
    <p className="text-xs text-muted-foreground">
      <span className="font-mono tabular-nums">{day(version.validFrom)} → {version.validTo ? day(version.validTo) : "…"}</span>
      {version.legalReference ? ` · ${version.legalReference}` : ""}
      {version.note ? ` · ${version.note}` : ""}
    </p>
  );

  // The chosen parameter: its value in force and every version it has had, as one line of time.
  let detail: ReactNode = null;
  if (selectedKey) {
    const approved = approvedOf(selectedKey);
    const inForce = versionOn(approved, today);
    const timeline = [...proposals.filter((proposal) => proposal.key === selectedKey), ...approved].sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
    detail = (
      <Card className="order-first lg:order-none lg:sticky lg:top-0 lg:self-start">
        <CardHeader>
          <CardTitle>{label(selectedKey)}</CardTitle>
          <CardDescription className="font-mono text-xs">{selectedKey}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {inForce ? (
            <>
              <ValueTable value={inForce.value} format={format} />
              {canDecide && !inForce.isVerified ? <DecisionButtons id={inForce.id} decisions={["verify"]} /> : null}
            </>
          ) : (
            <p className="text-sm text-destructive">{t("missing")}</p>
          )}
          <div className="flex flex-col gap-1">
            <p className="section-label">{t("versions")}</p>
            <ol className="ml-1.5 flex flex-col border-l-2 border-border">
              {timeline.length === 0 ? <li className="pl-4 text-sm text-muted-foreground">{t("noVersions")}</li> : null}
              {timeline.map((version) => {
                const live = version.id === inForce?.id;
                return (
                  <li key={version.id} className="relative flex flex-col gap-0.5 py-2 pl-4">
                    <span aria-hidden className={cn("absolute top-3.5 -left-[7px] size-3 rounded-full border-2 border-background", live ? "bg-primary" : version.status === "proposed" ? "bg-warning" : "bg-input")} />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[0.8125rem] font-medium tabular-nums">{day(version.validFrom)}</span>
                      {live ? <Badge variant="info">{t("inForce")}</Badge> : null}
                      {version.status === "proposed" ? <Badge variant="warning">{t("proposed")}</Badge> : null}
                      {version.status === "approved" && !version.isVerified ? <Badge variant="destructive">{t("unverifiedShort")}</Badge> : null}
                    </div>
                    {version.legalReference ? <p className="truncate text-xs text-faint" title={version.legalReference}>{version.legalReference}</p> : null}
                    {live ? null : <p className="truncate text-xs text-muted-foreground" title={summarize(version.value, format)}>{summarize(version.value, format)}</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Page width={selectedKey ? "wide" : "default"}>
      <PageHeader title={t("title")} description={t("description")} />

      {proposals.length > 0 ? (
        <Alert variant="warning">
          <span className="flex-1">{t("pendingCount", { count: proposals.length })}</span>
          <Link href="#proposals" className={buttonVariants({ variant: "outline", size: "xs" })}>
            {t("view")}
          </Link>
        </Alert>
      ) : null}

      <Form action="/admin/rules" className="toolbar">
        {selectedKey ? <input type="hidden" name="key" value={selectedKey} /> : null}
        <div className="relative w-full md:w-72">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input name="q" defaultValue={search} placeholder={t("search")} aria-label={t("search")} className="pl-9" />
        </div>
        <Button type="submit" variant="secondary">{t("filter")}</Button>
        <span className={buttonVariants({ variant: "outline", className: "ml-auto cursor-default gap-2 font-normal" })}>
          <CalendarIcon aria-hidden />
          <span className="text-muted-foreground">{t("asOf")}</span>
          <span className="font-mono text-[0.8125rem] tabular-nums">{day(today)}</span>
        </span>
      </Form>

      <div className={cn("grid gap-6", selectedKey && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <TableCard>
          <Table className="min-w-[44rem]">
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("parameter")}</TableHead>
                <TableHead kind="number" className="text-left">{t("value")}</TableHead>
                <TableHead kind="date">{t("validFrom")}</TableHead>
                <TableHead kind="file">{t("legalReference")}</TableHead>
                <TableHead kind="number">{t("version")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.length === 0 ? <TableEmpty>{t("noMatch")}</TableEmpty> : null}
              {[...groups.entries()].map(([group, groupKeys]) => (
                <GroupRows key={group} title={groupLabel(group)}>
                  {groupKeys.map((key) => {
                    const approved = approvedOf(key);
                    const inForce = versionOn(approved, today);
                    const on = key === selectedKey;
                    return (
                      <TableRow key={key} data-state={on ? "selected" : undefined}>
                        <TableCell className="max-w-72">
                          <Link href={href(key)} className="flex flex-col gap-0.5 hover:underline">
                            <span className="flex items-center gap-1.5 truncate font-medium">
                              <span className="truncate">{label(key)}</span>
                              {proposedKeys.has(key) ? <Badge variant="warning">{t("proposed")}</Badge> : null}
                              {inForce && !inForce.isVerified ? <Badge variant="destructive">{t("unverifiedShort")}</Badge> : null}
                            </span>
                            <span className="font-mono text-[0.6875rem] text-faint">{key}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-64 truncate font-mono text-xs tabular-nums" title={inForce ? summarize(inForce.value, format) : undefined}>
                          {inForce ? summarize(inForce.value, format) : <span className="text-destructive">{t("missing")}</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">{inForce ? day(inForce.validFrom) : "—"}</TableCell>
                        <TableCell className="max-w-56 truncate text-xs text-faint" title={inForce?.legalReference ?? undefined}>{inForce?.legalReference ?? "—"}</TableCell>
                        <TableCell kind="number" className="text-faint">{approved.length || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </GroupRows>
              ))}
            </TableBody>
          </Table>
        </TableCard>
        {detail}
      </div>

      {proposals.length > 0 ? (
        <Section title={t("pending")} count={proposals.length} id="proposals">
          <TableCard>
            <List>
              {proposals.map((proposal) => (
                <ListItem key={proposal.id} className="flex-col items-stretch gap-3 py-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {label(proposal.key)}
                    <span className="font-mono text-xs font-normal text-faint">{proposal.key}</span>
                  </p>
                  {meta(proposal)}
                  <ValueTable value={proposal.value} format={format} />
                  {canDecide ? <DecisionButtons id={proposal.id} decisions={["approve", "reject"]} /> : null}
                </ListItem>
              ))}
            </List>
          </TableCard>
        </Section>
      ) : null}

      {canPropose ? (
        <Section title={t("propose.title")}>
          <TableCard>
            <TableCardHeader title={t("propose.title")} description={t("propose.hint")} />
            <div className="p-4">
              <ProposeParameterForm current={current} />
            </div>
          </TableCard>
        </Section>
      ) : null}
    </Page>
  );
}

function GroupRows({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <TableGroupRow>{title}</TableGroupRow>
      {children}
    </>
  );
}
