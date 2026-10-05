// The person's own privacy section on /me (NFR-PRV-01, 03): their answer to the GPS notice (the
// attendance screen that changes it is handed in by the page), the export of everything the app
// holds about them, and how long what is kept is kept.
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Section } from "@/components/ui/page";
import { AI_CONVERSATION_RETENTION_DAYS, FORMER_EMPLOYEE_RETENTION_YEARS, PUNCH_POSITION_RETENTION_DAYS } from "../engine/retention";
import { ExportMyDataButton } from "./export-my-data";

export async function MyPrivacy({ gps }: { gps: ReactNode }) {
  const t = await getTranslations("privacy.mine");
  return (
    <Section id="privacy" title={t("title")} description={t("description")} className="scroll-mt-16">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("gpsTitle")}</h3>
        {gps}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("exportTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("exportWhat")}</p>
        <ExportMyDataButton />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("keptTitle")}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>{t("keptPositions", { days: PUNCH_POSITION_RETENTION_DAYS })}</li>
          <li>{t("keptAssistant", { days: AI_CONVERSATION_RETENTION_DAYS })}</li>
          <li>{t("keptAfterLeaving", { years: FORMER_EMPLOYEE_RETENTION_YEARS })}</li>
          <li>{t("keptByLaw")}</li>
        </ul>
      </div>
    </Section>
  );
}
