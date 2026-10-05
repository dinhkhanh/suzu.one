"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import type { ActionResult } from "@/lib/action";
import { acknowledgeAnnouncementAction, removeKudosAction, setAnnouncementStateAction } from "../actions";

const keyOf = (result: ActionResult<unknown>) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (call: () => Promise<ActionResult<unknown>>) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(keyOf(result));
      if (result.ok) router.refresh();
    });
  return { pending, errorKey, run };
}

function ErrorLine({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("comms.errors");
  if (!errorKey) return null;
  return (
    <span role="alert" className="text-sm text-destructive">
      {t.has(errorKey) ? t(errorKey) : t("generic")}
    </span>
  );
}

/** The reader's "I have read this". */
export function AcknowledgeAnnouncementButton({ id }: { id: string }) {
  const t = useTranslations("comms");
  const { pending, errorKey, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => acknowledgeAnnouncementAction({ id }))}>
        {t("detail.acknowledge")}
      </Button>
      <ErrorLine errorKey={errorKey} />
    </span>
  );
}

export function AnnouncementStateButtons({ id, pinned, archived }: { id: string; pinned: boolean; archived: boolean }) {
  const t = useTranslations("comms");
  const { pending, errorKey, run } = useRun();
  if (archived) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => setAnnouncementStateAction({ id, change: pinned ? "unpin" : "pin" }))}>
        {pinned ? t("manage.unpin") : t("manage.pin")}
      </Button>
      <ConfirmButton variant="destructive" size="sm" disabled={pending} destructive label={t("manage.archive")} question={t("manage.archiveConfirm")} onConfirm={() => run(() => setAnnouncementStateAction({ id, change: "archive" }))} />
      <ErrorLine errorKey={errorKey} />
    </span>
  );
}

export function RemoveKudosButton({ id }: { id: string }) {
  const t = useTranslations("comms");
  const { pending, errorKey, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <ConfirmButton variant="ghost" size="xs" disabled={pending} label={t("kudos.remove")} question={t("kudos.removeConfirm")} onConfirm={() => run(() => removeKudosAction({ id }))} />
      <ErrorLine errorKey={errorKey} />
    </span>
  );
}
