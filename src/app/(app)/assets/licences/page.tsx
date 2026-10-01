import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { assetsToday, canManageLicences, canReadLicences, CYCLE_MONTHS, listLicences } from "@/modules/assets/service";
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
    return days <= 14 ? "text-destructive font-medium" : days <= 45 ? "text-amber-600" : "";
  };

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/assets" className="h-9 rounded-md border px-3 text-sm leading-9">
            {t("nav.register")}
          </Link>
          {manage ? (
            <Link href="/assets/licences/new" className="h-9 rounded-md bg-primary px-3 text-sm font-medium leading-9 text-primary-foreground">
              {t("nav.new")}
            </Link>
          ) : null}
        </div>
      </header>

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
                  {row.vendor ? <p className="text-xs text-muted-foreground">{row.vendor}</p> : null}
                </TableCell>
                <TableCell>{row.entityName ?? "—"}</TableCell>
                <TableCell kind="number">{row.seats ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{tc(row.billingCycle)}</Badge>
                </TableCell>
                <TableCell className={dueTone(row.renewalDate)}>
                  {row.renewalDate ? row.renewalDate.split("-").reverse().join("/") : "—"}
                  {CYCLE_MONTHS[row.billingCycle] !== null && !row.autoRenews ? <span className="ml-1 text-xs text-muted-foreground">{t("manualRenew")}</span> : null}
                </TableCell>
                <TableCell>{row.ownerName ?? "—"}</TableCell>
                {/* An asset's price and a licence's price are exactly as visible as each other. */}
                <TableCell kind="money">{row.canSeeMoney ? (row.costPerCycle === null ? "—" : row.costPerCycle.toLocaleString("vi-VN")) : "•••"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ts(row.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {manage ? <TableAddRow label={t("nav.new")} href="/assets/licences/new" /> : null}
      </TableCard>

      <p className="text-xs text-muted-foreground">{t("trackerNote")}</p>
    </div>
  );
}
