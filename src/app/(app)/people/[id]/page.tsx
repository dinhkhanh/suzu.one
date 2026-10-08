import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { addDays, todayInVietnam } from "@/lib/dates";
import { jobTitle } from "@/lib/job-levels";
import type { RecordKind } from "@/lib/record-routes";
import { listProfileChanges } from "@/modules/core-hr/change-requests";
import { canBrowsePeople, canChangePhoto, canEditCompetencies } from "@/modules/core-hr/policy";
import { getPersonTarget, getPersonView, loadPlacementOptions, peopleModuleOpen } from "@/modules/core-hr/service";
import { AssignmentForm, PastAssignmentForm } from "@/modules/core-hr/ui/assignment-form";
import { EditPersonForm } from "@/modules/core-hr/ui/edit-person-form";
import { Fact, FactSheet } from "@/modules/core-hr/ui/fact-sheet";
import { PersonCompetencies } from "@/modules/core-hr/ui/competencies";
import { PersonAvatar } from "@/modules/core-hr/ui/person-avatar";
import { PhotoEditor } from "@/modules/core-hr/ui/photo-editor";
import { ProjectPositions } from "@/modules/core-hr/ui/project-positions";
import { RehireForm, SuspensionForm, TransferEntityForm } from "@/modules/core-hr/ui/lifecycle-forms";
import { listEmploymentsOf } from "@/modules/core-hr/corrections";
import { canRemovePerson } from "@/modules/core-hr/policy";
import { CorrectEmploymentButton, RemovePersonForm } from "@/modules/core-hr/ui/correction-forms";
import { List, ListItem } from "@/components/ui/list";
import { PersonEquipment } from "@/modules/assets/ui/person-equipment";
import { PersonDocuments } from "@/modules/documents/ui/person-documents";
import { PersonSalaryHistory } from "@/modules/payroll/ui/person-salary-history";
import { LifecycleSection } from "@/modules/core-hr/ui/lifecycle-section";
import { RecordSections } from "@/modules/core-hr/ui/record-sections";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { impersonationTargetOf } from "@/modules/platform/auth/impersonation";
import { requireUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { ImpersonateButton } from "@/modules/platform/auth/ui/impersonation";
import { listEntities } from "@/modules/platform/org/service";
import { can, canImpersonate } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";
import { accountsManagedBy } from "@/modules/crm/service";
import { loadViewer, projectAppointmentsOf } from "@/modules/work/service";

export const generateMetadata = pageTitle("person");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PersonPage(props: PageProps<"/people/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  // Not behind the People feature flag: a colleague's name is a link everywhere in the app, and
  // what opens here is decided per viewer by `getPersonView` — the directory entry for everybody,
  // more for the person, their manager and HR. The flag holds back the list and its filters only.
  const person = UUID.test(id) ? await getPersonView(user.principal, id) : null;
  if (!person) notFound();

  const t = await getTranslations("people");
  const tLifecycle = await getTranslations("lifecycle");
  const format = await getFormatter();
  const day = (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : null);
  // A name with the way to its record; null without a name, so an empty fact still shows its dash.
  const record = (kind: RecordKind, id: string | null | undefined, name: string | null | undefined) =>
    name ? (
      <RecordLink kind={kind} id={id}>
        {name}
      </RecordLink>
    ) : null;
  const { personal } = person;
  // HR sees what the employee has asked to change; listProfileChanges answers null to everyone else.
  const rehiring = person.canManage && personal?.status === "offboarded";
  // A move to another entity is for someone employed now, by HR of both entities (the action re-checks).
  const today = todayInVietnam();
  const transferring = person.canManage && !!personal?.startDate && personal.startDate < today && personal.endDate === null && !!person.entityId;
  const [changeRequests, options, pastOptions, otherEntityOptions, entities, borrowable, target, managed, appointments, directoryOpen, employments] = await Promise.all([
    person.id === user.person.id ? null : listProfileChanges({ personId: user.person.id, principal: user.principal }, person.id, "pending"),
    person.canManage && person.entityId ? loadPlacementOptions(person.entityId) : null,
    // Work history that is already over (roll-out): only for someone who started before today.
    person.canManage && person.entityId && personal?.startDate && personal.startDate < today ? loadPlacementOptions(person.entityId, { includeInactive: true }) : null,
    rehiring || transferring ? loadPlacementOptions() : null,
    rehiring || transferring ? listEntities() : [],
    // Seeing the app as this person (FR-PLT-40): offered to whoever holds the permission at all and
    // is not already borrowing, then decided against their grants and this person's own.
    !user.impersonator && person.id !== user.person.id && can(user.principal, "auth:impersonate") ? impersonationTargetOf(person.id) : null,
    getPersonTarget(person.id),
    // The clients this person looks after (FR-CRM-46): directory information, like their team.
    user.principal.workforceType === "collaborator" ? new Map<string, { id: string; name: string }[]>() : accountsManagedBy([person.id]),
    // The posts held in running projects: the automatic half of the position, as far as this viewer may open each project.
    loadViewer(user).then((viewer) => projectAppointmentsOf(viewer, person.id)),
    // A skill on the profile leads to everyone who holds it — for a viewer who has the directory.
    canBrowsePeople(user.principal) ? peopleModuleOpen(user) : false,
    // Each employment period, for HR to correct its first day and code (CHR-02).
    person.canManage ? listEmploymentsOf(person.id) : [],
  ]);
  const photoEditable = canChangePhoto(user.principal, target);
  const accounts = managed.get(person.id) ?? [];
  const impersonable = !!borrowable && canImpersonate(user.principal, borrowable.target);
  const manageableEntities = entities.filter((entity) => entity.isActive && can(user.principal, "person:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const transferTargets = transferring ? manageableEntities.filter((entity) => entity.id !== person.entityId) : [];

  return (
    <Page>
      <div className="flex items-start gap-4">
        <PersonAvatar person={person} className="mt-0.5 size-16 text-xl" />
        <PageHeader
          eyebrow={person.employeeCode}
          title={person.fullName}
          description={[person.current?.positionName, record("unit", person.current?.departmentId, person.current?.departmentName), record("entity", person.entityId, person.entityName)].filter(Boolean).map((part, index) => (
            <Fragment key={index}>
              {index ? " · " : null}
              {part}
            </Fragment>
          ))}
          actions={
            photoEditable || impersonable ? (
              <>
                {impersonable ? <ImpersonateButton personId={person.id} /> : null}
                {photoEditable ? <PhotoEditor person={person} compact /> : null}
              </>
            ) : null
          }
          className="min-w-0 flex-1 md:items-start"
        >
          {personal && personal.status !== "active" ? (
            <div className="pt-1">
              <Badge dot variant={statusTone(personal.status)}>
                {t(`status.${personal.status}`)}
              </Badge>
            </div>
          ) : null}
        </PageHeader>
      </div>

      <FactSheet>
        <Fact label={t("fields.entity")}>{record("entity", person.entityId, person.entityName)}</Fact>
        <Fact label={t("fields.workEmail")}>{person.workEmail}</Fact>
        <Fact label={t("fields.team")}>{record("unit", person.current?.teamId, person.current?.teamName)}</Fact>
        <Fact label={t("fields.managerId")}>{record("person", person.current?.managerId, person.current?.managerName)}</Fact>
        <Fact label={t("fields.jobTitle")}>{jobTitle(t, person.current)}</Fact>
        <Fact label={t("fields.position")}>{person.current?.positionName}</Fact>
        <ProjectPositions appointments={appointments} />
        {accounts.length ? (
          <Fact label={t("fields.accountsManaged")}>
            {accounts.map((account, index) => (
              <span key={account.id}>
                {index ? ", " : ""}
                <RecordLink kind="account" id={account.id}>
                  {account.name}
                </RecordLink>
              </span>
            ))}
          </Fact>
        ) : null}
      </FactSheet>

      <PersonCompetencies personId={person.id} canEdit={canEditCompetencies(user.principal, target)} browsable={directoryOpen} />

      {personal ? (
        <>
          <Section title={t("sections.employment")}>
            <FactSheet>
              <Fact label={t("fields.workforceType")}>{personal.current ? t(`workforceType.${personal.current.workforceType}`) : null}</Fact>
              <Fact label={t("fields.startDate")}>{day(personal.startDate)}</Fact>
              <Fact label={t("fields.seniorityDate")}>{day(personal.seniorityDate)}</Fact>
              <Fact label={t("fields.endDate")}>{day(personal.endDate)}</Fact>
              <Fact label={t("fields.dottedManagerId")}>{record("person", personal.current?.dottedManagerId, personal.current?.dottedManagerName)}</Fact>
              <Fact label={t("fields.branch")}>{personal.current?.branchName}</Fact>
              <Fact label={t("fields.workLocation")}>{personal.current?.workLocation}</Fact>
            </FactSheet>
          </Section>

          <Section title={t("sections.personal")}>
            <FactSheet>
              <Fact label={t("fields.phone")}>{personal.profile?.phone}</Fact>
              <Fact label={t("fields.personalEmail")}>{personal.profile?.personalEmail}</Fact>
              <Fact label={t("fields.dateOfBirth")}>{day(personal.profile?.dateOfBirth)}</Fact>
              <Fact label={t("fields.gender")}>{personal.profile?.gender ? t(`gender.${personal.profile.gender}`) : null}</Fact>
              <Fact label={t("fields.maritalStatus")}>{personal.profile?.maritalStatus ? t(`maritalStatus.${personal.profile.maritalStatus}`) : null}</Fact>
              <Fact label={t("fields.nationality")}>{personal.profile?.nationality}</Fact>
              <Fact label={t("fields.permanentAddress")}>{personal.profile?.permanentAddress}</Fact>
              <Fact label={t("fields.currentAddress")}>{personal.profile?.currentAddress}</Fact>
            </FactSheet>
          </Section>

          {person.canManage ? <EditPersonForm person={person} /> : null}

          {changeRequests?.length ? (
            <Section title={t("sections.changeRequests")}>
              <RequestTable rows={changeRequests} empty="" showRequester={false} />
            </Section>
          ) : null}

          <RecordSections principal={user.principal} personId={person.id} />

          <TableCard>
            <TableCardHeader title={t("sections.history")} count={personal.history.length || null} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="date">{t("assignment.period")}</TableHead>
                  <TableHead kind="org">{t("fields.entity")}</TableHead>
                  <TableHead kind="text">{t("fields.jobTitle")}</TableHead>
                  <TableHead kind="text">{t("fields.position")}</TableHead>
                  <TableHead kind="org">{t("fields.department")}</TableHead>
                  <TableHead kind="person">{t("fields.managerId")}</TableHead>
                  <TableHead kind="select">{t("fields.workforceType")}</TableHead>
                  <TableHead kind="text">{t("fields.changeReason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {personal.history.length === 0 ? <TableEmpty>{t("assignment.empty")}</TableEmpty> : null}
                {personal.history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {day(row.validFrom)} → {day(row.validTo) ?? t("assignment.ongoing")}
                      {row.id === personal.current?.id ? (
                        <Badge variant="secondary" className="ml-2">
                          {t("assignment.current")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <RecordLink kind="entity" id={row.entityId}>
                        {row.entityName}
                      </RecordLink>
                      <span className="ml-1 text-muted-foreground">{row.employeeCode}</span>
                    </TableCell>
                    <TableCell>{jobTitle(t, row) ?? "—"}</TableCell>
                    <TableCell>{row.positionName ?? "—"}</TableCell>
                    <TableCell>
                      {record("unit", row.departmentId, row.departmentName)}
                      {row.departmentName && row.teamName ? " · " : null}
                      {record("unit", row.teamId, row.teamName)}
                      {row.departmentName || row.teamName ? null : "—"}
                    </TableCell>
                    <TableCell>{record("person", row.managerId, row.managerName) ?? "—"}</TableCell>
                    <TableCell>{t(`workforceType.${row.workforceType}`)}</TableCell>
                    <TableCell className="text-muted-foreground">{row.changeReason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {options ? <AssignmentForm person={person} options={options} today={today} /> : null}
            {pastOptions ? <PastAssignmentForm person={person} options={pastOptions} today={addDays(today, -1)} /> : null}
            {employments.length > 0 ? (
              <List>
                {employments.map((row) => (
                  <ListItem key={row.id} className="flex-wrap gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-xs">{row.employeeCode}</span> · {row.entityName} · {day(row.startDate)} → {day(row.endDate) ?? t("assignment.ongoing")}
                      <span className="ml-1 text-muted-foreground">({t("corrections.seniorityFrom", { date: day(row.seniorityDate) ?? "" })})</span>
                    </span>
                    <CorrectEmploymentButton employment={row} />
                  </ListItem>
                ))}
              </List>
            ) : null}
            {transferring && otherEntityOptions && transferTargets.length > 0 && personal.startDate ? (
              <TransferEntityForm
                personId={person.id}
                entities={transferTargets}
                options={otherEntityOptions}
                today={today}
                minDate={addDays(personal.startDate, 1)}
                defaults={
                  personal.current
                    ? {
                        workforceType: personal.current.workforceType,
                        positionName: personal.current.positionName,
                        seniorityLevel: personal.current.seniorityLevel,
                        positionLevel: personal.current.positionLevel,
                        managerId: personal.current.managerId,
                        dottedManagerId: personal.current.dottedManagerId,
                        workLocation: personal.current.workLocation,
                      }
                    : undefined
                }
              />
            ) : null}
          </TableCard>

          {/* Compensation tier: renders only for the person and C&B; a line manager sees nothing. */}
          <PersonSalaryHistory viewer={{ personId: user.person.id, principal: user.principal }} personId={person.id} stepUpFresh={isStepUpFresh(user.reauthAt)} />

          <LifecycleSection principal={user.principal} personId={person.id} canManage={person.canManage} employed={personal.endDate === null} />
          {/* Locking the account, and looking after the approvals that wait for it (FR-PLT-05, PLT-02): HR's, and never one's own. */}
          {person.canManage && person.id !== user.person.id && (personal.status === "active" || personal.status === "suspended") ? (
            <>
              <SuspensionForm personId={person.id} suspended={personal.status === "suspended"} />
              <p className="text-sm text-muted-foreground">
                {tLifecycle("suspend.approvalsHint")}{" "}
                <Link href={`/approvals/delegation?for=${person.id}`} className="text-link underline-offset-4 hover:underline">
                  {tLifecycle("suspend.approvalsLink")}
                </Link>
              </p>
            </>
          ) : null}
          <PersonEquipment principal={user.principal} personId={person.id} />
          <PersonDocuments principal={user.principal} personId={person.id} />
          {/* A record that should never have been made (CHR-02): the service refuses once anything else names the person. */}
          {canRemovePerson(user.principal, target) ? <RemovePersonForm personId={person.id} fullName={person.fullName} /> : null}
          {/* A former employee comes back on the same record (FR-CHR-16). */}
          {rehiring && otherEntityOptions ? <RehireForm personId={person.id} today={today} defaultEntityId={person.entityId} options={otherEntityOptions} entities={manageableEntities} /> : null}
        </>
      ) : null}
    </Page>
  );
}
