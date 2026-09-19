"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { ACCESS_LEVELS, type AccessLevel, SUBJECT_TYPES, type SubjectType, subjectKey } from "../enums";

type Option = { id: string; name: string };
export type AccessChoices = { entities: Option[]; departments: Option[]; teams: Option[]; people: Option[]; roles: readonly string[] };
export type AccessRowView = { subjectKey: string; level: AccessLevel; label: string };

/** Who a space, or a page and everything under it, is open to. Saves the whole list at once. */
export function AccessForm({ target, rows, choices, action, levels = ACCESS_LEVELS }: { target: { spaceId: string } | { pageId: string }; rows: AccessRowView[]; choices: AccessChoices; action: (input: unknown) => Promise<ActionResult<{ rows: number }>>; levels?: readonly AccessLevel[] }) {
  const t = useTranslations("kb");
  const tRoles = useTranslations("roles");
  const router = useRouter();
  const [list, setList] = useState(rows);
  const [type, setType] = useState<SubjectType>("all");
  const [id, setId] = useState("");
  const [level, setLevel] = useState<AccessLevel>(levels[0]);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const options: Option[] = type === "entity" ? choices.entities : type === "department" ? choices.departments : type === "team" ? choices.teams : type === "person" ? choices.people : type === "role" ? choices.roles.map((role) => ({ id: role, name: tRoles(role as "owner") })) : [];
  const labelOf = (subjectType: SubjectType, option: Option | undefined) => (subjectType === "all" ? t("access.subject.all") : `${t(`access.subject.${subjectType}`)}: ${option?.name ?? ""}`);

  function add() {
    if (type !== "all" && !id) return;
    const key = subjectKey(type, id);
    setSaved(false);
    setList((current) => [...current.filter((row) => row.subjectKey !== key), { subjectKey: key, level, label: labelOf(type, options.find((option) => option.id === id)) }]);
  }

  function save() {
    startTransition(async () => {
      const result = await action({ ...target, access: list.map((row) => ({ subjectKey: row.subjectKey, level: row.level })) });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      setSaved(result.ok);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? <p className="text-sm text-muted-foreground">{t("access.none")}</p> : null}
      <ul className="flex flex-col gap-1">
        {list.map((row) => (
          <li key={row.subjectKey} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="text-xs text-muted-foreground">{t(`access.level.${row.level}`)}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setSaved(false);
                setList((current) => current.filter((item) => item.subjectKey !== row.subjectKey));
              }}
            >
              {t("access.remove")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]">
        <Select
          aria-label={t("access.subjectType")}
          value={type}
          onChange={(event) => {
            setType(event.target.value as SubjectType);
            setId("");
          }}
        >
          {SUBJECT_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`access.subject.${value}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t("access.subjectName")} value={id} onChange={(event) => setId(event.target.value)} disabled={type === "all"}>
          <option value="">{type === "all" ? "—" : t("access.choose")}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
        <Select aria-label={t("access.levelLabel")} value={level} onChange={(event) => setLevel(event.target.value as AccessLevel)}>
          {levels.map((value) => (
            <option key={value} value={value}>
              {t(`access.level.${value}`)}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" onClick={add}>
          {t("access.add")}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" disabled={pending} onClick={save}>
          {t("access.save")}
        </Button>
        {saved ? <span className="text-xs text-muted-foreground">{t("saved")}</span> : null}
        {errorKey ? (
          <span role="alert" className="text-sm text-destructive">
            {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
