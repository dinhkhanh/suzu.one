"use client";
import { type FormEvent, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action";

// "profile.phone" → { profile: { phone } }. Blank fields are kept: the actions read them as "no value".
function nest(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of formData.entries()) {
    const path = name.split(".");
    let node = result;
    for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
    node[path.at(-1)!] = value;
  }
  return result;
}

/**
 * Submits a form to a server action and reports the failure as a message key.
 * Wired to `onSubmit`, not `action`: React resets a form's fields once its `action` finishes, even
 * when the server said no, and nobody should retype a whole hire form because of one bad field.
 */
export function useActionForm<T>(action: (input: unknown) => Promise<ActionResult<T>>, options: { extra?: Record<string, unknown>; onSuccess?: (data: T) => void }) {
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await action({ ...nest(formData), ...options.extra });
      if (result.ok) {
        setErrorKey(null);
        options.onSuccess?.(result.data);
        return;
      }
      setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
    });
  }

  return { onSubmit, pending, errorKey };
}
