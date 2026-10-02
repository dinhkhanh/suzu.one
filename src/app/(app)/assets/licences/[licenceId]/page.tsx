import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { canManageLicences, CYCLE_MONTHS, listAssets, listLicences, listSeatsOfLicence } from "@/modules/assets/service";
import { LicenceForm } from "@/modules/assets/ui/licence-forms";
import { AssignSeatForm, ReleaseSeatButton } from "@/modules/assets/ui/seat-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("licence");

// One licence or subscription (FR-AST-05, 11): who is using its seats — a person or a device —
// how many are paid for and sit unused, and its own facts below.
export default async function LicencePage({ params }: PageProps<"/assets/licences/[licenceId]">) {
  const user = await requireUser();
  const { licenceId } = await params;
  // Read through the list, so the entity scope is the same WHERE clause as everywhere else.
  const [licence] = /^[0-9a-f-]{36}$/.test(licenceId) ? await listLicences(user.principal, { id: licenceId }) : [];
  // Not there, or not this viewer's entity — the same answer either way.
  if (!licence || !canManageLicences(user.principal, licence.entityId)) notFound();

  const [entities, people, devices, seats, t, tSeats, format] = await Promise.all([
    listEntities().then((rows) => rows.map(({ id, code, shortName }) => ({ id, code, shortName }))),
    listPersonNames(),
    // Every device in reach: a group shares its machines across entities more readily than its invoices.
    listAssets(user.principal),
    listSeatsOfLicence(licence.id),
    getTranslations("assets.licences"),
    getTranslations("assets.seats"),
    getFormatter(),
  ]);
  const day = (value: Date) => format.dateTime(value, { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });
  const free = licence.seats === null ? null : Math.max(licence.seats - licence.seatsUsed, 0);
  const months = CYCLE_MONTHS[licence.billingCycle];
  // What the unused seats cost each cycle: money paid for nobody.
  const idleCost = licence.canSeeMoney && licence.costPerCycle !== null && licence.seats && free ? Math.round((licence.costPerCycle * free) / licence.seats) : null;
  const active = licence.status === "active";
  const taken = new Set(seats.open.map((seat) => seat.personId ?? seat.assetId));

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/assets/licences" className="hover:underline">
            {t("title")}
          </Link>
        }
        title={licence.name}
      >
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge dot variant={statusTone(licence.status)}>
            {t(`status.${licence.status}`)}
          </Badge>
          {[licence.vendor, licence.entityName, t(`cycle.${licence.billingCycle}`)].filter(Boolean).join(" · ")}
        </p>
      </PageHeader>

      <TileGrid>
        <Tile label={tSeats("used")} value={licence.seats === null ? licence.seatsUsed : `${licence.seatsUsed} / ${licence.seats}`} />
        {free !== null ? <Tile label={tSeats("free")} value={free} tone={free > 0 && active ? "warning" : undefined} hint={idleCost ? tSeats("idleCost", { amount: idleCost.toLocaleString("vi-VN") }) : undefined} /> : null}
        {months !== null ? <Tile label={t("columns.renewal")} value={licence.renewalDate ? licence.renewalDate.split("-").reverse().join("/") : "—"} hint={licence.autoRenews ? undefined : t("manualRenew")} /> : null}
        {licence.canSeeMoney && licence.costPerCycle !== null ? <Tile label={t("columns.cost")} value={licence.costPerCycle.toLocaleString("vi-VN")} /> : null}
      </TileGrid>

      <TableCard>
        <TableCardHeader title={tSeats("title")} count={seats.open.length || null} description={tSeats("description")} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{tSeats("holder")}</TableHead>
              <TableHead kind="date" className="hidden md:table-cell">{tSeats("since")}</TableHead>
              <TableHead kind="person" className="hidden md:table-cell">{tSeats("by")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {seats.open.length === 0 ? <TableEmpty>{tSeats("empty")}</TableEmpty> : null}
            {seats.open.map((seat) => (
              <TableRow key={seat.id}>
                <TableCell className="whitespace-normal">
                  {seat.assetId ? (
                    <>
                      <Link href={`/assets/${seat.assetId}`} className="font-medium hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{seat.assetCode}</span> {seat.assetName}
                      </Link>
                      <p className="text-xs text-faint">{seat.deviceHolderName ? tSeats("deviceWith", { name: seat.deviceHolderName }) : tSeats("deviceOnShelf")}</p>
                    </>
                  ) : (
                    <span className="font-medium">{seat.personName}</span>
                  )}
                  {seat.note ? <p className="text-xs text-faint">{seat.note}</p> : null}
                  {/* On a phone the two columns to the right fold into this line. */}
                  <p className="text-xs text-faint md:hidden">{[day(seat.assignedAt), seat.assignedByName].filter(Boolean).join(" · ")}</p>
                </TableCell>
                <TableCell kind="date" className="hidden md:table-cell">{day(seat.assignedAt)}</TableCell>
                <TableCell className="hidden md:table-cell">{seat.assignedByName ?? "—"}</TableCell>
                <TableCell kind="actions">
                  <ReleaseSeatButton seatId={seat.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {active && free !== 0 ? (
          <TableAddRow label={tSeats("assign")} open={seats.open.length === 0}>
            <AssignSeatForm
              licenceId={licence.id}
              people={people.filter((person) => !taken.has(person.id))}
              // A machine that is lost or written off runs nothing; one that already has a seat needs no second.
              devices={devices.filter((device) => device.status !== "lost" && device.status !== "disposed" && !taken.has(device.id)).map(({ id, code, name, holderName }) => ({ id, code, name, holderName }))}
            />
          </TableAddRow>
        ) : null}
      </TableCard>

      {seats.released.length > 0 ? (
        <TableCard>
          <TableCardHeader title={tSeats("history")} count={seats.released.length} />
          <List>
            {seats.released.map((seat) => (
              <ListItem key={seat.id} className="flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-medium">{seat.assetId ? `${seat.assetCode} ${seat.assetName}` : seat.personName}</span>
                <span className="text-xs text-muted-foreground">{[`${day(seat.assignedAt)} → ${seat.releasedAt ? day(seat.releasedAt) : "—"}`, seat.releasedByName, seat.releaseNote].filter(Boolean).join(" · ")}</span>
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      <Section title={t("form.title")}>
        <LicenceForm
          value={{
            id: licence.id,
            name: licence.name,
            vendor: licence.vendor,
            entityId: licence.entityId,
            seats: licence.seats,
            costPerCycle: licence.canSeeMoney ? licence.costPerCycle : null,
            billingCycle: licence.billingCycle,
            renewalDate: licence.renewalDate,
            autoRenews: licence.autoRenews,
            ownerPersonId: licence.ownerPersonId,
            accountRef: licence.accountRef,
            notes: licence.notes,
            status: licence.status,
          }}
          entities={entities}
          people={people}
          canSeeMoney={licence.canSeeMoney}
        />
        <p className="text-xs text-muted-foreground">{t("trackerNote")}</p>
      </Section>
    </Page>
  );
}
