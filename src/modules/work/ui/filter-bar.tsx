"use client";
import { CalendarDaysIcon, ChevronDownIcon, ListFilterIcon, ListIcon, SquareKanbanIcon, Table2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { EMPTY, fieldIdOf, SET } from "../engine/custom-fields";
import { filterEntries, isFilterKey, readFilters, type TaskFilters, wantsClosed } from "../engine/filter";
import { PRIORITIES, WORK_VIEWS, type WorkView } from "../enums";
import { CustomFieldFilters } from "./custom-fields";
import type { ListOptions } from "./task-list-view";

/**
 * Writes the filters into the URL, custom fields' too, leaving other parameters (view, month…) alone.
 * The page loads closed tasks only when they are asked for (`wantsClosed`): a change of that goes
 * through `navigate`, so the server sends them; every other change stays in the browser.
 */
export function writeFiltersToUrl(next: TaskFilters, extra: Record<string, string | null> = {}, navigate?: (href: string) => void) {
  const params = new URLSearchParams(window.location.search);
  const reload = !!navigate && wantsClosed(readFilters(Object.fromEntries(params))) !== wantsClosed(next);
  for (const key of [...params.keys()]) if (isFilterKey(key)) params.delete(key);
  for (const [key, value] of filterEntries(next)) params.set(key, value);
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  const href = query ? `?${query}` : window.location.pathname;
  if (reload) navigate(href);
  else window.history.replaceState(null, "", href);
}

/** Filters live in the URL (shareable, survive a reload and a change of view) without a server round trip — but for closed tasks. */
export function useUrlFilters(initial: TaskFilters) {
  const router = useRouter();
  const [filters, setFilters] = useState<TaskFilters>(initial);
  const apply = (next: TaskFilters) => {
    setFilters(next);
    writeFiltersToUrl(next, {}, (href) => router.replace(href, { scroll: false }));
  };
  return { filters, setFilter: (key: keyof TaskFilters, value: string) => apply({ ...filters, [key]: value || undefined }), clear: () => apply({}) };
}

const VIEW_ICON: Record<WorkView, React.ComponentType<{ className?: string }>> = { list: ListIcon, board: SquareKanbanIcon, calendar: CalendarDaysIcon, table: Table2Icon };

/** List / Board / Calendar / Table as a segmented control of icon keys. The current filters travel along. */
export function ViewTabs({ current, views = WORK_VIEWS }: { current: WorkView; /** The views a place offers; every list has all four. */ views?: readonly WorkView[] }) {
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
    <Segmented
      aria-label={t("label")}
      value={current}
      onChange={open}
      options={views.map((view) => {
        const Icon = VIEW_ICON[view];
        return {
          value: view,
          label: (
            <span className="flex items-center gap-1.5" title={t(view)}>
              <Icon className="size-4" />
              <span className="sr-only sm:not-sr-only">{t(view)}</span>
            </span>
          ),
        };
      })}
    />
  );
}

/** An outline button that opens a menu of one-of choices: "Group by", "Sort". */
export function MenuPicker({ label, value, choices, onChange, icon }: { label: string; value: string; choices: { value: string; label: string }[]; onChange: (value: string) => void; icon?: React.ReactNode }) {
  const current = choices.find((choice) => choice.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        {icon}
        <span className="hidden text-muted-foreground sm:inline">{label}</span>
        {current ? <span className="max-w-40 truncate">{current.label}</span> : null}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The filter row over a list, board or calendar: the search box, one chip per filter in force
 * (× takes it off), "Add filter" opening the pickers, and whatever the caller puts at the right
 * end (group by, sort, the count). The list and the table pass `showState`; the board's columns
 * are the states, so it does not.
 */
export function FilterBar({
  filters,
  setFilter,
  clear,
  options,
  showClosed = true,
  showState = false,
  showDue = false,
  children,
}: {
  filters: TaskFilters;
  setFilter: (key: keyof TaskFilters, value: string) => void;
  clear: () => void;
  options: ListOptions;
  showClosed?: boolean;
  showState?: boolean;
  showDue?: boolean;
  /** Controls at the right end of the row. */
  children?: React.ReactNode;
}) {
  const fields = options.fields?.filter((field) => field.isActive) ?? [];
  const t = useTranslations("work.list");
  const tWork = useTranslations("work");
  const tFields = useTranslations("work.customFields");
  const active = filterEntries(filters).filter(([key]) => key !== "q");

  // What a chip says: the filter's name and the value's name.
  const chip = (key: string, value: string): string => {
    const name = (list: { id: string; name?: string; fullName?: string; label?: string }[], id: string) => {
      const row = list.find((item) => item.id === id);
      return row?.name ?? row?.fullName ?? row?.label ?? id;
    };
    switch (key) {
      case "assignee":
        return `${t("assignee")}: ${value === "me" ? t("me") : value === "none" ? t("unassigned") : name(options.people, value)}`;
      case "state":
        return `${t("state")}: ${name(options.states, value)}`;
      case "priority":
        return `${t("priority")}: ${value === "none" ? tWork("priority.none") : tWork(`priority.${value as "1"}`)}`;
      case "label":
        return `${t("label")}: ${name(options.labels, value)}`;
      case "client":
        return `${t("client")}: ${value === "none" ? t("noClient") : name(options.clients, value)}`;
      case "due":
        return `${t("due")}: ${value === "overdue" ? t("dueOverdue") : value === "week" ? t("dueWeek") : t("dueNone")}`;
      case "cycle":
        return `${tWork("cycles.filter")}: ${value === "none" ? tWork("cycles.noCycle") : name(options.cycles ?? [], value)}`;
      case "closed":
        return t("showClosed");
      case "blocked":
        return t("onlyBlocked");
      case "triage":
        return t("showTriage");
    }
    const field = fields.find((row) => row.id === fieldIdOf(key));
    if (!field) return key;
    if (value === EMPTY) return tFields("filterEmpty", { name: field.name });
    if (value === SET) return tFields("filterSet", { name: field.name });
    const label = field.type === "person" ? (value === "me" ? t("me") : name(options.people, value)) : field.type === "checkbox" ? (value === "1" ? tFields("yes") : tFields("no")) : field.type === "select" || field.type === "multi_select" ? name(field.options, value) : value;
    return `${field.name}: ${label}`;
  };

  const toggle = (key: keyof TaskFilters, label: string) => (
    <Label className="flex h-9 items-center gap-2 text-sm font-normal">
      <Checkbox checked={filters[key] === "1"} onCheckedChange={(checked) => setFilter(key, checked ? "1" : "")} />
      {label}
    </Label>
  );
  const picker = (key: keyof TaskFilters, label: string, children: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select aria-label={label} value={(filters[key] as string | undefined) ?? ""} onChange={(event) => setFilter(key, event.target.value)}>
        {children}
      </Select>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="search" aria-label={t("search")} placeholder={t("search")} value={filters.q ?? ""} onChange={(event) => setFilter("q", event.target.value)} className="h-9 w-full md:h-8 md:w-52" />
      {active.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="h-8 gap-1 pr-1 pl-2.5 md:h-7">
          <span className="max-w-56 truncate">{chip(key, value)}</span>
          <button type="button" aria-label={`${t("clear")}: ${chip(key, value)}`} onClick={() => setFilter(key as keyof TaskFilters, "")} className="press flex size-5 items-center justify-center rounded-full hover:bg-foreground/10 [&_svg]:size-3">
            <XIcon />
          </button>
        </Badge>
      ))}
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
          <ListFilterIcon data-icon="inline-start" />
          {t("addFilter")}
        </PopoverTrigger>
        <PopoverContent align="start" className="flex max-h-[70vh] w-80 flex-col gap-3 overflow-y-auto p-3">
          {picker(
            "assignee",
            t("assignee"),
            <>
              <option value="">{t("anyAssignee")}</option>
              <option value="me">{t("me")}</option>
              <option value="none">{t("unassigned")}</option>
              {options.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </>,
          )}
          {showState
            ? picker(
                "state",
                t("state"),
                <>
                  <option value="">{t("anyState")}</option>
                  {options.states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </>,
              )
            : null}
          {picker(
            "priority",
            t("priority"),
            <>
              <option value="">{t("anyPriority")}</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {tWork(`priority.${priority}`)}
                </option>
              ))}
              <option value="none">{tWork("priority.none")}</option>
            </>,
          )}
          {options.labels.length
            ? picker(
                "label",
                t("label"),
                <>
                  <option value="">{t("anyLabel")}</option>
                  {options.labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </>,
              )
            : null}
          {options.clients.length
            ? picker(
                "client",
                t("client"),
                <>
                  <option value="">{t("anyClient")}</option>
                  <option value="none">{t("noClient")}</option>
                  {options.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </>,
              )
            : null}
          {showDue
            ? picker(
                "due",
                t("due"),
                <>
                  <option value="">{t("anyDue")}</option>
                  <option value="overdue">{t("dueOverdue")}</option>
                  <option value="week">{t("dueWeek")}</option>
                  <option value="none">{t("dueNone")}</option>
                </>,
              )
            : null}
          {fields.length ? (
            <div className="flex flex-col gap-2 [&_input]:w-full [&_input]:md:w-full [&>*]:w-full">
              <CustomFieldFilters fields={fields} filters={filters} setFilter={setFilter} people={options.people} />
            </div>
          ) : null}
          {options.cycles?.length
            ? picker(
                "cycle",
                tWork("cycles.filter"),
                <>
                  <option value="">{tWork("cycles.anyCycle")}</option>
                  <option value="none">{tWork("cycles.noCycle")}</option>
                  {options.cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.label}
                    </option>
                  ))}
                </>,
              )
            : null}
          <div className="flex flex-col border-t pt-2">
            {showClosed ? toggle("closed", t("showClosed")) : null}
            {toggle("blocked", t("onlyBlocked"))}
            {toggle("triage", t("showTriage"))}
          </div>
          {active.length || filters.q ? (
            <Button size="sm" variant="outline" onClick={clear}>
              {t("clear")}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
      {children ? <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

