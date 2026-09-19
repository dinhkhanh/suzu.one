import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { listDelegations } from "@/modules/platform/approvals/delegations";
import { DelegationForm, RevokeDelegationButton } from "@/modules/platform/approvals/ui/delegation-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { REQUEST_TYPES } from "../registry";

export const metadata: Metadata = { title: "Delegation" };

// "While I am away, my approvals go to …" — everyone manages their own (FR-PLT-22).
export default async function DelegationPage() {
  const user = await requireUser();
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  const today = todayInVietnam();
  const [{ given, received }, people] = await Promise.all([listDelegations(user.person.id), listPersonNames()]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const types = (row: { requestTypes: string[] | null }) => (row.requestTypes ? row.requestTypes.map((type) => (t.has(`types.${type}`) ? t(`types.${type}` as "types.profile_change") : type)).join(", ") : t("delegation.allTypes"));

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <Link href="/approvals" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("delegation.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("delegation.description")}</p>
      </header>
      <DelegationForm people={people.filter((person) => person.id !== user.person.id)} requestTypes={[...REQUEST_TYPES.keys()]} today={today} />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("delegation.given")}</h2>
        {given.length === 0 ? <p className="text-sm text-muted-foreground">{t("delegation.none")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {given.map((row) => {
            const state = row.revokedAt ? "revoked" : row.validTo < today ? "ended" : row.validFrom > today ? "upcoming" : "active";
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.toName}</p>
                  <p className="text-xs text-muted-foreground">
                    {day(row.validFrom)} → {day(row.validTo)} · {types(row)}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </p>
                </div>
                <Badge variant={state === "active" ? "secondary" : "outline"}>{t(`delegation.state.${state}` as "delegation.state.active")}</Badge>
                {state === "active" || state === "upcoming" ? <RevokeDelegationButton id={row.id} /> : null}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("delegation.received")}</h2>
        {received.filter((row) => row.validTo >= today).length === 0 ? <p className="text-sm text-muted-foreground">{t("delegation.none")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {received
            .filter((row) => row.validTo >= today)
            .map((row) => (
              <li key={row.id} className="p-3 text-sm">
                <p className="font-medium">{row.fromName}</p>
                <p className="text-xs text-muted-foreground">
                  {day(row.validFrom)} → {day(row.validTo)} · {types(row)}
                </p>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
