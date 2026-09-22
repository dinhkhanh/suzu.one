"use client";
// The publish log of a content task (FR-PJM-54) and its results (FR-PJM-57): plan a post (where,
// on which page, when), mark it published with its URL — which is what lets the task enter its
// "Published" state — and record the figures as they come in.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cancelPublishAction, markPublishedAction, planPublishAction, recordResultAction, removeResultAction, updatePublishPlanAction } from "../delivery-actions";
import { type Metrics, publishFlag, RESULT_METRICS, toVietnamLocal } from "../engine/delivery";
import { CHANNELS } from "../enums";
import { DeliveryError, errorKeyOf, type Result } from "./delivery-shared";

export type PublishItem = {
  id: string;
  platform: string;
  page: string | null;
  status: string;
  plannedAt: string | null;
  publishedAt: string | null;
  url: string | null;
  boosted: boolean;
  adAccount: string | null;
  publishedByName: string | null;
  latest: Metrics;
  results: { id: string; recordedOn: string; metrics: Metrics; source: string }[];
};

const FLAG_VARIANT = { published: "success", late: "destructive", planned: "secondary", unscheduled: "outline", cancelled: "outline" } as const;

export function PublishPanel({ taskId, channel, publishes, canManage, today, now }: { taskId: string; channel: string | null; publishes: PublishItem[]; canManage: boolean; today: string; /** The server's clock, so a post is late on the server and the screen alike. */ now: string }) {
  const t = useTranslations("work.publish");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const [planning, setPlanning] = useState(false);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
  if (!canManage && publishes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
        {t("title")}
        <Link href="/work/publish/results" className="ml-auto text-xs font-normal underline">
          {t("importResults")}
        </Link>
      </h2>
      {publishes.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {publishes.map((publish) => {
          const flag = publishFlag({ status: publish.status, plannedAt: publish.plannedAt ? new Date(publish.plannedAt) : null }, new Date(now));
          return (
            <li key={publish.id} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{tWork(`channels.${publish.platform}`)}</span>
                {publish.page ? <span className="text-muted-foreground">{publish.page}</span> : null}
                <Badge variant={FLAG_VARIANT[flag]}>{t(`flags.${flag}`)}</Badge>
                {publish.boosted ? <Badge variant="info">{t("boostedOn", { account: publish.adAccount ?? "—" })}</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {[publish.plannedAt ? t("plannedAt", { when: when(publish.plannedAt) }) : null, publish.publishedAt ? t("publishedAt", { when: when(publish.publishedAt), name: publish.publishedByName ?? "—" }) : null].filter(Boolean).join(" · ")}
              </p>
              {publish.url ? (
                <a href={publish.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate underline">
                  {publish.url}
                </a>
              ) : null}
              {canManage && publish.status === "planned" ? <PublishActions publish={publish} /> : null}
              {publish.status === "published" ? <Results publish={publish} canManage={canManage} today={today} /> : null}
            </li>
          );
        })}
      </ul>
      {canManage ? planning ? <PlanForm taskId={taskId} defaultPlatform={channel} onDone={() => setPlanning(false)} /> : (
        <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setPlanning(true)}>
          {t("plan")}
        </Button>
      ) : null}
    </section>
  );
}

function useRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = (call: () => Promise<Result>, done?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(errorKeyOf(result));
      if (result.ok) {
        done?.();
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

function PlanForm({ taskId, publish, defaultPlatform, onDone }: { taskId: string; publish?: PublishItem; defaultPlatform: string | null; onDone: () => void }) {
  const t = useTranslations("work.publish");
  const tWork = useTranslations("work");
  const { run, pending, errorKey } = useRunner();
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const values = { platform: data.get("platform"), page: data.get("page"), plannedAt: data.get("plannedAt") };
        run(() => (publish ? updatePublishPlanAction({ publishId: publish.id, ...values }) : planPublishAction({ taskId, ...values })), onDone);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`platform-${publish?.id ?? "new"}`}>{t("platform")}</Label>
          <Select id={`platform-${publish?.id ?? "new"}`} name="platform" defaultValue={publish?.platform ?? defaultPlatform ?? "facebook"}>
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {tWork(`channels.${channel}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`page-${publish?.id ?? "new"}`}>{t("page")}</Label>
          <Input id={`page-${publish?.id ?? "new"}`} name="page" maxLength={200} defaultValue={publish?.page ?? ""} placeholder={t("pagePlaceholder")} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`planned-${publish?.id ?? "new"}`}>{t("plannedFor")}</Label>
          <Input id={`planned-${publish?.id ?? "new"}`} name="plannedAt" type="datetime-local" defaultValue={publish?.plannedAt ? toVietnamLocal(new Date(publish.plannedAt)) : ""} />
        </div>
      </div>
      <DeliveryError errorKey={errorKey} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("savePlan")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function PublishActions({ publish }: { publish: PublishItem }) {
  const t = useTranslations("work.publish");
  const { run, pending, errorKey } = useRunner();
  const [mode, setMode] = useState<"none" | "published" | "edit">("none");
  const [boosted, setBoosted] = useState(false);
  if (mode === "edit") return <PlanForm taskId="" publish={publish} defaultPlatform={publish.platform} onDone={() => setMode("none")} />;
  if (mode === "published")
    return (
      <form
        className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run(() => markPublishedAction({ publishId: publish.id, url: data.get("url"), publishedAt: data.get("publishedAt"), boosted, adAccount: data.get("adAccount") }), () => setMode("none"));
        }}
      >
        <Input name="url" type="url" required pattern="https://.*" placeholder="https://www.facebook.com/…" aria-label={t("url")} autoFocus />
        <div className="flex flex-wrap items-center gap-2">
          <Input name="publishedAt" type="datetime-local" aria-label={t("publishedWhen")} className="w-auto" defaultValue={toVietnamLocal(new Date())} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={boosted} onChange={(event) => setBoosted(event.target.checked)} className="size-4" /> {t("boosted")}
          </label>
          {boosted ? <Input name="adAccount" required maxLength={120} placeholder={t("adAccount")} aria-label={t("adAccount")} className="w-auto" /> : null}
        </div>
        <DeliveryError errorKey={errorKey} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {t("markPublished")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => setMode("published")}>
        {t("markPublished")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setMode("edit")}>
        {t("reschedule")}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(t("cancelConfirm")) && run(() => cancelPublishAction({ publishId: publish.id }))}>
        {t("cancelPost")}
      </Button>
      <DeliveryError errorKey={errorKey} />
    </div>
  );
}

function Results({ publish, canManage, today }: { publish: PublishItem; canManage: boolean; today: string }) {
  const t = useTranslations("work.results");
  const format = useFormatter();
  const { run, pending, errorKey } = useRunner();
  const [adding, setAdding] = useState(false);
  const figure = (key: (typeof RESULT_METRICS)[number], value: number | undefined) => (value === undefined ? "—" : key === "spendVnd" ? format.number(value, { style: "currency", currency: "VND" }) : format.number(value));
  const hasAny = Object.keys(publish.latest).length > 0;
  return (
    <div className="flex flex-col gap-2">
      {hasAny ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-5">
          {RESULT_METRICS.map((key) => (
            <div key={key} className="flex flex-col">
              <dt className="text-muted-foreground">{t(`metrics.${key}`)}</dt>
              <dd className="font-medium tabular-nums">{figure(key, publish.latest[key])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {publish.results.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{t("readings", { count: publish.results.length })}</summary>
          <ul className="flex flex-col divide-y pt-1">
            {publish.results.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 py-1">
                <span className="font-medium">{row.recordedOn.split("-").reverse().join("/")}</span>
                <span className="text-muted-foreground">{RESULT_METRICS.filter((key) => row.metrics[key] !== undefined).map((key) => `${t(`metrics.${key}`)} ${figure(key, row.metrics[key])}`).join(" · ")}</span>
                {row.source === "csv" ? <Badge variant="outline">CSV</Badge> : null}
                {canManage ? (
                  <Button type="button" size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(() => removeResultAction({ resultId: row.id }))}>
                    {t("remove")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canManage ? (
        adding ? (
          <form
            className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => recordResultAction({ publishId: publish.id, recordedOn: data.get("recordedOn"), ...Object.fromEntries(RESULT_METRICS.map((key) => [key, String(data.get(key) ?? "").replace(/[.,\s]/g, "")])) }), () => setAdding(false));
            }}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <Input name="recordedOn" type="date" required defaultValue={today} aria-label={t("recordedOn")} className="col-span-2 sm:col-span-1" />
              {RESULT_METRICS.map((key) => (
                <Input key={key} name={key} inputMode="numeric" placeholder={t(`metrics.${key}`)} aria-label={t(`metrics.${key}`)} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
            <DeliveryError errorKey={errorKey} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {t("save")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" size="xs" variant="outline" className="w-fit" onClick={() => setAdding(true)}>
            {t("add")}
          </Button>
        )
      ) : null}
      {!adding ? <DeliveryError errorKey={errorKey} /> : null}
    </div>
  );
}
