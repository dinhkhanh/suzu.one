"use client";
// The inbox with tick boxes (FR-PLT-22: bulk approve). Only requests whose type says they may be
// approved unopened can be ticked; the action answers per request, so one refusal stops nothing.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";

export type BulkInboxRow = { id: string; type: string; summary: string; link: string | null; createdAt: Date; requesterName: string; bulk: boolean };
export type BulkResult = { requestId: string; ok: boolean; error?: string };

export function BulkInbox({ rows, action }: { rows: BulkInboxRow[]; action: (input: unknown) => Promise<ActionResult<{ results: BulkResult[] }>> }) {
  const t = useTranslations("approvals");
  const format = useFormatter();
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, BulkResult>>({});
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const tickable = rows.filter((row) => row.bulk).map((row) => row.id);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));

  function approveSelected() {
    if (selected.length === 0 || !window.confirm(t("bulk.confirm", { count: selected.length }))) return;
    startTransition(async () => {
      const result = await action({ requestIds: selected });
      setFailed(!result.ok);
      if (result.ok) {
        setResults(Object.fromEntries(result.data.results.map((row) => [row.requestId, row])));
        setSelected([]);
      }
    });
  }

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("inboxEmpty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {tickable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setSelected(selected.length === tickable.length ? [] : tickable)}>
            {selected.length === tickable.length ? t("bulk.none") : t("bulk.all", { count: tickable.length })}
          </Button>
          <Button type="button" size="sm" disabled={pending || selected.length === 0} onClick={approveSelected}>
            {t("bulk.approve", { count: selected.length })}
          </Button>
          <span className="text-xs text-muted-foreground">{t("bulk.hint")}</span>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("errors.generic")}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y rounded-xl border">
        {rows.map((row) => {
          const result = results[row.id];
          return (
            <li key={row.id} className="flex items-start gap-3 p-3">
              <input type="checkbox" className="mt-1 size-4" aria-label={t("bulk.tick")} disabled={!row.bulk || pending} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} />
              <div className="min-w-0 flex-1">
                <Link href={row.link ?? "/approvals"} className="text-sm font-medium hover:underline">
                  {t.has(`types.${row.type}`) ? t(`types.${row.type}` as "types.profile_change") : row.type}
                </Link>
                <p className="text-xs text-muted-foreground">{row.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {row.requesterName} · {format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </p>
                {result && !result.ok ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t.has(`errors.${result.error}`) ? t(`errors.${result.error}` as "errors.generic") : t("errors.generic")}
                  </p>
                ) : null}
              </div>
              {result?.ok ? <Badge variant="outline">{t("status.approved")}</Badge> : row.bulk ? null : <Badge variant="outline">{t("bulk.openIt")}</Badge>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
