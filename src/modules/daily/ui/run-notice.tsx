"use client";
// What a successful action still needs to say (`useRun`'s notice): shown until the person dismisses
// it, which refreshes the page.
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const NOTICES = ["timer_week_locked", "timesheet_bulk_partial"] as const;

export function RunNotice({ notice, dismiss }: { notice: string | null; dismiss: () => void }) {
  const t = useTranslations("daily.notices");
  if (!notice) return null;
  const known = (NOTICES as readonly string[]).includes(notice) ? (notice as (typeof NOTICES)[number]) : null;
  return (
    <Alert variant="warning" role="status">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 basis-56">{known ? t(known) : notice}</span>
        <Button type="button" size="xs" variant="outline" onClick={dismiss}>
          {t("ok")}
        </Button>
      </span>
    </Alert>
  );
}
