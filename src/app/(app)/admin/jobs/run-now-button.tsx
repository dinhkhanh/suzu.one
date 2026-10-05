"use client";
import { PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { runJobNowAction } from "./actions";

/** Starts one job and waits for it: a job takes seconds, at most a few minutes, and the row it writes is the answer. */
export function RunNowButton({ job }: { job: string }) {
  const t = useTranslations("jobs.runNow");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex items-center justify-end gap-2">
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runJobNowAction({ job });
            if (!result.ok) return setMessage(t(result.message === "job_already_running" ? "alreadyRunning" : "failed"));
            setMessage(t(result.data.status === "succeeded" ? "succeeded" : "failed"));
            router.refresh();
          })
        }
      >
        <PlayIcon aria-hidden />
        {pending ? t("running") : t("label")}
      </Button>
    </span>
  );
}
