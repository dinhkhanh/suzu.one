import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { listProfileChanges } from "@/modules/core-hr/change-requests";
import { getPersonView } from "@/modules/core-hr/service";
import { ChangeRequestForm } from "@/modules/core-hr/ui/change-request-forms";
import { ResignationForm } from "@/modules/core-hr/ui/lifecycle-forms";
import { PersonEquipment } from "@/modules/assets/ui/person-equipment";
import { LifecycleSection } from "@/modules/core-hr/ui/lifecycle-section";
import { RecordSections } from "@/modules/core-hr/ui/record-sections";
import { listRequestsAbout } from "@/modules/platform/approvals/service";
import { todayInVietnam } from "@/lib/dates";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "My profile" };

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? "—"}</dd>
    </div>
  );
}

// Self-service (FR-CHR-12): everything the company holds about the signed-in person, read-only.
// Not behind the People feature flag — seeing your own data does not wait for a pilot.
export default async function MyProfilePage() {
  const user = await requireUser();
  const viewer = { personId: user.person.id, principal: user.principal };
  const [person, requests] = await Promise.all([getPersonView(user.principal, user.person.id), listProfileChanges(viewer, user.person.id)]);
  if (!person?.personal) notFound();

  const t = await getTranslations("people");
  const tc = await getTranslations("changeRequests");
  const format = await getFormatter();
  const day = (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : null);
  const { personal } = person;
  const profile = personal.profile;
  const hasOpenRequest = (requests ?? []).some((request) => request.status === "pending" || request.status === "returned");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{person.fullName}</h1>
        <p className="text-sm text-muted-foreground">{[person.employeeCode, person.current?.positionName, person.current?.departmentName, person.entityName].filter(Boolean).join(" · ")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("sections.employment")}</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("fields.workEmail")}>{person.workEmail}</Fact>
          <Fact label={t("fields.workforceType")}>{personal.current ? t(`workforceType.${personal.current.workforceType}`) : null}</Fact>
          <Fact label={t("fields.managerId")}>{person.current?.managerName}</Fact>
          <Fact label={t("fields.team")}>{person.current?.teamName}</Fact>
          <Fact label={t("fields.startDate")}>{day(personal.startDate)}</Fact>
          <Fact label={t("fields.seniorityDate")}>{day(personal.seniorityDate)}</Fact>
          <Fact label={t("fields.jobLevel")}>{personal.current?.jobLevel}</Fact>
          <Fact label={t("fields.branch")}>{personal.current?.branchName}</Fact>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("sections.personal")}</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("fields.phone")}>{profile?.phone}</Fact>
          <Fact label={t("fields.personalEmail")}>{profile?.personalEmail}</Fact>
          <Fact label={t("fields.dateOfBirth")}>{day(profile?.dateOfBirth)}</Fact>
          <Fact label={t("fields.gender")}>{profile?.gender ? t(`gender.${profile.gender}`) : null}</Fact>
          <Fact label={t("fields.maritalStatus")}>{profile?.maritalStatus ? t(`maritalStatus.${profile.maritalStatus}`) : null}</Fact>
          <Fact label={t("fields.nationality")}>{profile?.nationality}</Fact>
          <Fact label={t("fields.permanentAddress")}>{profile?.permanentAddress}</Fact>
          <Fact label={t("fields.currentAddress")}>{profile?.currentAddress}</Fact>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{tc("title")}</h2>
        <p className="text-sm text-muted-foreground">{tc("description")}</p>
        {hasOpenRequest ? (
          <p className="text-sm">{tc("oneAtATime")}</p>
        ) : (
          <ChangeRequestForm
            current={{ phone: profile?.phone ?? null, personalEmail: profile?.personalEmail ?? null, permanentAddress: profile?.permanentAddress ?? null, currentAddress: profile?.currentAddress ?? null, maritalStatus: profile?.maritalStatus ?? null }}
          />
        )}
        <RequestTable rows={requests ?? []} empty={tc("none")} showRequester={false} />
      </section>

      <RecordSections principal={user.principal} personId={user.person.id} />
      <LifecycleSection principal={user.principal} personId={user.person.id} canManage={false} employed />
      <PersonEquipment principal={user.principal} personId={user.person.id} />
      <ResignationBlock personId={user.person.id} />
    </div>
  );
}

// Last on the page on purpose. A resignation is a request like any other: the line manager answers, HR carries it out.
async function ResignationBlock({ personId }: { personId: string }) {
  const t = await getTranslations("lifecycle");
  const requests = await listRequestsAbout("resignation", personId);
  const open = requests.some((request) => request.status === "pending" || request.status === "returned" || request.status === "approved");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("resign.section")}</h2>
      {requests.length > 0 ? <RequestTable rows={requests} empty="" showRequester={false} /> : null}
      {open ? null : <ResignationForm today={todayInVietnam()} />}
    </section>
  );
}
