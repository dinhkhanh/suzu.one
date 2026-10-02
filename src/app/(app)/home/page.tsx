import { Award, Cake, UserPlus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { recordHref } from "@/lib/record-routes";
import { getHomeFeed } from "@/modules/comms/service";
import { AnnouncementCards, KudosCards } from "@/modules/comms/ui/cards";
import { IconTile } from "@/modules/core-hr/ui/me-menu";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("home");

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
  const dateLine = format.dateTime(new Date(`${feed.today}T12:00:00+07:00`), { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Ho_Chi_Minh" });

  return (
    <Page>
      <PageHeader eyebrow={dateLine} title={t("home.greeting", { name: givenName })}>
        <div className="flex flex-wrap gap-1.5 pt-1">
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
      </PageHeader>

      {waiting > 0 ? (
        <Alert variant="info">
          <AlertTitle>{t("home.pending.title")}</AlertTitle>
          <ul className="flex w-full flex-col gap-1 text-sm">
            {pending.approvals > 0 ? (
              <li>
                <Link href="/approvals">{t("home.pending.approvals", { count: pending.approvals })}</Link>
              </li>
            ) : null}
            {pending.acks.length > 0 ? (
              <li className="flex flex-col gap-1">
                <Link href="/kb/acknowledgements">{t("home.pending.acks", { count: pending.acks.length })}</Link>
                <ul className="ml-4 list-disc text-foreground/80">
                  {pending.acks.slice(0, 5).map((ack) => (
                    <li key={ack.pageId}>
                      <Link href={recordHref("kbPage", ack.pageId)}>{ack.title}</Link> — {ack.overdue ? <span className="text-destructive">{t("home.pending.overdue")}</span> : t("home.pending.dueOn", { date: isoDay(ack.dueOn) })}
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
            {pending.announcements.length > 0 ? (
              <li className="flex flex-col gap-1">
                <span>{t("home.pending.announcements", { count: pending.announcements.length })}</span>
                <ul className="ml-4 list-disc text-foreground/80">
                  {pending.announcements.map((card) => (
                    <li key={card.id}>
                      <Link href={recordHref("announcement", card.id)}>{card.title}</Link>
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        </Alert>
      ) : null}

      <Section title={t("home.announcements")} action={<Link href="/announcements">{t("comms.list.all")}</Link>}>
        <AnnouncementCards cards={feed.announcements} empty={t("home.noAnnouncements")} />
      </Section>

      {staff ? (
        <>
          <div className="grid gap-6 md:grid-cols-3 md:gap-4">
            <Section title={t("home.joiners")} count={feed.joiners.length || undefined}>
              <List>
                {feed.joiners.length === 0 ? <ListEmpty>{t("home.nothingThisWeek")}</ListEmpty> : null}
                {feed.joiners.map((person) => (
                  <ListItem key={person.personId} href={recordHref("person", person.personId)} className="press">
                    <IconTile>
                      <UserPlus aria-hidden />
                    </IconTile>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{person.fullName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[person.positionName, person.departmentName, person.entityName].filter(Boolean).join(" · ")} — {t("home.joinedOn", { date: isoDay(person.startDate) })}
                      </span>
                    </span>
                  </ListItem>
                ))}
              </List>
            </Section>
            <Section title={t("home.birthdays")} count={feed.birthdays.length || undefined}>
              <List>
                {feed.birthdays.length === 0 ? <ListEmpty>{t("home.nothingThisWeek")}</ListEmpty> : null}
                {feed.birthdays.map((person) => (
                  <ListItem key={person.personId}>
                    <IconTile className="bg-tone-pink/10 text-tone-pink">
                      <Cake aria-hidden />
                    </IconTile>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <RecordLink kind="person" id={person.personId} className="truncate font-medium">
                        {person.fullName}
                      </RecordLink>
                      <span className="truncate text-xs text-muted-foreground">{when(person.inDays, person.month, person.day)}</span>
                    </span>
                  </ListItem>
                ))}
              </List>
            </Section>
            <Section title={t("home.anniversaries")} count={feed.anniversaries.length || undefined}>
              <List>
                {feed.anniversaries.length === 0 ? <ListEmpty>{t("home.nothingThisWeek")}</ListEmpty> : null}
                {feed.anniversaries.map((person) => (
                  <ListItem key={person.personId}>
                    <IconTile className="bg-tone-orange/10 text-tone-orange">
                      <Award aria-hidden />
                    </IconTile>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <RecordLink kind="person" id={person.personId} className="truncate font-medium">
                        {person.fullName}
                      </RecordLink>
                      <span className="truncate text-xs text-muted-foreground">
                        {t("home.years", { years: person.years })}, {when(person.inDays, person.month, person.day)}
                      </span>
                    </span>
                  </ListItem>
                ))}
              </List>
            </Section>
          </div>

          <Section title={t("home.kudos")} action={<Link href="/kudos">{t("home.giveKudos")}</Link>}>
            <KudosCards cards={feed.kudos} empty={t("home.noKudos")} />
          </Section>
        </>
      ) : null}

      {feed.newPages.length > 0 ? (
        <Section title={t("home.newPages")} count={feed.newPages.length}>
          <List>
            {feed.newPages.map((page) => (
              <ListItem key={page.pageId} href={recordHref("kbPage", page.pageId)} className="press flex-wrap gap-x-3 gap-y-0.5">
                <span className="min-w-0 flex-1 truncate font-medium">{page.title}</span>
                <span className="text-xs text-faint">
                  {page.spaceName}
                  {page.at ? ` · ${format.dateTime(page.at, { dateStyle: "medium" })}` : ""}
                </span>
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}
    </Page>
  );
}
