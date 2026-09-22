"use client";
// Small pieces the delivery screens share: reading a refusal, showing it, and a file's one-minute
// link made when it is needed and made again when it has run out (FR-PLT-32).
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { openTaskFileAction } from "../actions";

export type Result = { ok: boolean; error?: string; message?: string; details?: unknown };
export const errorKeyOf = (result: Result) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

export function DeliveryError({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("work");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
    </p>
  );
}

/** A link that failed sooner than this after it was made is broken, not expired: no new one. */
const RETRY_AFTER_MS = 10_000;

/**
 * A task file's short-lived link for an <img> or <video>: made when the media is first shown (or
 * when `enabled` turns on) and made again on demand — the media element's onError calls
 * `refresh()`, which is what happens when a video seeks after its minute is up.
 */
export function useSignedUrl(fileId: string | null, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const madeAt = useRef(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !fileId) return;
    let alive = true;
    madeAt.current = Date.now();
    void openTaskFileAction({ fileId }).then((result) => {
      if (!alive) return;
      setFailed(!result.ok);
      if (result.ok) setUrl(result.data.url);
    });
    return () => {
      alive = false;
    };
  }, [enabled, fileId, attempt]);

  const refresh = useCallback(() => {
    if (Date.now() - madeAt.current < RETRY_AFTER_MS) setFailed(true);
    else setAttempt((count) => count + 1);
  }, []);

  return { url, failed, refresh };
}
