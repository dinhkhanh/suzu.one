"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };

/** A success the person still needs to hear about (a timer whose week was locked meanwhile): the action's `notice`. */
const noticeOf = (data: unknown): string | null => (data && typeof data === "object" && "notice" in data && typeof data.notice === "string" ? data.notice : null);

/**
 * Runs an action from a button (one tap, no form) and refreshes the page; says what went wrong. A
 * success with a `notice` is not refreshed away at once — the page would drop the very component
 * showing it — but held until the person dismisses it (`dismiss`), which then refreshes.
 */
export function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = (action: (input: unknown) => Promise<Result>, input: unknown, after?: () => void) =>
    startTransition(async () => {
      const result = await action(input);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.();
        const told = noticeOf(result.data);
        setNotice(told);
        if (!told) router.refresh();
      }
    });
  const dismiss = () => {
    setNotice(null);
    router.refresh();
  };
  return { run, pending, errorKey, notice, dismiss };
}
