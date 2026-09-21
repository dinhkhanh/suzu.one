import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireUser } from "@/modules/platform/auth/session";
import { canReadRegister, listAssetsOfPerson } from "@/modules/assets/service";
import { ConfirmHandoverForm } from "@/modules/assets/ui/asset-forms";

export const metadata: Metadata = { title: "Thiết bị của tôi" };

// Everyone has this page, whatever their role: what the company has handed to them, and the
// confirmation that they received it (FR-AST-02).
export default async function MyAssetsPage() {
  const user = await requireUser();
  const [held, t] = await Promise.all([listAssetsOfPerson(user.person.id), getTranslations("assets.mine")]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canReadRegister(user.principal) ? (
          <Link href="/assets" className="h-9 rounded-md border px-3 text-sm leading-9">
            {t("register")}
          </Link>
        ) : null}
      </header>

      {held.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {held.map((item) => (
            <li key={item.assignmentId} className="flex flex-col gap-3 rounded-md border p-4">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{item.code}</p>
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-muted-foreground">
                  {item.categoryName} · {t("since", { date: item.assignedAt.toLocaleDateString("vi-VN") })}
                  {item.dueBack ? ` · ${t("dueBack", { date: item.dueBack })}` : ""}
                </p>
                {item.accessories.length > 0 ? <p className="text-sm text-muted-foreground">{item.accessories.join(" · ")}</p> : null}
              </div>
              {item.handoverConfirmedAt ? <p className="text-sm text-emerald-600">{t("confirmed", { date: item.handoverConfirmedAt.toLocaleDateString("vi-VN") })}</p> : <ConfirmHandoverForm assignmentId={item.assignmentId} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
