import { getFormatter, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KIOSK_COOKIE, kioskOfToken, listKioskDevices } from "@/modules/attendance/kiosk";
import { canManageDevices } from "@/modules/attendance/policy";
import { CloseKioskButton, OpenKioskButton } from "@/modules/attendance/ui/kiosk/kiosk-admin";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("kiosk");

// The clocks a kiosk may be opened for, and the tablets open as kiosks now. Opening one turns the
// browser it is pressed in into the kiosk, and signs its user out there.
export default async function KioskPage() {
  const user = await requireUser();
  const t = await getTranslations("attendance.kiosk");
  const format = await getFormatter();
  const [devices, here] = await Promise.all([listKioskDevices(user.principal), kioskOfToken((await cookies()).get(KIOSK_COOKIE)?.value)]);
  const when = (at: Date) => format.dateTime(at, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
  const sessions = devices.flatMap((device) => device.sessions.map((session) => ({ ...session, deviceName: device.name })));

  return (
    <div className="flex flex-col gap-8">
      <Section title={t("howTitle")} description={t("how")}>
        <List>
          {devices.length === 0 ? <ListEmpty>{t("noDevices")}</ListEmpty> : null}
          {devices.map((device) => (
            <ListItem key={device.id} className="flex-wrap justify-between">
              <span className="min-w-0">
                <RecordLink kind="device" id={canManageDevices(user.principal, device.entityId) ? device.id : null} className="font-medium">
                  {device.name}
                </RecordLink>
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  <RecordLink kind="entity" id={device.entityId}>
                    {device.entityName}
                  </RecordLink>
                </span>
                {device.sessions.length ? <span className="text-muted-foreground"> · {t("openCount", { count: device.sessions.length })}</span> : null}
              </span>
              <OpenKioskButton deviceId={device.id} deviceName={device.name} />
            </ListItem>
          ))}
        </List>
      </Section>

      <TableCard>
        <TableCardHeader title={t("sessions.title")} count={sessions.length} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("sessions.device")}</TableHead>
              <TableHead kind="person">{t("sessions.openedBy")}</TableHead>
              <TableHead kind="date">{t("sessions.openedAt")}</TableHead>
              <TableHead kind="date">{t("sessions.lastSeen")}</TableHead>
              <TableHead kind="date">{t("sessions.expires")}</TableHead>
              <TableHead kind="number">{t("sessions.punchesToday")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 ? <TableEmpty>{t("sessions.empty")}</TableEmpty> : null}
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="font-medium text-foreground">
                  {session.deviceName} {here?.session.id === session.id ? <Badge variant="info">{t("sessions.thisDevice")}</Badge> : null}
                </TableCell>
                <TableCell>
                  <RecordLink kind="person" id={session.openedByPersonId}>
                    {session.openedBy}
                  </RecordLink>
                </TableCell>
                <TableCell kind="date">{when(session.openedAt)}</TableCell>
                <TableCell kind="date">{session.lastSeenAt ? when(session.lastSeenAt) : "—"}</TableCell>
                <TableCell kind="date">{session.lapsed ? <Badge variant="warning">{t("sessions.expired")}</Badge> : when(session.expiresAt)}</TableCell>
                <TableCell kind="number">{session.punchesToday}</TableCell>
                <TableCell kind="actions">
                  <CloseKioskButton sessionId={session.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
