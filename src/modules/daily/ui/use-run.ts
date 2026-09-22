"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Result = { ok: boolean; error?: string; message?: string };

/** Runs an action from a button (one tap, no form) and refreshes the page; says what went wrong. */
export function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (action: (input: unknown) => Promise<Result>, input: unknown, after?: () => void) =>
    startTransition(async () => {
      const result = await action(input);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}
