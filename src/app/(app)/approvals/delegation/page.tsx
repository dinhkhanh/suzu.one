import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { listDelegations } from "@/modules/platform/approvals/delegations";
import { DelegationForm, RevokeDelegationButton } from "@/modules/platform/approvals/ui/delegation-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { allRequestTypes } from "../registry";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("delegation");

// "While I am away, my approvals go to …" — everyone manages their own (FR-PLT-22).
export default async function DelegationPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  const [t, format, { given, received }, people, registered] = await Promise.all([getTranslations("approvals"), getFormatter(), listDelegations(user.person.id), listPersonNames(), allRequestTypes()]);
  const label = (type: string) => registered.get(type)?.names?.vi ?? (t.has(`types.${type}`) ? t(`types.${type}` as "types.profile_change") : type);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const types = (row: { requestTypes: string[] | null }) => (row.requestTypes ? row.requestTypes.map(label).join(", ") : t("delegation.allTypes"));

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <Link href="/approvals" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1>{t("delegation.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("delegation.description")}</p>
      </header>
      <DelegationForm people={people.filter((person) => person.id !== user.person.id)} requestTypes={[...registered.keys()].map((type) => ({ type, name: label(type) }))} today={today} />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("delegation.given")}</h2>
        {given.length === 0 ? <p className="text-sm text-muted-foreground">{t("delegation.none")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {given.map((row) => {
            const state = row.revokedAt ? "revoked" : row.validTo < today ? "ended" : row.validFrom > today ? "upcoming" : "active";
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium">{row.toName}</p>
                  <p className="text-xs text-muted-foreground">
                    {day(row.validFrom)} → {day(row.validTo)} · {types(row)}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </p>
                </div>
                <Badge dot variant={statusTone(state)}>{t(`delegation.state.${state}` as "delegation.state.active")}</Badge>
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
