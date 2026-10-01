"use client";
// The confirmation behind an approve-from-notification link (FR-PLT-24). A link is never an
// approval on its own: it lands here, shows what is about to be approved, and waits for a press.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { ActionResult } from "@/lib/action";

/** `approve` is the composition root's action: it redeems the token and calls the owning module's own decide action. */
export function ActOnRequest({ token, summary, link, typeName, approve }: { token: string; summary: string; link: string | null; typeName: string; approve: (input: unknown) => Promise<ActionResult<unknown>> }) {
  const t = useTranslations("approvals.deepLink");
  const tErrors = useTranslations("approvals.errors");
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Badge variant="secondary" className="w-fit">
          {typeName}
        </Badge>
        <p className="text-base font-medium">{summary}</p>
        <p className="text-xs text-faint">{t("readFirst")}</p>
        {errorKey ? <Alert variant="destructive">{tErrors.has(errorKey) ? tErrors(errorKey as "generic") : tErrors("generic")}</Alert> : null}
      </CardContent>
      <CardFooter className="grid grid-cols-2 gap-2 md:flex md:justify-end">
        <Link href={link ?? "/approvals"} className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("openIt")}
        </Link>
        <Button
          type="button"
          size="lg"
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
      </CardFooter>
    </Card>
  );
}
