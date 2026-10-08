// What one person is holding, on their record (FR-AST-02). This is the list HR reads while they
// run somebody's offboarding: what is still out, and therefore what the last day has to collect.
// Shown to the person themselves, to whoever keeps the register, and to whoever keeps their
// record — never with a price on it, because holding a thing says nothing about what it cost.
// The same goes for what has no shelf: the pages and channels they can get into or answer for
// (FR-AST-08) and the software seats in their name (FR-AST-11) — a leaver gives those back too.
import { getTranslations } from "next-intl/server";
import { getPersonTarget } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { canManageLicences, canReadPersonAssets } from "../policy";
import { listDigitalAccessOfPerson, listDigitalAssetsOwnedBy } from "../digital";
import { listSeatsOfPerson } from "../seats";
import { listAssetsOfPerson } from "../service";
import { RecordLink } from "@/components/ui/record-link";

export async function PersonEquipment({ principal, personId }: { principal: Principal; personId: string }) {
  const target = await getPersonTarget(personId);
  if (!target || !canReadPersonAssets(principal, target)) return null;

  const [held, access, owned, seats, t, tDigital] = await Promise.all([
    listAssetsOfPerson(personId),
    listDigitalAccessOfPerson(personId),
    listDigitalAssetsOwnedBy(personId),
    listSeatsOfPerson(personId),
    getTranslations("assets.person"),
    getTranslations("assets.digital"),
  ]);
  const active = access.filter((row) => row.status === "active");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">{t("title")}</h2>
      {held.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {held.map((item) => (
            <li key={item.assignmentId} className="flex flex-wrap items-baseline gap-2 border-b pb-2">
              <RecordLink kind="asset" id={item.assetId} className="font-mono text-xs underline">
                {item.code}
              </RecordLink>
              <span>{item.name}</span>
              <span className="text-xs text-muted-foreground">
                {item.categoryName} · {t("since", { date: item.assignedAt.toLocaleDateString("vi-VN") })}
                {item.dueBack ? ` · ${t("dueBack", { date: item.dueBack })}` : ""}
              </span>
              {item.handoverConfirmedAt ? null : <span className="text-xs text-amber-600">{t("unconfirmed")}</span>}
            </li>
          ))}
        </ul>
      )}
      {owned.length > 0 || active.length > 0 ? (
        <>
          <h3 className="text-sm font-medium">{t("digital")}</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {owned.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-baseline gap-2 border-b pb-2">
                <RecordLink kind="digitalAsset" id={asset.id} className="underline">
                  {asset.name}
                </RecordLink>
                <span className="text-xs text-muted-foreground">
                  {tDigital(`platform.${asset.platform}`)} · {t("answersFor")}
                </span>
              </li>
            ))}
            {active.map((row) => (
              <li key={row.accessId} className="flex flex-wrap items-baseline gap-2 border-b pb-2">
                <RecordLink kind="digitalAsset" id={row.assetId} className="underline">
                  {row.name}
                </RecordLink>
                <span className="text-xs text-muted-foreground">
                  {tDigital(`platform.${row.platform}`)} · {tDigital(`level.${row.level}`)}
                  {row.method === "shared_login" ? ` · ${tDigital("method.shared_login")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {seats.length > 0 ? (
        <>
          <h3 className="text-sm font-medium">{t("software")}</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {seats.map((seat) => (
              <li key={seat.seatId} className="flex flex-wrap items-baseline gap-2 border-b pb-2">
                <RecordLink kind="licence" id={canManageLicences(principal) ? seat.licenceId : null}>
                  {seat.name}
                </RecordLink>
                <span className="text-xs text-muted-foreground">{[seat.vendor, seat.viaAsset ? t("onDevice", { device: seat.viaAsset.code }) : null].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
