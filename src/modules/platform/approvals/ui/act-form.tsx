"use client";
// The confirmation behind an approve-from-notification link (FR-PLT-24). A link is never an
// approval on its own: it lands here, shows what is about to be approved, and waits for a press.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";

/** `approve` is the composition root's action: it redeems the token and calls the owning module's own decide action. */
export function ActOnRequest({ token, summary, link, typeName, approve }: { token: string; summary: string; link: string | null; typeName: string; approve: (input: unknown) => Promise<ActionResult<unknown>> }) {
  const t = useTranslations("approvals.deepLink");
  const tErrors = useTranslations("approvals.errors");
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">{typeName}</p>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t("readFirst")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await approve({ token });
              if (result.ok) router.push(link ?? "/approvals");
              else setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
            })
          }
        >
          {t("approve")}
        </Button>
        <Link href={link ?? "/approvals"} className="text-sm underline-offset-4 hover:underline">
          {t("openIt")}
        </Link>
      </div>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tErrors.has(errorKey) ? tErrors(errorKey as "generic") : tErrors("generic")}
        </p>
      ) : null}
    </div>
  );
}
