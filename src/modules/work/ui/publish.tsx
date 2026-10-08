"use client";
// The publish log of a content task (FR-PJM-54) and its results (FR-PJM-57): plan a post (where,
// on which page, when), mark it published with its URL — which is what lets the task enter its
// "Published" state — and record the figures as they come in.
import { Checkbox } from "@/components/ui/checkbox";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { DatePicker, DateTimePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { TableAddRow, TableCard, TableCardHeader } from "@/components/ui/table";
import { cancelPublishAction, markPublishedAction, planPublishAction, recordResultAction, removeResultAction, updatePublishPlanAction } from "../delivery-actions";
import { type Metrics, publishFlag, RESULT_METRICS, toVietnamLocal } from "../engine/delivery";
import { CHANNELS } from "../enums";
import { DeliveryError, errorKeyOf, type Result } from "./delivery-shared";

export type PublishItem = {
  id: string;
  platform: string;
  page: string | null;
  /** The registered page or channel the post goes out on (FR-AST-09); null = a page typed by hand. */
  digitalAssetId?: string | null;
  status: string;
  plannedAt: string | null;
  publishedAt: string | null;
  url: string | null;
  boosted: boolean;
  adAccount: string | null;
  publishedByPersonId?: string | null;
  publishedByName: string | null;
  latest: Metrics;
  results: { id: string; recordedOn: string; metrics: Metrics; source: string }[];
};

/** The registered pages and channels a post may go out on: the task's own first. */
export type PublishAccount = { id: string; name: string; platform: string };

const FLAG_VARIANT = { published: "success", late: "destructive", planned: "secondary", unscheduled: "outline", cancelled: "outline" } as const;

export function PublishPanel({
  taskId,
  channel,
  publishes,
  canManage,
  today,
  now,
  accounts = [],
  defaultAccountId = null,
}: {
  taskId: string;
  channel: string | null;
  publishes: PublishItem[];
  canManage: boolean;
  today: string;
  /** The server's clock, so a post is late on the server and the screen alike. */ now: string;
  accounts?: PublishAccount[];
  /** The task's own page or channel, when it names exactly one. */ defaultAccountId?: string | null;
}) {
  const t = useTranslations("work.publish");
  const tWork = useTranslations("work");
  const format = useFormatter();
  // The add row folds shut when the plan form is done: a new key mounts it closed.
  const [addRow, setAddRow] = useState(0);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
  if (!canManage && publishes.length === 0) return null;

  return (
    <TableCard>
      <TableCardHeader
        title={t("title")}
        count={publishes.length || null}
        actions={
          <Link href="/work/publish/results" className="text-xs font-normal underline">
            {t("importResults")}
          </Link>
        }
      />
      <List>
        {publishes.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
        {publishes.map((publish) => {
          const flag = publishFlag({ status: publish.status, plannedAt: publish.plannedAt ? new Date(publish.plannedAt) : null }, new Date(now));
          return (
            <ListItem key={publish.id} className="flex-col items-stretch gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{tWork(`channels.${publish.platform}`)}</span>
                {publish.page ? (
                  publish.digitalAssetId ? (
                    <RecordLink kind="digitalAsset" id={publish.digitalAssetId} className="text-muted-foreground underline-offset-2">
                      {publish.page}
                    </RecordLink>
                  ) : (
                    <span className="text-muted-foreground">{publish.page}</span>
                  )
                ) : null}
                <Badge variant={FLAG_VARIANT[flag]}>{t(`flags.${flag}`)}</Badge>
                {publish.boosted ? <Badge variant="info">{t("boostedOn", { account: publish.adAccount ?? "—" })}</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {publish.plannedAt ? t("plannedAt", { when: when(publish.plannedAt) }) : null}
                {publish.plannedAt && publish.publishedAt ? " · " : null}
                {publish.publishedAt
                  ? t.rich("publishedAt", {
                      when: when(publish.publishedAt),
                      name: publish.publishedByName ?? "—",
                      who: (chunks) => (
                        <RecordLink kind="person" id={publish.publishedByName ? publish.publishedByPersonId : null}>
                          {chunks}
                        </RecordLink>
                      ),
                    })
                  : null}
              </p>
              {publish.url ? (
                <a href={publish.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate underline">
                  {publish.url}
                </a>
              ) : null}
              {canManage && publish.status === "planned" ? <PublishActions publish={publish} accounts={accounts} /> : null}
              {publish.status === "published" ? <Results publish={publish} canManage={canManage} today={today} /> : null}
            </ListItem>
          );
        })}
      </List>
      {canManage ? (
        <TableAddRow key={addRow} label={t("plan")}>
          <PlanForm taskId={taskId} defaultPlatform={channel} accounts={accounts} defaultAccountId={defaultAccountId} onDone={() => setAddRow((count) => count + 1)} />
        </TableAddRow>
      ) : null}
    </TableCard>
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

function PlanForm({
  taskId,
  publish,
  defaultPlatform,
  accounts,
  defaultAccountId,
  onDone,
}: {
  taskId: string;
  publish?: PublishItem;
  defaultPlatform: string | null;
  accounts: PublishAccount[];
  defaultAccountId?: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("work.publish");
  const tWork = useTranslations("work");
  const tPlatform = useTranslations("assets.digital.platform");
  const { run, pending, errorKey } = useRunner();
  // A registered page or channel names its own platform and page; "" = typed by hand.
  const [account, setAccount] = useState(publish ? (publish.digitalAssetId ?? "") : (defaultAccountId ?? ""));
  const key = publish?.id ?? "new";
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const values = account ? { digitalAssetId: account, plannedAt: data.get("plannedAt") } : { platform: data.get("platform"), page: data.get("page"), plannedAt: data.get("plannedAt") };
        run(() => (publish ? updatePublishPlanAction({ publishId: publish.id, ...values }) : planPublishAction({ taskId, ...values })), onDone);
      }}
    >
      {accounts.length ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`account-${key}`}>{t("account")}</Label>
          <Select id={`account-${key}`} value={account} onChange={(event) => setAccount(event.target.value)}>
            <option value="">{t("accountOther")}</option>
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} · {tPlatform(option.platform)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {account ? null : (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`platform-${key}`}>{t("platform")}</Label>
              <Select id={`platform-${key}`} name="platform" defaultValue={publish?.platform ?? defaultPlatform ?? "facebook"}>
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {tWork(`channels.${channel}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`page-${key}`}>{t("page")}</Label>
              <Input id={`page-${key}`} name="page" maxLength={200} defaultValue={publish?.digitalAssetId ? "" : (publish?.page ?? "")} placeholder={t("pagePlaceholder")} />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`planned-${publish?.id ?? "new"}`}>{t("plannedFor")}</Label>
          <DateTimePicker id={`planned-${publish?.id ?? "new"}`} name="plannedAt" defaultValue={publish?.plannedAt ? toVietnamLocal(new Date(publish.plannedAt)) : ""} />
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

function PublishActions({ publish, accounts }: { publish: PublishItem; accounts: PublishAccount[] }) {
  const t = useTranslations("work.publish");
  const { run, pending, errorKey } = useRunner();
  const [mode, setMode] = useState<"none" | "published" | "edit">("none");
  const [boosted, setBoosted] = useState(false);
  if (mode === "edit") return <PlanForm taskId="" publish={publish} defaultPlatform={publish.platform} accounts={accounts} onDone={() => setMode("none")} />;
  if (mode === "published")
    return (
      <form
        className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run(
            () => markPublishedAction({ publishId: publish.id, url: data.get("url"), publishedAt: data.get("publishedAt"), boosted, adAccount: data.get("adAccount") }),
            () => setMode("none"),
          );
        }}
      >
        <Input name="url" type="url" required pattern="https://.*" placeholder="https://www.facebook.com/…" aria-label={t("url")} autoFocus />
        <div className="flex flex-wrap items-center gap-2">
          <DateTimePicker name="publishedAt" aria-label={t("publishedWhen")} className="w-auto" defaultValue={toVietnamLocal(new Date())} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={boosted} onCheckedChange={(checked) => setBoosted(checked)} className="size-4" /> {t("boosted")}
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
      <ConfirmButton size="sm" variant="ghost" disabled={pending} label={t("cancelPost")} question={t("cancelConfirm")} onConfirm={() => run(() => cancelPublishAction({ publishId: publish.id }))} />
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
                <span className="text-muted-foreground">
                  {RESULT_METRICS.filter((key) => row.metrics[key] !== undefined)
                    .map((key) => `${t(`metrics.${key}`)} ${figure(key, row.metrics[key])}`)
                    .join(" · ")}
                </span>
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
              run(
                () => recordResultAction({ publishId: publish.id, recordedOn: data.get("recordedOn"), ...Object.fromEntries(RESULT_METRICS.map((key) => [key, String(data.get(key) ?? "").replace(/[.,\s]/g, "")])) }),
                () => setAdding(false),
              );
            }}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <DatePicker name="recordedOn" required defaultValue={today} aria-label={t("recordedOn")} className="col-span-2 sm:col-span-1" />
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
