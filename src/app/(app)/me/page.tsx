import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { listProfileChanges } from "@/modules/core-hr/change-requests";
import { canBrowsePeople } from "@/modules/core-hr/policy";
import { getPersonView, peopleModuleOpen } from "@/modules/core-hr/service";
import { PersonCompetencies } from "@/modules/core-hr/ui/competencies";
import { ChangeRequestForm } from "@/modules/core-hr/ui/change-request-forms";
import { Fact, FactSheet } from "@/modules/core-hr/ui/fact-sheet";
import { IconTile, MenuList } from "@/modules/core-hr/ui/me-menu";
import { PersonAvatar } from "@/modules/core-hr/ui/person-avatar";
import { PhotoEditor } from "@/modules/core-hr/ui/photo-editor";
import { ProjectPositions } from "@/modules/core-hr/ui/project-positions";
import { ResignationForm } from "@/modules/core-hr/ui/lifecycle-forms";
import { resignationBlocker } from "@/modules/core-hr/resignation";
import { PersonEquipment } from "@/modules/assets/ui/person-equipment";
import { LifecycleSection } from "@/modules/core-hr/ui/lifecycle-section";
import { RecordSections } from "@/modules/core-hr/ui/record-sections";
import { listDocumentsAbout } from "@/modules/documents/service";
import { IssuedDocumentsTable } from "@/modules/documents/ui/issued-documents";
import { getMonthSummaryFor } from "@/modules/attendance/service";
import { hoursText } from "@/modules/attendance/ui/day-plan";
import { MyFaceEnrolment } from "@/modules/attendance/ui/my-face";
import { getLeaveBalanceFor } from "@/modules/leave/service";
import { countMyOpenRequests, listRequestsAbout } from "@/modules/platform/approvals/service";
import { todayInVietnam } from "@/lib/dates";
import { jobTitle } from "@/lib/job-levels";
import { loadViewer, projectAppointmentsOf } from "@/modules/work/service";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { getTheme } from "@/theme/server";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myProfile");

// Self-service (FR-CHR-12): the hub of everything that is the signed-in person's own — the key
// figures, the way to each of their pages, then everything the company holds about them,
// read-only but for the profile picture.
// Not behind the People feature flag — seeing your own data does not wait for a pilot.
export default async function MyProfilePage() {
  const user = await requireUser();
  const viewer = { personId: user.person.id, principal: user.principal };
  const today = todayInVietnam();
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const [person, requests, balances, summary, openRequests, theme, appointments, directoryOpen] = await Promise.all([
    getPersonView(user.principal, user.person.id),
    listProfileChanges(viewer, user.person.id),
    getLeaveBalanceFor(user.principal, user.person.id, year),
    getMonthSummaryFor(user.principal, user.person.id, month),
    countMyOpenRequests(user.person.id),
    getTheme(),
    // The posts held in running projects: the automatic half of the position.
    loadViewer(user).then((viewer) => projectAppointmentsOf(viewer, user.person.id)),
    canBrowsePeople(user.principal) ? peopleModuleOpen(user) : false,
  ]);
  if (!person?.personal) notFound();

  const t = await getTranslations("people");
  const tn = await getTranslations("nav");
  const tc = await getTranslations("changeRequests");
  const format = await getFormatter();
  const day = (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : null);
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 1 });
  const { personal } = person;
  const profile = personal.profile;
  const hasOpenRequest = (requests ?? []).some((request) => request.status === "pending" || request.status === "returned");
  // The annual allowance is the figure people ask about; a person without one shows their first tracked type.
  const annual = balances?.find((row) => row.code === "ANNUAL") ?? balances?.[0] ?? null;
  const workedMinutes = summary ? summary.workedMinutes + summary.creditedMinutes : null;

  return (
    <Page>
      <div className="flex items-start gap-4">
        <PersonAvatar person={person} className="mt-0.5 size-16 text-xl" />
        <PageHeader
          eyebrow={person.employeeCode}
          title={person.fullName}
          description={[person.current?.positionName, person.current?.departmentName, person.entityName].filter(Boolean).join(" · ")}
          actions={<PhotoEditor person={person} compact />}
          className="min-w-0 flex-1 md:items-start"
        />
      </div>

      <TileGrid>
        {annual ? <Tile label={t("me.leaveLeft")} value={days(annual.availableCenti)} hint={t("me.leaveUsed", { days: days(annual.usedCenti) })} href="/leave" /> : null}
        {workedMinutes !== null && summary ? <Tile label={t("me.hoursThisMonth")} value={hoursText(workedMinutes)} hint={t("me.hoursHint", { days: summary.standardDays })} href="/attendance" /> : null}
        <Tile label={t("me.pendingRequests")} value={openRequests} hint={t("me.pendingHint")} tone={openRequests > 0 ? "warning" : undefined} href="/requests" />
      </TileGrid>

      <Section title={t("me.mine")}>
        <MenuList
          rows={[
            { key: "profile", icon: "me", href: "#profile", label: t("me.profile") },
            { key: "attendance", href: "/attendance", label: tn("attendance"), meta: workedMinutes !== null ? hoursText(workedMinutes) : undefined },
            { key: "leave", href: "/leave", label: tn("leave"), meta: annual ? t("me.days", { days: days(annual.availableCenti) }) : undefined },
            { key: "requests", href: "/requests", label: tn("requests"), meta: t("me.pendingCount", { count: openRequests }) },
            { key: "payslips", href: "/payslips", label: tn("payslips") },
            { key: "performance", href: "/performance", label: tn("performance") },
            { key: "assets", href: "/assets/mine", label: t("me.equipment") },
          ]}
        />
      </Section>

      <Section id="profile" title={t("sections.employment")} className="scroll-mt-16">
        <FactSheet>
          <Fact label={t("fields.entity")}>{person.entityName ? <RecordLink kind="entity" id={person.entityId}>{person.entityName}</RecordLink> : null}</Fact>
          <Fact label={t("fields.employeeCode")}>{person.employeeCode}</Fact>
          <Fact label={t("fields.workEmail")}>{person.workEmail}</Fact>
          <Fact label={t("fields.workforceType")}>{personal.current ? t(`workforceType.${personal.current.workforceType}`) : null}</Fact>
          <Fact label={t("fields.managerId")}>{person.current?.managerName ? <RecordLink kind="person" id={person.current.managerId}>{person.current.managerName}</RecordLink> : null}</Fact>
          <Fact label={t("fields.team")}>{person.current?.teamName ? <RecordLink kind="unit" id={person.current.teamId}>{person.current.teamName}</RecordLink> : null}</Fact>
          <Fact label={t("fields.startDate")}>{day(personal.startDate)}</Fact>
          <Fact label={t("fields.seniorityDate")}>{day(personal.seniorityDate)}</Fact>
          <Fact label={t("fields.jobTitle")}>{jobTitle(t, person.current)}</Fact>
          <Fact label={t("fields.position")}>{person.current?.positionName}</Fact>
          <ProjectPositions appointments={appointments} />
          <Fact label={t("fields.branch")}>{personal.current?.branchName}</Fact>
        </FactSheet>
      </Section>

      {/* Yours to keep up, straight away: what you are good at is not a fact HR vouches for. */}
      <PersonCompetencies personId={user.person.id} canEdit browsable={directoryOpen} />

      <Section title={t("sections.personal")}>
        <FactSheet>
          <Fact label={t("fields.phone")}>{profile?.phone}</Fact>
          <Fact label={t("fields.personalEmail")}>{profile?.personalEmail}</Fact>
          <Fact label={t("fields.dateOfBirth")}>{day(profile?.dateOfBirth)}</Fact>
          <Fact label={t("fields.gender")}>{profile?.gender ? t(`gender.${profile.gender}`) : null}</Fact>
          <Fact label={t("fields.maritalStatus")}>{profile?.maritalStatus ? t(`maritalStatus.${profile.maritalStatus}`) : null}</Fact>
          <Fact label={t("fields.nationality")}>{profile?.nationality}</Fact>
          <Fact label={t("fields.permanentAddress")}>{profile?.permanentAddress}</Fact>
          <Fact label={t("fields.currentAddress")}>{profile?.currentAddress}</Fact>
        </FactSheet>
      </Section>

      <Section title={tc("title")}>
        <p className="text-sm text-muted-foreground">{tc("description")}</p>
        {hasOpenRequest ? (
          <p className="text-sm">{tc("oneAtATime")}</p>
        ) : (
          <ChangeRequestForm
            current={{ phone: profile?.phone ?? null, personalEmail: profile?.personalEmail ?? null, permanentAddress: profile?.permanentAddress ?? null, currentAddress: profile?.currentAddress ?? null, maritalStatus: profile?.maritalStatus ?? null }}
          />
        )}
        <RequestTable rows={requests ?? []} empty={tc("none")} showRequester={false} />
      </Section>

      <RecordSections principal={user.principal} personId={user.person.id} />
      <MyLetters principal={user.principal} personId={user.person.id} />
      <LifecycleSection principal={user.principal} personId={user.person.id} canManage={false} employed />
      <PersonEquipment principal={user.principal} personId={user.person.id} />
      <MyFaceEnrolment personId={user.person.id} />
      <ResignationBlock personId={user.person.id} />

      <Section title={t("me.preferences")}>
        <List>
          <ListItem>
            <IconTile name="language" className="bg-muted text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{tn("language")}</span>
            <LocaleSwitch />
          </ListItem>
          <ListItem>
            <IconTile name="appearance" className="bg-muted text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{tn("appearance")}</span>
            <ThemeSwitch theme={theme} />
          </ListItem>
          <ListItem href="/notifications#settings" className="press">
            <IconTile name="notificationSettings" className="bg-muted text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{tn("notificationSettings")}</span>
            <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
          </ListItem>
        </List>
        {/* The desk signs out from the sidebar; the phone has no sidebar, so the key is here. */}
        <div className="md:hidden [&_button]:h-11 [&_button]:w-full [&_button]:text-destructive [&_button_svg]:text-destructive">
          <SignOutButton label={tn("signOut")} />
        </div>
      </Section>
    </Page>
  );
}

// The contracts, decisions and letters issued about the person, as they were issued (FR-CHR-12).
async function MyLetters({ principal, personId }: { principal: Parameters<typeof listDocumentsAbout>[1]; personId: string }) {
  const [t, rows] = await Promise.all([getTranslations("documents"), listDocumentsAbout(personId, principal)]);
  return <IssuedDocumentsTable rows={rows} title={t("mine.title")} empty={t("mine.empty")} />;
}

// Last on the page on purpose. A resignation is a request like any other: the line manager answers, HR carries it out.
// The form is offered whenever nothing about the *current* employment stands in the way — so it
// comes back after a rehire, or after HR called the termination off (CHR-03).
async function ResignationBlock({ personId }: { personId: string }) {
  const t = await getTranslations("lifecycle");
  const [requests, blocker] = await Promise.all([listRequestsAbout("resignation", personId), resignationBlocker(personId)]);
  return (
    <Section title={t("resign.section")}>
      {requests.length > 0 ? <RequestTable rows={requests} empty="" showRequester={false} /> : null}
      {blocker === null ? <ResignationForm today={todayInVietnam()} /> : null}
    </Section>
  );
}
