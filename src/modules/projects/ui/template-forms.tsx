"use client";
// Project templates v2 (FR-PJM-15) on Work → Templates: starting a project from a template makes
// both halves (the task tree and the plan), and a project template's plan half is edited here.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CHANNELS, CONTENT_FORMATS } from "../../work/enums";
import { createProjectFromTemplatePlanAction, saveTemplatePlanAction } from "../actions";
import type { ProjectBrief, RoleBudget, TemplateLine, TemplateMilestone, TemplatePhase } from "../schema";

type Person = { id: string; fullName: string };

/** A new project from a template: team, name, who plays each role, and day 0. The project starts at the kick-off gate. */
export function TemplateProjectForm({ templates, teams, peopleByTeam, today }: { templates: { id: string; name: string; ownerId: string | null; roleKeys: string[] }[]; teams: { id: string; name: string; defaultVisibility: string }[]; peopleByTeam: Record<string, Person[]>; today: string }) {
  const t = useTranslations("work.templates");
  const tWork = useTranslations("work");
  const tProjects = useTranslations("projects.templates");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const usable = templates.filter((template) => !template.ownerId || template.ownerId === teamId);
  const [templateId, setTemplateId] = useState(usable[0]?.id ?? "");
  const template = usable.find((row) => row.id === templateId) ?? usable[0];
  const people = peopleByTeam[teamId] ?? [];
  if (templates.length === 0 || teams.length === 0) return <p className="text-sm text-muted-foreground">{t("nothingToUse")}</p>;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const roles = Object.fromEntries((template?.roleKeys ?? []).map((key) => [key, String(data.get(`role.${key}`) ?? "")]));
        startTransition(async () => {
          const result = await createProjectFromTemplatePlanAction({ templateId: template?.id, anchorMode: data.get("anchorMode"), anchorDate: data.get("anchorDate"), roles, teamId, name: data.get("name"), visibility: data.get("visibility"), description: "", clientId: data.get("clientId") ?? "", leadPersonId: data.get("leadPersonId") ?? "" });
          setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
          if (result.ok) router.push(`/projects/${result.data.id}`);
        });
      }}
    >
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select aria-label={t("team")} className="sm:w-52" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
        <Select aria-label={t("template")} className="sm:w-64" value={template?.id ?? ""} onChange={(event) => setTemplateId(event.target.value)}>
          {usable.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
        <Input name="name" required maxLength={120} placeholder={t("projectName")} aria-label={t("projectName")} className="sm:min-w-48 sm:flex-1" />
        <Select name="visibility" aria-label={tWork("projects.fields.visibility")} className="sm:w-40" key={teamId} defaultValue={teams.find((team) => team.id === teamId)?.defaultVisibility ?? "team"}>
          {(["entity", "team", "private"] as const).map((value) => (
            <option key={value} value={value}>
              {tWork(`visibility.${value}`)}
            </option>
          ))}
        </Select>
        <Select name="leadPersonId" aria-label={tWork("projects.fields.leadPersonId")} className="sm:w-52" defaultValue="">
          <option value="">{tProjects("leadMe")}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-2 text-sm sm:flex sm:flex-wrap sm:items-center">
        <Select name="anchorMode" aria-label={t("anchorMode")} className="sm:w-56" defaultValue="start">
          <option value="start">{t("anchor.start")}</option>
          <option value="end">{t("anchor.end")}</option>
        </Select>
        <Input name="anchorDate" type="date" required defaultValue={today} aria-label={t("anchorDate")} className="sm:w-44" />
      </div>
      {template?.roleKeys.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">{t("whoPlays")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {template.roleKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 font-mono text-xs">{key}</span>
                <Select name={`role.${key}`} aria-label={key} defaultValue="" className="min-w-0 flex-1">
                  <option value="">{t("unassigned")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <p className="text-xs text-muted-foreground">{tProjects("gateNote")}</p>
      <FormError namespace="projects.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {t("createProject")}
        </Button>
      </div>
    </form>
  );
}

export type TemplatePlanValues = { kind: string; updateCadenceDays: number; phases: TemplatePhase[]; milestones: TemplateMilestone[]; deliverables: TemplateLine[]; budgetByRole: RoleBudget[]; brief: ProjectBrief };

const hoursOf = (minutes: number) => (minutes ? String(Math.round((minutes / 60) * 100) / 100) : "");
const textarea = "min-h-16 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm";

/**
 * The plan half of a project template: phases, milestones and register lines with days from day 0
 * (the same day 0 as the steps), the hours budget by role and the brief to start from. Rows are
 * shown with two blank ones to add to; a row left blank is dropped.
 */
export function TemplatePlanEditor({ templateId, values, kinds }: { templateId: string; values: TemplatePlanValues; kinds: readonly string[] }) {
  const t = useTranslations("projects");
  const tWork = useTranslations("work");
  const router = useRouter();
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(saveTemplatePlanAction, { extra: { templateId }, onSuccess: () => router.refresh() });
  const blank2 = <Row,>(rows: Row[], blank: Row) => [...rows, blank, blank];
  const phases = blank2<TemplatePhase>(values.phases, { name: "", startDay: 0, endDay: 0 });
  const milestones = blank2<TemplateMilestone>(values.milestones, { name: "", day: 0, phase: null, isClientFacing: false, isBilling: false });
  const lines = blank2<TemplateLine>(values.deliverables, { title: "", quantity: 1, format: null, channel: null, milestone: null, day: null });
  const roles = blank2<RoleBudget>(values.budgetByRole, { role: "", minutes: 0 });
  const isBlank = (index: number, length: number) => index >= length;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field name="kind" label={t("fields.kind")}>
            <Select id={`tp-kind-${templateId}`} name="kind" defaultValue={values.kind}>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kinds.${kind as "client"}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="updateCadenceDays" label={t("fields.updateCadenceDays")}>
            <Input id={`tp-cadence-${templateId}`} name="updateCadenceDays" type="number" min={1} max={60} defaultValue={values.updateCadenceDays} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("plan.phases")}</legend>
          {phases.map((phase, index) => (
            <div key={index} className="grid grid-cols-[1fr_5rem_5rem] gap-2">
              <Input name={`phases.${index}.name`} defaultValue={phase.name} maxLength={120} placeholder={t("fields.phase")} aria-label={t("fields.phase")} />
              <Input name={`phases.${index}.startDay`} type="number" defaultValue={isBlank(index, values.phases.length) ? "" : phase.startDay} placeholder={t("templates.fromDay")} aria-label={t("templates.fromDay")} />
              <Input name={`phases.${index}.endDay`} type="number" defaultValue={isBlank(index, values.phases.length) ? "" : phase.endDay} placeholder={t("templates.toDay")} aria-label={t("templates.toDay")} />
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("plan.milestones")}</legend>
          {milestones.map((milestone, index) => (
            <div key={index} className="grid grid-cols-[1fr_5rem] gap-2 sm:grid-cols-[1fr_5rem_10rem_auto_auto] sm:items-center">
              <Input name={`milestones.${index}.name`} defaultValue={milestone.name} maxLength={160} placeholder={t("fields.milestone")} aria-label={t("fields.milestone")} />
              <Input name={`milestones.${index}.day`} type="number" defaultValue={isBlank(index, values.milestones.length) ? "" : milestone.day} placeholder={t("templates.day")} aria-label={t("templates.day")} />
              <Select name={`milestones.${index}.phase`} defaultValue={milestone.phase ?? ""} aria-label={t("fields.phase")}>
                <option value="">—</option>
                {values.phases.map((phase, phaseIndex) => (
                  <option key={phaseIndex} value={phaseIndex}>
                    {phase.name}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" name={`milestones.${index}.isClientFacing`} defaultChecked={milestone.isClientFacing} /> {t("fields.isClientFacing")}
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" name={`milestones.${index}.isBilling`} defaultChecked={milestone.isBilling} /> {t("fields.isBilling")}
              </label>
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("register.title")}</legend>
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-[4rem_1fr] gap-2 sm:grid-cols-[4rem_1fr_9rem_9rem_10rem_5rem]">
              <Input name={`deliverables.${index}.quantity`} type="number" min={1} defaultValue={isBlank(index, values.deliverables.length) ? "" : line.quantity} aria-label={t("fields.quantity")} placeholder="1" />
              <Input name={`deliverables.${index}.title`} defaultValue={line.title} maxLength={200} placeholder={t("register.titleHint")} aria-label={t("fields.deliverable")} />
              <Select name={`deliverables.${index}.format`} defaultValue={line.format ?? ""} aria-label={t("fields.format")}>
                <option value="">—</option>
                {CONTENT_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {tWork(`formats.${format}`)}
                  </option>
                ))}
              </Select>
              <Select name={`deliverables.${index}.channel`} defaultValue={line.channel ?? ""} aria-label={t("fields.channel")}>
                <option value="">—</option>
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {tWork(`channels.${channel}`)}
                  </option>
                ))}
              </Select>
              <Select name={`deliverables.${index}.milestone`} defaultValue={line.milestone ?? ""} aria-label={t("fields.milestone")}>
                <option value="">—</option>
                {values.milestones.map((milestone, milestoneIndex) => (
                  <option key={milestoneIndex} value={milestoneIndex}>
                    {milestone.name}
                  </option>
                ))}
              </Select>
              <Input name={`deliverables.${index}.day`} type="number" defaultValue={line.day ?? ""} placeholder={t("templates.day")} aria-label={t("templates.day")} />
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("settings.byRole")}</legend>
          {roles.map((role, index) => (
            <div key={index} className="grid grid-cols-[1fr_7rem] gap-2">
              <Input name={`roles.${index}.role`} defaultValue={role.role} maxLength={60} placeholder={t("settings.rolePlaceholder")} aria-label={t("settings.role")} />
              <Input name={`roles.${index}.hours`} type="number" min={0} step="0.5" defaultValue={hoursOf(role.minutes)} aria-label={t("fields.budgetHours")} />
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("templates.brief")}</legend>
          {(["objective", "scopeIn", "scopeOut", "successCriteria", "assumptions"] as const).map((field) => (
            <Field key={field} name={field} label={t(`brief.fields.${field}`)}>
              <textarea id={`tp-${field}-${templateId}`} name={field} rows={2} maxLength={4000} defaultValue={values.brief[field] ?? ""} className={textarea} />
            </Field>
          ))}
        </fieldset>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("templates.daysNote")}</p>
      <FormError namespace="projects.errors" errorKey={errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t("templates.save")}
        </Button>
        {saved && !errorKey ? <span className="text-xs text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}
