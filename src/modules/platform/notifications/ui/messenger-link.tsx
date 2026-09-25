"use client";
// "Get notifications on Messenger" (docs/MESSENGER.md): start a link, open the Page in Messenger,
// type back the code the bot sent. Linked: when, a test, and the way out.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmMessengerLinkAction, sendTestMessengerAction, startMessengerLinkAction, unlinkMessengerAction } from "../actions";

type Status = {
  link: { linkedAt: string; lastSuccessAt: string | null } | null;
  pending: { expiresAt: string; codeSent: boolean } | null;
};

export function MessengerLink({ configured, status }: { configured: boolean; status: Status }) {
  const t = useTranslations("notifications.messenger");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // The m.me URL carries the one-time token: it lives in this page's memory only, never in the HTML.
  const [started, setStarted] = useState<{ url: string; expiresAt: string } | null>(null);
  const confirm = useActionForm(confirmMessengerLinkAction, { onSuccess: () => router.refresh() });

  const waiting = started ?? (status.pending ? { url: null, expiresAt: status.pending.expiresAt } : null);

  function connect() {
    startTransition(async () => {
      setMessage(null);
      const result = await startMessengerLinkAction({});
      if (!result.ok) return setMessage(t("failed"));
      setStarted(result.data);
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    });
  }

  function unlink() {
    startTransition(async () => {
      setMessage(null);
      setStarted(null);
      const result = await unlinkMessengerAction({});
      if (!result.ok) return setMessage(t("failed"));
      router.refresh();
    });
  }

  function test() {
    startTransition(async () => {
      const result = await sendTestMessengerAction({});
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
