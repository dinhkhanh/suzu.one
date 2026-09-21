"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { acknowledgePageAction, exportAckReportAction, remindAckAction, setAckRequirementAction } from "../actions";
import { type SubjectType, subjectKey } from "../enums";

const keyOf = (result: ActionResult<unknown>) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

function ErrorLine({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("kb");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
    </p>
  );
}

/** The reader's "I have read and understood". */
export function AcknowledgeButton({ pageId }: { pageId: string }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acknowledgePageAction({ pageId });
            setErrorKey(keyOf(result));
            if (result.ok) router.refresh();
          })
        }
      >
        {t("ack.confirm")}
      </Button>
      <ErrorLine errorKey={errorKey} />
    </span>
  );
}

type Option = { id: string; name: string };
const AUDIENCE_TYPES = ["all", "entity", "unit", "unit_only", "person"] as const satisfies readonly SubjectType[];
type AudienceType = (typeof AUDIENCE_TYPES)[number];

/** "Must read": on or off, days to confirm, who must confirm. Saves the whole setting at once. */
export function AckSettingsForm({ pageId, required, dueDays, audience, choices }: { pageId: string; required: boolean; dueDays: number; audience: { subjectKey: string; label: string }[]; choices: { entities: Option[]; units: Option[]; people: Option[] } }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const [on, setOn] = useState(required);
  const [days, setDays] = useState(String(dueDays));
  const [list, setList] = useState(audience);
  const [type, setType] = useState<AudienceType>("all");
  const [id, setId] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const options = type === "entity" ? choices.entities : type === "unit" || type === "unit_only" ? choices.units : type === "person" ? choices.people : [];

  function add() {
    if (type !== "all" && !id) return;
    const key = subjectKey(type, id);
    const label = type === "all" ? t("access.subject.all") : `${t(`access.subject.${type}`)}: ${options.find((option) => option.id === id)?.name ?? ""}`;
    setSaved(null);
    setList((current) => [...current.filter((row) => row.subjectKey !== key), { subjectKey: key, label }]);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t("ack.settingsTitle")}</h2>
      <p className="text-xs text-muted-foreground">{t("ack.settingsHelp")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(event) => setOn(event.target.checked)} />
        {t("ack.required")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        {t("ack.dueDays")}
        <Input type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} className="w-24" />
      </label>
      <ul className="flex flex-col gap-1">
        {list.map((row) => (
          <li key={row.subjectKey} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => setList((current) => current.filter((item) => item.subjectKey !== row.subjectKey))}>
              {t("access.remove")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("access.subjectType")}
          value={type}
          onChange={(event) => {
            setType(event.target.value as AudienceType);
            setId("");
          }}
        >
          {AUDIENCE_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`access.subject.${value}`)}
            </option>
          ))}
        </Select>
        {type !== "all" ? (
          <Select aria-label={t("access.subjectName")} value={id} onChange={(event) => setId(event.target.value)}>
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={add}>
          {t("access.add")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setAckRequirementAction({ pageId, required: on, dueDays: days, audience: list.map((row) => row.subjectKey) });
              setErrorKey(keyOf(result));
              setSaved(result.ok ? result.data.notified : null);
              if (result.ok) router.refresh();
            })
          }
        >
          {t("save")}
        </Button>
        {saved !== null ? <span className="text-xs text-muted-foreground">{t("ack.savedNotified", { count: saved })}</span> : null}
        <ErrorLine errorKey={errorKey} />
      </div>
    </section>
  );
}

/** The managers' tools on the report: remind everyone pending, download the list. */
export function AckReportTools({ pageId, pending }: { pageId: string; pending: number }) {
  const t = useTranslations("kb");
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [reminded, setReminded] = useState<number | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        disabled={busy || pending === 0}
        onClick={() =>
          startTransition(async () => {
            const result = await remindAckAction({ pageId });
            setErrorKey(keyOf(result));
            setReminded(result.ok ? result.data.reminded : null);
            if (result.ok) router.refresh();
          })
        }
      >
        {t("ack.remindNow")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          startTransition(async () => {
            const result = await exportAckReportAction({ pageId });
            setErrorKey(keyOf(result));
            if (!result.ok) return;
            const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = result.data.fileName;
            anchor.click();
            URL.revokeObjectURL(url);
          })
        }
      >
        {t("ack.export")}
      </Button>
      {reminded !== null ? <span className="text-xs text-muted-foreground">{t("ack.reminded", { count: reminded })}</span> : null}
      <ErrorLine errorKey={errorKey} />
    </div>
  );
}
