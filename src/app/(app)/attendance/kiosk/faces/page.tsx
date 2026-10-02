import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { faceStatusOf } from "@/modules/attendance/faces";
import { canEnrolFaceOf } from "@/modules/attendance/policy";
import { DeleteFacesButton, EnrolFaceButton } from "@/modules/attendance/ui/kiosk/kiosk-admin";
import { getPersonTargets, listEmploymentFacts } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { entityReach } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("kioskFaces");

// Whose face the kiosks know, with the consent behind it (FR-ATT-06). Biometric data: read fresh,
// never cached, and only for the people the viewer may enrol.
export default async function KioskFacesPage() {
  const user = await requireUser();
  const t = await getTranslations("attendance.kiosk.faces");
  const format = await getFormatter();
  const reach = entityReach(user.principal, "attendance:kiosk");
  const [facts, entities] = await Promise.all([listEmploymentFacts(reach.all ? {} : { entityIds: reach.entityIds }), listEntities()]);
  const working = facts.filter((fact) => fact.status === "active" || fact.status === "preboarding");
  const targets = await getPersonTargets(working.map((fact) => fact.personId));
  const people = working.filter((fact) => targets.has(fact.personId) && canEnrolFaceOf(user.principal, targets.get(fact.personId)!)).sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
  const status = await faceStatusOf(people.map((person) => person.personId));
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const enrolled = people.filter((person) => (status.get(person.personId)?.templates ?? 0) > 0).length;

  return (
    <TableCard>
      <TableCardHeader title={t("listTitle")} count={`${enrolled}/${people.length}`} description={t("listHint")} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("person")}</TableHead>
            <TableHead kind="org">{t("entity")}</TableHead>
            <TableHead kind="status">{t("status")}</TableHead>
            <TableHead kind="date">{t("consentAt")}</TableHead>
            <TableHead kind="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
          {people.map((person) => {
            const face = status.get(person.personId);
            const templates = face?.templates ?? 0;
            return (
              <TableRow key={person.personId}>
                <TableCell className="font-medium text-foreground">
                  {person.fullName}
                  {person.employeeCode ? <span className="font-normal text-muted-foreground"> · {person.employeeCode}</span> : null}
                </TableCell>
                <TableCell>{person.entityId ? entityName.get(person.entityId) : "—"}</TableCell>
                <TableCell>{templates > 0 ? <Badge variant="success" dot>{t("enrolled", { count: templates })}</Badge> : <Badge variant="secondary">{t("notEnrolled")}</Badge>}</TableCell>
                <TableCell kind="date">{face ? format.dateTime(face.consentAt, { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) : "—"}</TableCell>
                <TableCell kind="actions">
                  <div className="flex items-center justify-end gap-1">
                    <EnrolFaceButton personId={person.personId} personName={person.fullName} enrolled={!!face} />
                    {face ? <DeleteFacesButton personId={person.personId} personName={person.fullName} /> : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}
