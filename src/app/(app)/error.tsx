"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// Shown inside the app shell when a page fails. The server has already recorded the error
// (src/instrumentation.ts); the reference lets support find it.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("errors");
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
