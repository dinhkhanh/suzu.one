import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getHomeFeed } from "@/modules/comms/service";
import { AnnouncementList, KudosList } from "@/modules/comms/ui/cards";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("home");

function FeedCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">{children}</CardContent>
    </Card>
  );
}

export default async function HomePage() {
  const user = await requireUser();
  const [t, format, feed] = await Promise.all([getTranslations(), getFormatter(), getHomeFeed(user)]);
  const givenName = user.person.fullName.trim().split(/\s+/).at(-1) ?? user.person.fullName;
  const staff = user.principal.workforceType !== "collaborator";
  const year = Number(feed.today.slice(0, 4));
  // A day and a month, put into words with an arbitrary year: the feed holds no year of birth.
  const dayMonth = (month: number, day: number) => format.dateTime(new Date(Date.UTC(year, month - 1, day, 12)), { day: "numeric", month: "long" });
  const isoDay = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "long" });
  const when = (inDays: number, month: number, day: number) => (inDays === 0 ? t("home.today") : t("home.onDate", { date: dayMonth(month, day) }));
  const { pending } = feed;
  const waiting = pending.acks.length + pending.announcements.length + pending.approvals;

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1>{t("home.greeting", { name: givenName })}</h1>
        <div className="flex flex-wrap gap-2">
          {user.principal.grants.length === 0 ? (
            <Badge variant="secondary">{t("home.noRoles")}</Badge>
          ) : (
            user.principal.grants.map((grant, index) => (
              <Badge key={index} variant="secondary">
                {t(`roles.${grant.role}`)}
                {grant.scope.type === "group" ? ` · ${t("home.scopeGroup")}` : ""}
              </Badge>
            ))
          )}
        </div>
      </header>

      {waiting > 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <h2 className="text-sm font-medium">{t("home.pending.title")}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {pending.approvals > 0 ? (
              <li>
                <Link href="/approvals" className="underline underline-offset-2">
                  {t("home.pending.approvals", { count: pending.approvals })}
                </Link>
              </li>
            ) : null}
            {pending.acks.length > 0 ? (
              <li className="flex flex-col gap-1">
                <Link href="/kb/acknowledgements" className="underline underline-offset-2">
                  {t("home.pending.acks", { count: pending.acks.length })}
                </Link>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {pending.acks.slice(0, 5).map((ack) => (
                    <li key={ack.pageId}>
                      <Link href={`/kb/pages/${ack.pageId}`} className="hover:underline">
                        {ack.title}
                      </Link>{" "}
                      — {ack.overdue ? <span className="text-destructive">{t("home.pending.overdue")}</span> : t("home.pending.dueOn", { date: isoDay(ack.dueOn) })}
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
            {pending.announcements.length > 0 ? (
              <li className="flex flex-col gap-1">
                <span>{t("home.pending.announcements", { count: pending.announcements.length })}</span>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {pending.announcements.map((card) => (
                    <li key={card.id}>
                      <Link href={`/announcements/${card.id}`} className="hover:underline">
                        {card.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("home.announcements")}</h2>
          <Link href="/announcements" className="text-sm underline underline-offset-2">
            {t("comms.list.all")}
          </Link>
        </div>
        <AnnouncementList cards={feed.announcements} empty={t("home.noAnnouncements")} />
      </section>

      {staff ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <FeedCard title={t("home.joiners")}>
              {feed.joiners.length === 0 ? <p className="text-muted-foreground">{t("home.nothingThisWeek")}</p> : null}
              {feed.joiners.map((person) => (
                <p key={person.personId}>
                  <Link href={`/people/${person.personId}`} className="font-medium hover:underline">
                    {person.fullName}
                  </Link>
                  <br />
                  <span className="text-muted-foreground">
                    {[person.positionName, person.departmentName, person.entityName].filter(Boolean).join(" · ")} — {t("home.joinedOn", { date: isoDay(person.startDate) })}
                  </span>
                </p>
              ))}
            </FeedCard>
            <FeedCard title={t("home.birthdays")}>
              {feed.birthdays.length === 0 ? <p className="text-muted-foreground">{t("home.nothingThisWeek")}</p> : null}
              {feed.birthdays.map((person) => (
                <p key={person.personId}>
                  <span className="font-medium">{person.fullName}</span> <span className="text-muted-foreground">— {when(person.inDays, person.month, person.day)}</span>
                </p>
              ))}
            </FeedCard>
            <FeedCard title={t("home.anniversaries")}>
              {feed.anniversaries.length === 0 ? <p className="text-muted-foreground">{t("home.nothingThisWeek")}</p> : null}
              {feed.anniversaries.map((person) => (
                <p key={person.personId}>
                  <span className="font-medium">{person.fullName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {t("home.years", { years: person.years })}, {when(person.inDays, person.month, person.day)}
                  </span>
                </p>
              ))}
            </FeedCard>
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t("home.kudos")}</h2>
              <Link href="/kudos" className="text-sm underline underline-offset-2">
                {t("home.giveKudos")}
              </Link>
            </div>
            <KudosList cards={feed.kudos} empty={t("home.noKudos")} />
          </section>
        </>
      ) : null}

      {feed.newPages.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("home.newPages")}</h2>
          <ul className="flex flex-col divide-y rounded-lg border">
            {feed.newPages.map((page) => (
              <li key={page.pageId} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <Link href={`/kb/pages/${page.pageId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {page.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {page.spaceName}
                  {page.at ? ` · ${format.dateTime(page.at, { dateStyle: "medium" })}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
