// The assets module's own tab row: the register, what is mine, the booking calendar, the digital
// assets, the licences and (for whoever manages assets) the categories. Links, each of which checks
// its own access.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { canReadLicences, canReadRegister } from "../policy";
import type { Principal } from "@/modules/platform/rbac/policy";

export type AssetsTab = "register" | "mine" | "bookings" | "digital" | "licences" | "categories";

const HREF: Record<AssetsTab, string> = { register: "/assets", mine: "/assets/mine", bookings: "/assets/bookings", digital: "/assets/digital", licences: "/assets/licences", categories: "/assets/categories" };

export async function AssetsNav({
  current,
  manages,
  principal,
}: {
  current: AssetsTab;
  /** Whether the categories tab is offered. */ manages: boolean;
  /** Given, decides which tabs the reader may open; without it every tab shows. */ principal?: Principal;
}) {
  const t = await getTranslations("assets");
  const label: Record<AssetsTab, string> = { register: t("nav.register"), mine: t("nav.mine"), bookings: t("nav.bookings"), digital: t("nav.digital"), licences: t("nav.licences"), categories: t("nav.categories") };
  const tabs = (["register", "mine", "bookings", "digital", "licences", "categories"] as const).filter((tab) => {
    if (tab === "categories") return manages;
    if (tab === "register" && principal) return canReadRegister(principal);
    if (tab === "licences" && principal) return canReadLicences(principal);
    return true;
  });
  return (
    <nav className="tab-row" aria-label={t("title")}>
      {tabs.map((tab) => (
        <Link key={tab} href={HREF[tab]} aria-current={tab === current ? "page" : undefined}>
          {label[tab]}
        </Link>
      ))}
    </nav>
  );
}
