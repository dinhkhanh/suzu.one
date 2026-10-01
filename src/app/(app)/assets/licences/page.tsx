import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { assetsToday, canManageAssets, canManageLicences, canReadLicences, CYCLE_MONTHS, listLicences } from "@/modules/assets/service";
import { AssetsNav } from "@/modules/assets/ui/nav";
import { statusTone } from "@/components/ui/tone";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("licencesSubscriptions");

// Licences and subscriptions (FR-AST-05). Their renewal dates become obligations in the OPS
// tracker — the scheduler pulls them; nothing is written from here.
export default async function LicencesPage() {
  const user = await requireUser();
  if (!canReadLicences(user.principal)) notFound();

  const [rows, t, tc] = await Promise.all([listLicences(user.principal), getTranslations("assets.licences"), getTranslations("assets.licences.cycle")]);
  const ts = await getTranslations("assets.licences.status");
  const today = assetsToday();
  const manage = canManageLicences(user.principal);

  const dueTone = (renewalDate: string | null) => {
    if (!renewalDate || renewalDate < today) return "text-muted-foreground";
    const days = Math.round((Date.parse(`${renewalDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return days <= 14 ? "text-destructive font-medium" : days <= 45 ? "text-warning" : "";
  };

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          manage ? (
            <Button nativeButton={false} render={<Link href="/assets/licences/new" />}>{t("nav.new")}</Button>
          ) : null
        }
      />
      <AssetsNav current="licences" manages={canManageAssets(user.principal)} principal={user.principal} />

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.name")}</TableHead>
              <TableHead kind="org">{t("columns.entity")}</TableHead>
              <TableHead kind="number">{t("columns.seats")}</TableHead>
              <TableHead kind="select">{t("columns.cycle")}</TableHead>
              <TableHead kind="date">{t("columns.renewal")}</TableHead>
              <TableHead kind="person">{t("columns.owner")}</TableHead>
              <TableHead kind="money">{t("columns.cost")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {manage ? (
                    <Link href={`/assets/licences/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.name}</span>
                  )}
                  {row.vendor ? <p className="text-xs text-faint">{row.vendor}</p> : null}
                </TableCell>
                <TableCell>{row.entityName ?? "—"}</TableCell>
                <TableCell kind="number">{row.seats ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{tc(row.billingCycle)}</Badge>
                </TableCell>
                <TableCell kind="date" className={dueTone(row.renewalDate)}>
                  <span className="font-mono text-[0.8125rem] tabular-nums">{row.renewalDate ? row.renewalDate.split("-").reverse().join("/") : "—"}</span>
                  {CYCLE_MONTHS[row.billingCycle] !== null && !row.autoRenews ? <span className="ml-1 text-xs text-muted-foreground">{t("manualRenew")}</span> : null}
                </TableCell>
                <TableCell>{row.ownerName ?? "—"}</TableCell>
                {/* An asset's price and a licence's price are exactly as visible as each other. */}
                <TableCell kind="money">{row.canSeeMoney ? (row.costPerCycle === null ? "—" : row.costPerCycle.toLocaleString("vi-VN")) : "•••"}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.status)}>{ts(row.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {manage ? <TableAddRow label={t("nav.new")} href="/assets/licences/new" /> : null}
      </TableCard>

      <p className="text-xs text-muted-foreground">{t("trackerNote")}</p>
    </Page>
  );
}
