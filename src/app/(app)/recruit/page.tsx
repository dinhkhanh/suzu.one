import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { initialsOf } from "@/lib/text";
import { requireUser } from "@/modules/platform/auth/session";
import { listMyInterviews } from "@/modules/recruit/interviews";
import { canReadRecruitReports } from "@/modules/recruit/policy";
import { canBrowseCandidates, canManagePipelines, canRunRecruitment, getOpeningView, listApplications, listOpenings, recruitModuleOpen } from "@/modules/recruit/service";
import { type BoardFlag, PipelineBoard } from "@/modules/recruit/ui/pipeline-board";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("recruitment");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The openings the reader may see: everything in their recruitment scope, plus the ones they are
// on the hiring team of. A department head hiring one editor sees exactly one row here. The
// pipeline of one opening (the first, or `?opening=`) is drawn as the board, with today's
// interviews beside it.
export default async function RecruitPage({ searchParams }: PageProps<"/recruit">) {
  const user = await requireUser();
  const params = await searchParams;
  // The list is scoped by itself, so it can be read alongside the navigation check.
  const [open, t, format, openings, interviews] = await Promise.all([recruitModuleOpen(user.principal, user.person.id), getTranslations("recruit"), getFormatter(), listOpenings(user.principal), listMyInterviews(user.person.id)]);
  if (!open) notFound();
  const runs = canRunRecruitment(user.principal);
  const viewer = { principal: user.principal, personId: user.person.id };

  // The opening on the board: the one asked for, else the first one still taking candidates.
  const wanted = typeof params.opening === "string" && UUID.test(params.opening) ? params.opening : null;
  const live = openings.filter((opening) => opening.status !== "closed" && opening.status !== "filled");
  const tabs = live.length > 0 ? live : openings;
  const current = tabs.find((opening) => opening.id === wanted) ?? tabs[0] ?? null;
  const [view, applications] = current ? await Promise.all([getOpeningView(viewer, current.id), listApplications(viewer, current.id, { status: "active" })]) : [null, []];

  const today = todayInVietnam();
  const todays = interviews.filter((row) => row.status === "scheduled" && todayInVietnam(row.startAt) === today).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const flagOf = (row: (typeof applications)[number]): BoardFlag | null => (row.source === "referral" ? "referral" : row.daysInStage <= 1 ? "new" : null);

  const sections = [
    { href: "/recruit/hiring", label: t("hiring"), shown: true },
    { href: "/recruit/candidates", label: t("candidates"), shown: canBrowseCandidates(user.principal) },
    // The offer desk. The list carries no figure at all; one offer's page decides that.
    { href: "/recruit/offers", label: t("offer.title"), shown: runs },
    // The funnel, time to hire and source effectiveness (FR-REC-11). Counted only over the
    // openings this reader could open one at a time, so the entry follows `report:read`.
    { href: "/recruit/reports", label: t("reports.title"), shown: canReadRecruitReports(user.principal) },
    { href: "/recruit/referrals", label: t("referral.title"), shown: runs },
    // The wordings are the group's, so the entry shows for a group-wide grant only.
    { href: "/recruit/emails", label: t("email.title"), shown: canManagePipelines(user.principal) },
  ].filter((section) => section.shown);

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Link href="/careers" className={buttonVariants({ variant: "outline" })}>
              {t("home.careers")}
            </Link>
            {runs ? (
              <Link href="/recruit/openings/new" className={buttonVariants()}>
                {t("home.newOpening")}
              </Link>
            ) : null}
          </>
        }
      >
        {/* The module's other desks: a row that scrolls on a phone and wraps on a desk. */}
        <nav className="-mx-4 mt-1 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          {sections.map((section) => (
            <Link key={section.href} href={section.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {section.label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      {tabs.length > 0 ? (
        <nav className="tab-row" aria-label={t("home.openingsLabel")}>
          {tabs.map((opening) => (
            <Link key={opening.id} href={`/recruit?opening=${opening.id}`} aria-current={opening.id === current?.id ? "page" : undefined}>
              {opening.title}
              <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{opening.activeApplications}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {current && view ? (
        <Section
          title={t("home.pipeline")}
          count={applications.length || null}
          action={
            <>
              <Link href={`/recruit/${current.id}`}>{t("home.openOpening")}</Link>
              <Link href={`/recruit/${current.id}/board`}>{t("home.board")}</Link>
            </>
          }
        >
          {applications.length === 0 ? (
            <List>
              <ListEmpty>{t("home.noActive")}</ListEmpty>
            </List>
          ) : (
            <PipelineBoard
              stages={view.stages.map((stage) => ({ id: stage.id, name: stage.name }))}
              cards={applications.map((row) => ({ id: row.id, candidateName: row.candidateName, currentTitle: row.currentTitle, stageId: row.stageId, days: row.daysInStage, source: row.source, flag: flagOf(row) }))}
            />
          )}
        </Section>
      ) : null}

      <Section title={t("home.interviewsToday")} count={todays.length || null} action={<Link href="/recruit/interviews">{t("interview.mine")}</Link>}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="time">{t("interview.time")}</TableHead>
                <TableHead kind="person">{t("columns.candidate")}</TableHead>
                <TableHead kind="select">{t("interview.kind")}</TableHead>
                <TableHead kind="person">{t("interview.interviewers")}</TableHead>
                <TableHead kind="place">{t("interview.location")}</TableHead>
                <TableHead kind="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {todays.length === 0 ? <TableEmpty>{t("home.noInterviewsToday")}</TableEmpty> : null}
              {todays.map((row) => (
                <TableRow key={row.id}>
                  <TableCell kind="time">{format.dateTime(row.startAt, { timeStyle: "short" })}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.candidateName}</div>
                    <div className="truncate text-xs text-faint">{row.openingTitle}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`interview.kinds.${row.kind}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <AvatarGroup>
                      {row.interviewers.map((person) => (
                        <Avatar key={person.personId} size="sm" title={person.fullName}>
                          <AvatarFallback>{initialsOf(person.fullName)}</AvatarFallback>
                        </Avatar>
                      ))}
                    </AvatarGroup>
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">{row.location || t(`interview.modes.${row.mode}`)}</TableCell>
                  <TableCell kind="actions">
                    <Link href={`/recruit/interviews/${row.id}`} className={buttonVariants({ variant: "outline", size: "xs" })}>
                      {t("home.openInterview")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>

      <Section title={t("home.allOpenings")} count={openings.length || null}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("columns.title")}</TableHead>
                <TableHead kind="id">{t("columns.code")}</TableHead>
                <TableHead kind="org">{t("columns.entity")}</TableHead>
                <TableHead kind="org">{t("columns.department")}</TableHead>
                <TableHead kind="number">{t("columns.headcount")}</TableHead>
                <TableHead kind="number">{t("columns.applications")}</TableHead>
                <TableHead kind="number">{t("columns.hired")}</TableHead>
                <TableHead kind="date">{t("columns.published")}</TableHead>
                <TableHead kind="status">{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openings.length === 0 ? <TableEmpty>{t("noOpenings")}</TableEmpty> : null}
              {openings.map((opening) => (
                <TableRow key={opening.id}>
                  <TableCell className="max-w-80 truncate">
                    <Link href={`/recruit/${opening.id}`} className="font-medium hover:underline">
                      {opening.title}
                    </Link>
                  </TableCell>
                  <TableCell kind="id">{opening.code}</TableCell>
                  <TableCell>{opening.entityName ?? "—"}</TableCell>
                  <TableCell>{opening.departmentName ?? "—"}</TableCell>
                  <TableCell kind="number">{opening.headcount}</TableCell>
                  <TableCell kind="number">{opening.activeApplications}</TableCell>
                  <TableCell kind="number">{opening.hiredCount}</TableCell>
                  <TableCell>{opening.publishedAt ? format.dateTime(opening.publishedAt, { dateStyle: "medium" }) : "—"}</TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(opening.status)}>{t(`status.${opening.status}`)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {runs ? <TableAddRow label={t("newOpening")} href="/recruit/openings/new" /> : null}
        </TableCard>
      </Section>

      <p className="text-xs text-faint">{t("confidential")}</p>
    </Page>
  );
}
