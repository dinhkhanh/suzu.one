"use client";
// "Get notifications on <chat app>" (docs/MESSENGER.md, docs/TELEGRAM.md): start a link, open the
// bot in the app, type back the code the bot sent. Linked: when, a test, and the way out. One
// component for both channels; each passes its own words and its own actions.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";

export type ChatAppStatus = {
  link: { linkedAt: string; lastSuccessAt: string | null } | null;
  pending: { expiresAt: string; codeSent: boolean } | null;
};

export type ChatAppActions = {
  start: (input: unknown) => Promise<ActionResult<{ url: string; expiresAt: string }>>;
  confirm: (input: unknown) => Promise<ActionResult<{ linked: boolean }>>;
  unlink: (input: unknown) => Promise<ActionResult<{ removed: number }>>;
  test: (input: unknown) => Promise<ActionResult<{ sent: number; simulated: number }>>;
};

export function ChatAppLink({ namespace, actions, configured, status }: { namespace: "notifications.messenger" | "notifications.telegram"; actions: ChatAppActions; configured: boolean; status: ChatAppStatus }) {
  const t = useTranslations(namespace);
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // The connect URL carries the one-time token: it lives in this page's memory only, never in the HTML.
  const [started, setStarted] = useState<{ url: string; expiresAt: string } | null>(null);
  const confirm = useActionForm(actions.confirm, { onSuccess: () => router.refresh() });

  const waiting = started ?? (status.pending ? { url: null, expiresAt: status.pending.expiresAt } : null);

  function connect() {
    startTransition(async () => {
      setMessage(null);
      const result = await actions.start({});
      if (!result.ok) return setMessage(t("failed"));
      setStarted(result.data);
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    });
  }

  function unlink() {
    startTransition(async () => {
      setMessage(null);
      setStarted(null);
      const result = await actions.unlink({});
      if (!result.ok) return setMessage(t("failed"));
      router.refresh();
    });
  }

  function test() {
    startTransition(async () => {
      const result = await actions.test({});
      if (!result.ok) return setMessage(t("failed"));
      setMessage(result.data.sent > 0 ? t("testSent") : result.data.simulated > 0 ? t("testSimulated") : t("testNotSent"));
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("title")}</h2>
      {!configured ? <p className="text-sm text-muted-foreground">{t("notConfigured")}</p> : null}

      {configured && status.link ? (
        <>
          <p className="text-sm">{t("linked", { date: format.dateTime(new Date(status.link.linkedAt), { dateStyle: "medium" }) })}</p>
          {status.link.lastSuccessAt ? <p className="text-xs text-muted-foreground">{t("lastSuccess", { date: format.dateTime(new Date(status.link.lastSuccessAt), { dateStyle: "medium", timeStyle: "short" }) })}</p> : null}
          <p className="text-xs text-muted-foreground">
            {t("rule")} {t("stopHint")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={test} disabled={pending}>
              {t("test")}
            </Button>
            <Button type="button" variant="outline" onClick={unlink} disabled={pending}>
              {t("unlink")}
            </Button>
          </div>
        </>
      ) : null}

      {configured && !status.link ? (
        <>
          <p className="text-sm text-muted-foreground">{t("off")}</p>
          <p className="text-xs text-muted-foreground">{t("rule")}</p>
          {waiting ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{t("step1")}</p>
              {waiting.url ? (
                <a href={waiting.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" }) + " w-fit"}>
                  {t("openLink")}
                </a>
              ) : null}
              <p className="text-sm">{status.pending?.codeSent ? t("waitingCode") : t("step2")}</p>
              <form onSubmit={confirm.onSubmit} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  {t("codeLabel")}
                  <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className="w-32 font-mono tracking-widest" />
                </label>
                <Button type="submit" disabled={confirm.pending}>
                  {t("confirm")}
                </Button>
              </form>
              <FormError namespace="notifications.errors" errorKey={confirm.errorKey} />
              <p className="text-xs text-muted-foreground">{t("expires", { time: format.dateTime(new Date(waiting.expiresAt), { timeStyle: "short" }) })}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={waiting ? "outline" : "default"} onClick={connect} disabled={pending}>
              {t("connect")}
            </Button>
          </div>
        </>
      ) : null}

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}
