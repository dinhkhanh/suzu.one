// What one person is holding, on their record (FR-AST-02). This is the list HR reads while they
// run somebody's offboarding: what is still out, and therefore what the last day has to collect.
// Shown to the person themselves, to whoever keeps the register, and to whoever keeps their
// record — never with a price on it, because holding a thing says nothing about what it cost.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getPersonTarget } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { canReadPersonAssets } from "../policy";
import { listAssetsOfPerson } from "../service";

export async function PersonEquipment({ principal, personId }: { principal: Principal; personId: string }) {
  const target = await getPersonTarget(personId);
  if (!target || !canReadPersonAssets(principal, target)) return null;

  const [held, t] = await Promise.all([listAssetsOfPerson(personId), getTranslations("assets.person")]);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">{t("title")}</h2>
      {held.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {held.map((item) => (
            <li key={item.assignmentId} className="flex flex-wrap items-baseline gap-2 border-b pb-2">
              <Link href={`/assets/${item.assetId}`} className="font-mono text-xs underline">
                {item.code}
              </Link>
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
    </section>
  );
}
