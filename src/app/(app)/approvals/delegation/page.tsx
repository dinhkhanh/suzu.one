import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { listDelegations } from "@/modules/platform/approvals/delegations";
import { canDelegateFor, canReassignTurns } from "@/modules/platform/approvals/policy";
import { listTurnsOf, placeOfPerson } from "@/modules/platform/approvals/service";
import { PersonName } from "@/modules/platform/approvals/ui/person-name";
import { DelegationForm, RevokeDelegationButton } from "@/modules/platform/approvals/ui/delegation-forms";
import { ReassignDialog } from "@/modules/platform/approvals/ui/request-tools";
import { RequestAge } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { allRequestTypes } from "../registry";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("delegation");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "While I am away, my approvals go to …" — everyone manages their own (FR-PLT-22).
//
// With `?for=<person>` it is the same screen for somebody else: whoever holds `person:manage` over
// a person who is away or suspended sets a delegation in their name, ends one, and moves on the
// requests that are waiting for them (FR-ACL-06, PLT-02). Reached from the person's page.
export default async function DelegationPage({ searchParams }: PageProps<"/approvals/delegation">) {
  const user = await requireUser();
  const query = await searchParams;
  const today = todayInVietnam();
  const forId = typeof query.for === "string" && UUID.test(query.for) && query.for !== user.person.id ? query.for : null;
  if (forId && !canDelegateFor(user.principal, await placeOfPerson(forId))) notFound();
  const personId = forId ?? user.person.id;

  const [t, format, locale, { given, received }, people, registered, turns] = await Promise.all([getTranslations("approvals"), getFormatter(), getLocale(), listDelegations(personId), listPersonNames(), allRequestTypes(), forId ? listTurnsOf(forId) : []]);
  // The directory leaves out people who have left; so does this screen — their turns moved when they did.
  const absent = forId ? people.find((person) => person.id === forId) : null;
  if (forId && !absent) notFound();
  // A type built in the request designer carries its own name in each language.
  const label = (type: string) => registered.get(type)?.names?.[locale === "en" ? "en" : "vi"] ?? (t.has(`types.${type}`) ? t(`types.${type}` as "types.profile_change") : type);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const types = (row: { requestTypes: string[] | null }) => (row.requestTypes ? row.requestTypes.map(label).join(", ") : t("delegation.allTypes"));
  const current = received.filter((row) => row.validTo >= today);
  // A turn is moved by whoever answers for the person the request is about — not for the approver.
  const movable = turns.filter((row) => canReassignTurns(user.principal, row, row.reassignTarget));

  return (
    <Page>
      <PageHeader
        eyebrow={t("title")}
        title={absent ? t("delegation.onBehalf.title") : t("delegation.title")}
        description={absent ? t.rich("delegation.onBehalf.description", { name: absent.fullName, person: (chunks) => <RecordLink kind="person" id={absent.id}>{chunks}</RecordLink> }) : t("delegation.description")}
        actions={
          <Link href={absent ? `/people/${absent.id}` : "/approvals"} className={buttonVariants({ variant: "outline" })}>
            {absent ? absent.fullName : t("oversight.back")}
          </Link>
        }
      />
      {absent ? (
        <Section title={t("delegation.onBehalf.waiting")} count={movable.length || undefined}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="select">{t("columns.type")}</TableHead>
                <TableHead kind="text">{t("columns.request")}</TableHead>
                <TableHead kind="person">{t("columns.requester")}</TableHead>
                <TableHead kind="time">{t("columns.age")}</TableHead>
                <TableHead kind="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {movable.length === 0 ? <TableEmpty>{t("delegation.onBehalf.waitingEmpty")}</TableEmpty> : null}
              {movable.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant="secondary">{label(row.type)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-96 whitespace-normal font-medium">{row.summary || label(row.type)}</TableCell>
                  <TableCell>
                    <PersonName name={row.requesterName} personId={row.requesterPersonId} />
                  </TableCell>
                  <TableCell kind="time">
                    <RequestAge createdAt={row.createdAt} />
                  </TableCell>
                  <TableCell kind="actions">
                    <ReassignDialog
                      requestId={row.id}
                      summary={row.summary || label(row.type)}
                      waiting={[{ personId: absent.id, name: absent.fullName }]}
                      people={people}
                      exclude={[absent.id, row.requesterPersonId, ...(row.subjectPersonId ? [row.subjectPersonId] : [])]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {movable.length < turns.length ? <p className="text-xs text-faint">{t("delegation.onBehalf.hidden", { count: turns.length - movable.length })}</p> : null}
        </Section>
      ) : null}
      <Section title={absent ? t("delegation.onBehalf.given") : t("delegation.given")} count={given.length || undefined}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("delegation.to")}</TableHead>
                <TableHead kind="date">{t("delegation.from")}</TableHead>
                <TableHead kind="date">{t("delegation.until")}</TableHead>
                <TableHead kind="tags">{t("delegation.types")}</TableHead>
                <TableHead kind="text">{t("delegation.reason")}</TableHead>
                <TableHead kind="status">{t("columns.status")}</TableHead>
                <TableHead kind="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {given.length === 0 ? <TableEmpty>{t("delegation.none")}</TableEmpty> : null}
              {given.map((row) => {
                const state = row.revokedAt ? "revoked" : row.validTo < today ? "ended" : row.validFrom > today ? "upcoming" : "active";
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <PersonName name={row.toName} personId={row.toPersonId} />
                    </TableCell>
                    <TableCell>{day(row.validFrom)}</TableCell>
                    <TableCell>{day(row.validTo)}</TableCell>
                    <TableCell className="max-w-64 truncate">{types(row)}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">{row.reason ?? "—"}</TableCell>
                    <TableCell>
                      <Badge dot variant={statusTone(state)}>{t(`delegation.state.${state}` as "delegation.state.active")}</Badge>
                    </TableCell>
                    <TableCell kind="actions">{state === "active" || state === "upcoming" ? <RevokeDelegationButton id={row.id} onBehalf={!!absent} /> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TableAddRow label={absent ? t("delegation.onBehalf.link") : t("delegation.link")} open={given.length === 0}>
            <DelegationForm people={people.filter((person) => person.id !== personId)} requestTypes={[...registered.keys()].map((type) => ({ type, name: label(type) }))} today={today} forPersonId={absent?.id} />
          </TableAddRow>
        </TableCard>
      </Section>
      {absent ? null : (
        <Section title={t("delegation.received")} count={current.length || undefined}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("delegation.delegator")}</TableHead>
                <TableHead kind="date">{t("delegation.from")}</TableHead>
                <TableHead kind="date">{t("delegation.until")}</TableHead>
                <TableHead kind="tags">{t("delegation.types")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.length === 0 ? <TableEmpty>{t("delegation.none")}</TableEmpty> : null}
              {current.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <PersonName name={row.fromName} personId={row.fromPersonId} />
                  </TableCell>
                  <TableCell>{day(row.validFrom)}</TableCell>
                  <TableCell>{day(row.validTo)}</TableCell>
                  <TableCell className="max-w-64 truncate">{types(row)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </Page>
  );
}
