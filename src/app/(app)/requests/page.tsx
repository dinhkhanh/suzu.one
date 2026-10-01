import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { RequestAge } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageRequestTypes } from "@/modules/requests/policy";
import { listMySubmissions, requestTypeStats, type SubmissionListRow } from "@/modules/requests/service";
import { RequestTabs } from "@/modules/requests/ui/request-tabs";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("requests");

const OPEN = new Set(["pending", "returned"]);

// What I have asked for, and — for whoever administers the types — how each type is doing
// (FR-REQ-04). A row opens the request itself, where its history and its answers are.
export default async function RequestsPage() {
  const user = await requireUser();
  const t = await getTranslations("requests");
  const tApprovals = await getTranslations("approvals");
  const locale = await getLocale();
  const format = await getFormatter();
  const manages = canManageRequestTypes(user.principal);
  // The other kinds of request live with the modules that own them; this page is the way in.
  const elsewhere = [
    { href: "/leave/new", label: t("elsewhere.leave") },
    { href: "/attendance/requests/new", label: t("elsewhere.attendance") },
  ];
  const [mine, stats] = await Promise.all([listMySubmissions(user.person.id), manages ? requestTypeStats() : Promise.resolve([])]);
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
  const name = (row: SubmissionListRow) => (locale === "en" ? row.nameEn : row.nameVi);
  const open = mine.filter((row) => OPEN.has(row.status));
  const resolved = mine.filter((row) => !OPEN.has(row.status));

  const cells = (row: SubmissionListRow) => (
    <>
      <TableCell>
        <Badge variant="secondary">{name(row)}</Badge>
      </TableCell>
      <TableCell className="max-w-96 whitespace-normal">
        <Link href={`/approvals/request/${row.requestId}`} className="font-medium hover:underline">
          {row.summary || name(row)}
        </Link>
        {row.parentRequestId ? (
          <Link href={`/approvals/request/${row.parentRequestId}`} className="block text-xs text-link hover:underline">
            ↳ {t("followUps.under", { name: (locale === "en" ? row.parentNameEn : row.parentNameVi) ?? "" })}
          </Link>
        ) : null}
      </TableCell>
      <TableCell kind="money">{row.amount === null ? <span className="text-faint">—</span> : money(row.amount)}</TableCell>
      <TableCell>
        <Badge dot variant={statusTone(row.status)}>{tApprovals(`status.${row.status}` as "status.pending")}</Badge>
      </TableCell>
      <TableCell kind="time">
        <RequestAge createdAt={row.createdAt} decidedAt={row.decidedAt} />
      </TableCell>
    </>
  );

  return (
    <Page>
      <PageHeader
        title={t("hub")}
        description={t("description")}
        actions={
          <>
            {elsewhere.map((link) => (
              <Link key={link.href} href={link.href} className={buttonVariants({ variant: "outline" })}>
                {link.label}
              </Link>
            ))}
            <Link href="/requests/new" className={buttonVariants()}>
              {t("newShort")}
            </Link>
          </>
        }
      />
      <RequestTabs active="mine" personId={user.person.id} principal={user.principal} />

      <Section title={t("mine")} count={mine.length || undefined}>
        <TableCard className="hidden md:flex">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{tApprovals("columns.type")}</TableHead>
                <TableHead kind="text">{t("columns.request")}</TableHead>
                <TableHead kind="money">{tApprovals("columns.amount")}</TableHead>
                <TableHead kind="status">{tApprovals("columns.step")}</TableHead>
                <TableHead kind="time">{tApprovals("columns.age")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.length === 0 ? <TableEmpty>{t("mineEmpty")}</TableEmpty> : null}
              {open.map((row) => (
                <TableRow key={row.requestId}>{cells(row)}</TableRow>
              ))}
              {resolved.length > 0 ? <TableGroupRow>{tApprovals("resolved", { count: resolved.length })}</TableGroupRow> : null}
              {resolved.map((row) => (
                <TableRow key={row.requestId} className="text-muted-foreground">
                  {cells(row)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TableAddRow label={t("new")} href="/requests/new" />
        </TableCard>
        <TableCard className="md:hidden">
          <List>
            {mine.length === 0 ? <ListEmpty>{t("mineEmpty")}</ListEmpty> : null}
            {[...open, ...resolved].map((row) => (
              <ListItem key={row.requestId} href={`/approvals/request/${row.requestId}`} className="flex-col items-stretch gap-1">
                <span className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{name(row)}</Badge>
                  <RequestAge createdAt={row.createdAt} decidedAt={row.decidedAt} />
                </span>
                <span className="line-clamp-2 text-sm font-medium">{row.summary || name(row)}</span>
                <span className="flex items-center justify-between gap-2 text-xs">
                  <Badge dot variant={statusTone(row.status)}>{tApprovals(`status.${row.status}` as "status.pending")}</Badge>
                  {row.amount !== null ? <span className="font-mono tabular-nums">{money(row.amount)}</span> : null}
                </span>
              </ListItem>
            ))}
          </List>
          <TableAddRow label={t("new")} href="/requests/new" />
        </TableCard>
      </Section>

      {manages ? (
        <Section title={t("tracking.title")} action={<Link href="/admin/request-types">{t("tracking.manage")}</Link>}>
          <TableCard>
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="select">{t("tracking.columns.type")}</TableHead>
                  <TableHead kind="number">{t("tracking.columns.open")}</TableHead>
                  <TableHead kind="number">{t("tracking.columns.decided")}</TableHead>
                  <TableHead kind="time">{t("tracking.columns.median")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell className="font-medium">{locale === "en" ? row.nameEn : row.nameVi}</TableCell>
                    <TableCell kind="number">{row.open}</TableCell>
                    <TableCell kind="number">{row.decided}</TableCell>
                    <TableCell kind="time" className="text-muted-foreground">{row.medianHours === null ? t("tracking.noMedian") : t("tracking.median", { hours: row.medianHours })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          <p className="px-0.5 text-xs text-faint">{t("tracking.description")}</p>
        </Section>
      ) : null}
    </Page>
  );
}
