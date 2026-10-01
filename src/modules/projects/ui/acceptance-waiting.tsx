// What a project still owes the client a signature for (FR-PJM-55; the owner's decision of
// 2026-09-23, Q22: every client project and every retainer month is accepted before it is billed).
// Shown on the project's overview and on its acceptance page, so that nobody has to work out from
// the billing queue why a month has not been invoiced. Internal work — no client — shows nothing.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Section } from "@/components/ui/page";
import type { AcceptanceWaiting } from "../acceptance";

export async function AcceptanceWaitingList({ projectId, waiting, showLink = true }: { projectId: string; waiting: AcceptanceWaiting[] | null; showLink?: boolean }) {
  if (waiting === null) return null;
  const t = await getTranslations("projects.acceptance");
  const label = (item: AcceptanceWaiting) => (item.scope === "milestone" ? t("waitingMilestone", { name: item.name ?? "" }) : item.scope === "retainer_period" ? t("waitingMonth", { name: item.name ?? "" }) : t("waitingWhole"));
  return (
    <Section title={t("waitingTitle")} count={waiting.length} action={showLink ? <Link href={`/projects/${projectId}/acceptance`}>{t("waitingLink")}</Link> : null}>
      <List>
        {waiting.length === 0 ? <ListEmpty>{t("waitingNone")}</ListEmpty> : null}
        {waiting.map((item) => (
          <ListItem key={`${item.scope}:${item.milestoneId ?? item.retainerPeriodId ?? "all"}`} className="gap-3">
            <Badge dot variant="warning">
              {t(`scopes.${item.scope}`)}
            </Badge>
            <span className="min-w-0 flex-1">{label(item)}</span>
          </ListItem>
        ))}
      </List>
      <p className="px-0.5 text-xs text-muted-foreground">{t("waitingNote")}</p>
    </Section>
  );
}
