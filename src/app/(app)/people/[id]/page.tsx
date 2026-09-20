import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { listProfileChanges } from "@/modules/core-hr/change-requests";
import { getPersonView, loadPlacementOptions, peopleModuleOpen } from "@/modules/core-hr/service";
import { AssignmentForm } from "@/modules/core-hr/ui/assignment-form";
import { EditPersonForm } from "@/modules/core-hr/ui/edit-person-form";
import { RehireForm } from "@/modules/core-hr/ui/lifecycle-forms";
import { PersonEquipment } from "@/modules/assets/ui/person-equipment";
import { LifecycleSection } from "@/modules/core-hr/ui/lifecycle-section";
import { RecordSections } from "@/modules/core-hr/ui/record-sections";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Person" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? "—"}</dd>
    </div>
  );
}

export default async function PersonPage(props: PageProps<"/people/[id]">) {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user))) notFound();
  const { id } = await props.params;
  const person = UUID.test(id) ? await getPersonView(user.principal, id) : null;
  if (!person) notFound();

  const t = await getTranslations("people");
  const format = await getFormatter();
  const day = (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : null);
  const personLink = (personId: string | null, name: string | null) => (personId && name ? <Link href={`/people/${personId}`} className="hover:underline">{name}</Link> : null);
  const { personal } = person;
  // HR sees what the employee has asked to change; listProfileChanges answers null to everyone else.
  const changeRequests = person.id === user.person.id ? null : await listProfileChanges({ personId: user.person.id, principal: user.principal }, person.id, "pending");
  const options = person.canManage && person.entityId ? await loadPlacementOptions(person.entityId) : null;

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{person.fullName}</h1>
          {personal && personal.status !== "active" ? <Badge variant="outline">{t(`status.${personal.status}`)}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {[person.employeeCode, person.current?.positionName, person.current?.departmentName, person.entityName].filter(Boolean).join(" · ")}
        </p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("fields.workEmail")}>{person.workEmail}</Fact>
        <Fact label={t("fields.team")}>{person.current?.teamName}</Fact>
        <Fact label={t("fields.managerId")}>{personLink(person.current?.managerId ?? null, person.current?.managerName ?? null)}</Fact>
      </dl>

      {personal ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("sections.employment")}</h2>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={t("fields.workforceType")}>{personal.current ? t(`workforceType.${personal.current.workforceType}`) : null}</Fact>
              <Fact label={t("fields.startDate")}>{day(personal.startDate)}</Fact>
              <Fact label={t("fields.seniorityDate")}>{day(personal.seniorityDate)}</Fact>
              <Fact label={t("fields.endDate")}>{day(personal.endDate)}</Fact>
              <Fact label={t("fields.jobLevel")}>{personal.current?.jobLevel}</Fact>
              <Fact label={t("fields.dottedManagerId")}>{personLink(personal.current?.dottedManagerId ?? null, personal.current?.dottedManagerName ?? null)}</Fact>
              <Fact label={t("fields.branch")}>{personal.current?.branchName}</Fact>
              <Fact label={t("fields.workLocation")}>{personal.current?.workLocation}</Fact>
            </dl>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("sections.personal")}</h2>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={t("fields.phone")}>{personal.profile?.phone}</Fact>
              <Fact label={t("fields.personalEmail")}>{personal.profile?.personalEmail}</Fact>
              <Fact label={t("fields.dateOfBirth")}>{day(personal.profile?.dateOfBirth)}</Fact>
              <Fact label={t("fields.gender")}>{personal.profile?.gender ? t(`gender.${personal.profile.gender}`) : null}</Fact>
              <Fact label={t("fields.maritalStatus")}>{personal.profile?.maritalStatus ? t(`maritalStatus.${personal.profile.maritalStatus}`) : null}</Fact>
              <Fact label={t("fields.nationality")}>{personal.profile?.nationality}</Fact>
              <Fact label={t("fields.permanentAddress")}>{personal.profile?.permanentAddress}</Fact>
              <Fact label={t("fields.currentAddress")}>{personal.profile?.currentAddress}</Fact>
            </dl>
          </section>

          {person.canManage ? <EditPersonForm person={person} /> : null}

          {changeRequests?.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">{t("sections.changeRequests")}</h2>
              <RequestTable rows={changeRequests} empty="" showRequester={false} />
            </section>
          ) : null}

          <RecordSections principal={user.principal} personId={person.id} />

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("sections.history")}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("assignment.period")}</TableHead>
                  <TableHead>{t("fields.position")}</TableHead>
                  <TableHead>{t("fields.department")}</TableHead>
                  <TableHead>{t("fields.managerId")}</TableHead>
                  <TableHead>{t("fields.workforceType")}</TableHead>
                  <TableHead>{t("fields.changeReason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {personal.history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      {t("assignment.empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  personal.history.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        {day(row.validFrom)} → {day(row.validTo) ?? t("assignment.ongoing")}
                        {row.id === personal.current?.id ? (
                          <Badge variant="secondary" className="ml-2">
                            {t("assignment.current")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.positionName ?? "—"}</TableCell>
                      <TableCell>{[row.departmentName, row.teamName].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell>{row.managerName ?? "—"}</TableCell>
                      <TableCell>{t(`workforceType.${row.workforceType}`)}</TableCell>
                      <TableCell className="text-muted-foreground">{row.changeReason ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {options ? <AssignmentForm person={person} options={options} today={todayInVietnam()} /> : null}
          </section>

          <LifecycleSection principal={user.principal} personId={person.id} canManage={person.canManage} employed={personal.endDate === null} />
          <PersonEquipment principal={user.principal} personId={person.id} />
          {/* A former employee comes back on the same record (FR-CHR-16). */}
          {person.canManage && personal.status === "offboarded" ? (
            <RehireForm
              personId={person.id}
              today={todayInVietnam()}
              defaultEntityId={person.entityId}
              options={await loadPlacementOptions()}
              entities={(await listEntities()).filter((entity) => entity.isActive && can(user.principal, "person:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }))}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
