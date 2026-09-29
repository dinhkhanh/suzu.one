// The CRM's own tab bar, shown on every CRM page: links, not state — every tab is its own page and
// checks access itself; a tab the reader cannot use is not offered. Scrolls sideways on a phone.
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const CRM_TABS = ["home", "accounts", "leads", "deals", "contracts", "invoices", "reports", "commission", "rateCard", "settings"] as const;
export type CrmTab = (typeof CRM_TABS)[number];

const HREF: Record<CrmTab, string> = { home: "/crm", accounts: "/crm/accounts", leads: "/crm/leads", deals: "/crm/deals", contracts: "/crm/contracts", invoices: "/crm/invoices", reports: "/crm/reports", commission: "/crm/commission", rateCard: "/crm/rate-card", settings: "/crm/settings" };

export async function CrmTabs({ current, show }: { current: CrmTab; show: Partial<Record<CrmTab, boolean>> }) {
  const t = await getTranslations("crm.tabs");
  const tabs = CRM_TABS.filter((tab) => show[tab] !== false);
  return (
    <nav aria-label={t("label")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg border p-0.5 text-sm">
        {tabs.map((tab) => (
          <li key={tab}>
            <Link href={HREF[tab]} aria-current={tab === current ? "page" : undefined} className={`block rounded-md px-3 py-1 whitespace-nowrap ${tab === current ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
              {t(tab)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
