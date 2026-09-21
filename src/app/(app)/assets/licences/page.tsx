import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { assetsToday, canManageLicences, canReadLicences, CYCLE_MONTHS, listLicences } from "@/modules/assets/service";

export const metadata: Metadata = { title: "Bản quyền & thuê bao" };

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

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">{t("columns.name")}</th>
                <th className="p-2 font-medium">{t("columns.entity")}</th>
                <th className="p-2 font-medium">{t("columns.seats")}</th>
                <th className="p-2 font-medium">{t("columns.cycle")}</th>
                <th className="p-2 font-medium">{t("columns.renewal")}</th>
                <th className="p-2 font-medium">{t("columns.owner")}</th>
                <th className="p-2 font-medium">{t("columns.cost")}</th>
                <th className="p-2 font-medium">{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">
                    {manage ? (
                      <Link href={`/assets/licences/${row.id}`} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{row.name}</span>
                    )}
                    {row.vendor ? <p className="text-xs text-muted-foreground">{row.vendor}</p> : null}
                  </td>
                  <td className="p-2">{row.entityName ?? "—"}</td>
                  <td className="p-2">{row.seats ?? "—"}</td>
                  <td className="p-2">{tc(row.billingCycle)}</td>
                  <td className={`p-2 whitespace-nowrap ${dueTone(row.renewalDate)}`}>
                    {row.renewalDate ? row.renewalDate.split("-").reverse().join("/") : "—"}
                    {CYCLE_MONTHS[row.billingCycle] !== null && !row.autoRenews ? <span className="ml-1 text-xs text-muted-foreground">{t("manualRenew")}</span> : null}
                  </td>
                  <td className="p-2">{row.ownerName ?? "—"}</td>
                  {/* An asset's price and a licence's price are exactly as visible as each other. */}
                  <td className="p-2 tabular-nums">{row.canSeeMoney ? (row.costPerCycle === null ? "—" : row.costPerCycle.toLocaleString("vi-VN")) : "•••"}</td>
                  <td className="p-2">{ts(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("trackerNote")}</p>
    </div>
  );
}
