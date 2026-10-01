// A request's family on screen (FR-REQ-05): the request it was filed under, the ones filed under
// it, and — for its requester — the follow-ups they may file now, or why not yet. Server
// components: every rule was applied by `getRequestFamily`; this file only draws the result.
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { RequestStatusBadge } from "@/modules/platform/approvals/ui/request-views";
import type { FollowUpGate } from "../engine/follow-ups";
import type { FamilyMember, RequestFamily } from "../service";

/** Why a follow-up cannot be filed yet, in the requester's words. */
export async function FollowUpGateNote({ gate }: { gate: FollowUpGate }) {
  const t = await getTranslations("requests.followUps");
  const format = await getFormatter();
  if (gate.open) return null;
  const text =
    gate.reason === "not_yet"
      ? t("gate.not_yet", { date: format.dateTime(new Date(`${gate.opensOn}T00:00:00`), { dateStyle: "medium" }) })
      : gate.reason === "limit_reached"
        ? t("gate.limit_reached", { max: gate.max })
        : t(`gate.${gate.reason}`);
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

/** The request this one was filed under. */
export async function ParentRequest({ parent }: { parent: FamilyMember }) {
  const t = await getTranslations("requests.followUps");
  const locale = await getLocale();
  return (
    <Alert variant="neutral">
      <span className="text-xs text-muted-foreground">{t("filedUnder")}</span>
      <Link href={`/approvals/request/${parent.requestId}`} className="min-w-0 flex-1 font-medium hover:underline">
        {locale === "en" ? parent.nameEn : parent.nameVi} · {parent.summary}
      </Link>
      <RequestStatusBadge status={parent.status} />
    </Alert>
  );
}

/** What has been filed under this request, grouped by the parent type's rules, with a way to file the next one. */
export async function FollowUps({ family, requestId }: { family: RequestFamily; requestId: string }) {
  if (family.followUps.length === 0 && family.children.length === 0) return null;
  const t = await getTranslations("requests.followUps");
  const locale = await getLocale();
  const format = await getFormatter();
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
  // A child whose type the rules no longer name is still shown, under its own heading.
  const named = new Set(family.followUps.map((entry) => entry.code));
  const strays = family.children.filter((child) => !named.has(child.code));

  return (
    <TableCard>
      <TableCardHeader title={t("title")} />
      <List>
        {family.followUps.map((entry) => {
          const children = family.children.filter((child) => child.code === entry.code);
          const name = locale === "en" ? entry.nameEn : entry.nameVi;
          return (
            <ListItem key={entry.code} className="flex-col items-stretch gap-2 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("count", { count: children.length })}
                    {entry.approvedAmount > 0 ? ` · ${t("approvedAmount", { amount: money(entry.approvedAmount) })}` : ""}
                  </p>
                </div>
                {entry.gate?.open ? (
                  <Link href={`/requests/new/${entry.code}?parent=${requestId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    {t("file", { name })}
                  </Link>
                ) : entry.gate ? (
                  <FollowUpGateNote gate={entry.gate} />
                ) : null}
              </div>
              {children.length > 0 ? <Children rows={children} money={money} /> : null}
            </ListItem>
          );
        })}
        {strays.length > 0 ? (
          <ListItem className="flex-col items-stretch py-3">
            <Children rows={strays} money={money} withName />
          </ListItem>
        ) : null}
      </List>
    </TableCard>
  );
}

async function Children({ rows, money, withName = false }: { rows: FamilyMember[]; money: (amount: number) => string; withName?: boolean }) {
  const locale = await getLocale();
  const format = await getFormatter();
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((child) => (
        <li key={child.requestId} className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/approvals/request/${child.requestId}`} className="min-w-0 flex-1 basis-48 hover:underline">
            {withName ? `${locale === "en" ? child.nameEn : child.nameVi} · ` : ""}
            {child.summary}
          </Link>
          <span className="text-xs text-muted-foreground">{format.dateTime(child.createdAt, { dateStyle: "medium" })}</span>
          {child.amount !== null ? <span className="text-xs tabular-nums">{money(child.amount)}</span> : null}
          <RequestStatusBadge status={child.status} />
        </li>
      ))}
    </ul>
  );
}
