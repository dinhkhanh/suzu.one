"use client";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FILTER_KEYS, type TaskFilters } from "../engine/filter";
import { PRIORITIES } from "../enums";
import type { ListOptions } from "./task-list-view";

export const WORK_VIEWS = ["list", "board", "calendar"] as const;
export type WorkView = (typeof WORK_VIEWS)[number];

/** Filters live in the URL (shareable, survive a reload and a change of view) without a server round trip. */
export function useUrlFilters(initial: TaskFilters) {
  const [filters, setFilters] = useState<TaskFilters>(initial);
  const apply = (next: TaskFilters) => {
    setFilters(next);
    const params = new URLSearchParams(window.location.search);
    for (const key of FILTER_KEYS) {
      if (next[key]) params.set(key, next[key]);
      else params.delete(key);
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  };
  return { filters, setFilter: (key: keyof TaskFilters, value: string) => apply({ ...filters, [key]: value || undefined }), clear: () => apply({}) };
}

/** List / Board / Calendar. The current filters travel along. */
export function ViewTabs({ current }: { current: WorkView }) {
  const t = useTranslations("work.views");
  const router = useRouter();
  const pathname = usePathname();
  const open = (view: WorkView) => {
    const params = new URLSearchParams(window.location.search);
    if (view === "list") params.delete("view");
    else params.set("view", view);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };
  return (
    <div role="tablist" className="flex w-fit gap-1 rounded-lg border p-0.5 text-sm">
      {WORK_VIEWS.map((view) => (
        <button key={view} type="button" role="tab" aria-selected={view === current} onClick={() => open(view)} className={`rounded-md px-3 py-1 ${view === current ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
          {t(view)}
        </button>
      ))}
    </div>
  );
}

/** The short filter row of the board and the calendar; the list has the long one. */
export function FilterBar({ filters, setFilter, clear, options, showClosed = true }: { filters: TaskFilters; setFilter: (key: keyof TaskFilters, value: string) => void; clear: () => void; options: ListOptions; showClosed?: boolean }) {
  const t = useTranslations("work.list");
  const tWork = useTranslations("work");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="search" aria-label={t("search")} placeholder={t("search")} value={filters.q ?? ""} onChange={(event) => setFilter("q", event.target.value)} className="w-52" />
      <Select aria-label={t("assignee")} value={filters.assignee ?? ""} onChange={(event) => setFilter("assignee", event.target.value)} className="w-40">
        <option value="">{t("anyAssignee")}</option>
        <option value="me">{t("me")}</option>
        <option value="none">{t("unassigned")}</option>
        {options.people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.fullName}
          </option>
        ))}
      </Select>
      <Select aria-label={t("priority")} value={filters.priority ?? ""} onChange={(event) => setFilter("priority", event.target.value)} className="w-36">
        <option value="">{t("anyPriority")}</option>
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {tWork(`priority.${priority}`)}
          </option>
        ))}
        <option value="none">{tWork("priority.none")}</option>
      </Select>
      {options.labels.length ? (
        <Select aria-label={t("label")} value={filters.label ?? ""} onChange={(event) => setFilter("label", event.target.value)} className="w-36">
          <option value="">{t("anyLabel")}</option>
          {options.labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </Select>
      ) : null}
      {options.clients.length ? (
        <Select aria-label={t("client")} value={filters.client ?? ""} onChange={(event) => setFilter("client", event.target.value)} className="w-40">
          <option value="">{t("anyClient")}</option>
          <option value="none">{t("noClient")}</option>
          {options.clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
      ) : null}
      {showClosed ? (
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={filters.closed === "1"} onChange={(event) => setFilter("closed", event.target.checked ? "1" : "")} /> {t("showClosed")}
        </label>
      ) : null}
      {FILTER_KEYS.some((key) => filters[key]) ? (
        <Button size="sm" variant="ghost" onClick={clear}>
          {t("clear")}
        </Button>
      ) : null}
    </div>
  );
}
