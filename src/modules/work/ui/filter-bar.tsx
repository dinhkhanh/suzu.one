"use client";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { filterEntries, isFilterKey, type TaskFilters } from "../engine/filter";
import { PRIORITIES, WORK_VIEWS, type WorkView } from "../enums";
import { CustomFieldFilters } from "./custom-fields";
import type { ListOptions } from "./task-list-view";

/** Writes the filters into the URL, custom fields' too, leaving other parameters (view, month…) alone. */
export function writeFiltersToUrl(next: TaskFilters, extra: Record<string, string | null> = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const key of [...params.keys()]) if (isFilterKey(key)) params.delete(key);
  for (const [key, value] of filterEntries(next)) params.set(key, value);
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

/** Filters live in the URL (shareable, survive a reload and a change of view) without a server round trip. */
export function useUrlFilters(initial: TaskFilters) {
  const [filters, setFilters] = useState<TaskFilters>(initial);
  const apply = (next: TaskFilters) => {
    setFilters(next);
    writeFiltersToUrl(next);
  };
  return { filters, setFilter: (key: keyof TaskFilters, value: string) => apply({ ...filters, [key]: value || undefined }), clear: () => apply({}) };
}

/** List / Board / Calendar / Table. The current filters travel along. */
export function ViewTabs({ current, views = WORK_VIEWS }: { current: WorkView; /** A team's backlog has no board or calendar of its own. */ views?: readonly WorkView[] }) {
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
      {views.map((view) => (
        <button key={view} type="button" role="tab" aria-selected={view === current} onClick={() => open(view)} className={`rounded-md px-3 py-1 ${view === current ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
          {t(view)}
        </button>
      ))}
    </div>
  );
}

/** The short filter row of the board and the calendar; the list has the long one. */
export function FilterBar({ filters, setFilter, clear, options, showClosed = true }: { filters: TaskFilters; setFilter: (key: keyof TaskFilters, value: string) => void; clear: () => void; options: ListOptions; showClosed?: boolean }) {
  const fields = options.fields?.filter((field) => field.isActive) ?? [];
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
      <CustomFieldFilters fields={fields} filters={filters} setFilter={setFilter} people={options.people} />
      {options.cycles?.length ? (
        <Select aria-label={tWork("cycles.filter")} value={filters.cycle ?? ""} onChange={(event) => setFilter("cycle", event.target.value)} className="w-40">
          <option value="">{tWork("cycles.anyCycle")}</option>
          <option value="none">{tWork("cycles.noCycle")}</option>
          {options.cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.label}
            </option>
          ))}
        </Select>
      ) : null}
      {showClosed ? (
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={filters.closed === "1"} onChange={(event) => setFilter("closed", event.target.checked ? "1" : "")} /> {t("showClosed")}
        </label>
      ) : null}
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={filters.blocked === "1"} onChange={(event) => setFilter("blocked", event.target.checked ? "1" : "")} /> {t("onlyBlocked")}
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={filters.triage === "1"} onChange={(event) => setFilter("triage", event.target.checked ? "1" : "")} /> {t("showTriage")}
      </label>
      {filterEntries(filters).length ? (
        <Button size="sm" variant="ghost" onClick={clear}>
          {t("clear")}
        </Button>
      ) : null}
    </div>
  );
}
