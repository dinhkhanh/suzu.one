"use client";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportBrowserError } from "@/lib/observability/browser";

// Shown inside the app shell when a page fails. A server error is already recorded
// (src/instrumentation.ts) and the reference lets support find it; a browser error is sent here.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => reportBrowserError(error, "boundary"), [error]);
  return (
    <div className="flex max-w-md flex-col gap-3 py-16">
      <h1>{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {error.digest ? <p className="font-mono text-xs text-muted-foreground">{t("reference", { digest: error.digest })}</p> : null}
      <div>
        <Button onClick={() => retry()}>{t("retry")}</Button>
      </div>
    </div>
  );
}
