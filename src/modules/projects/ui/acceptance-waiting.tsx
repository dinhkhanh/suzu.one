// What a project still owes the client a signature for (FR-PJM-55; the owner's decision of
// 2026-09-23, Q22: every client project and every retainer month is accepted before it is billed).
// Shown on the project's overview and on its acceptance page, so that nobody has to work out from
// the billing queue why a month has not been invoiced. Internal work — no client — shows nothing.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { AcceptanceWaiting } from "../acceptance";

export async function AcceptanceWaitingList({ projectId, waiting, showLink = true }: { projectId: string; waiting: AcceptanceWaiting[] | null; showLink?: boolean }) {
  if (waiting === null) return null;
  const t = await getTranslations("projects.acceptance");
  const label = (item: AcceptanceWaiting) => (item.scope === "milestone" ? t("waitingMilestone", { name: item.name ?? "" }) : item.scope === "retainer_period" ? t("waitingMonth", { name: item.name ?? "" }) : t("waitingWhole"));
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">{t("waitingTitle")}</h2>
        <Badge variant={waiting.length ? "warning" : "success"}>{waiting.length}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t("waitingNote")}</p>
      {waiting.length === 0 ? (
        <p className="text-sm">{t("waitingNone")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {waiting.map((item) => (
            <li key={`${item.scope}:${item.milestoneId ?? item.retainerPeriodId ?? "all"}`}>{label(item)}</li>
          ))}
        </ul>
      )}
      {showLink ? (
        <Link href={`/projects/${projectId}/acceptance`} className="text-sm underline">
          {t("waitingLink")}
        </Link>
      ) : null}
    </section>
  );
}
