"use client";
// Leads and deals (FR-CRM-10..17): pass on an enquiry, work and convert it; open, change and move a
// deal — a stage's unmet gates are named, not just refused — win or lose it, open its pitch, set up
// its delivery, and answer the hand-off.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { assignLeadAction, convertLeadAction, createDealAction, createLeadAction, eraseLeadContactAction, moveDealAction, openPitchAction, reassignDealAction, reopenDealAction, resendHandoffAction, respondToHandoffAction, setDealContactsAction, setLeadStatusAction, setUpDeliveryAction, updateDealAction, updateLeadAction } from "../deal-actions";
import { ACCOUNT_TIERS, LOST_REASONS, SERVICE_LINES, SOURCES } from "../enums";
import { CrmButton, CrmForm, type Named, type Person } from "./common";

export type StageOption = { id: string; name: string; category: string };
type LeadValues = { entityId: string | null; clientId: string | null; companyName: string; contactName: string | null; contactTitle: string | null; email: string | null; phone: string | null; need: string | null; budgetText: string | null; source: string };

function LeadFields({ lead, entities, accounts }: { lead?: LeadValues; entities: Named[]; accounts: Named[] }) {
  const t = useTranslations("crm");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="companyName" label={t("lead.fields.companyName")}>
          <Input id="companyName" name="companyName" required maxLength={200} defaultValue={lead?.companyName ?? ""} />
        </Field>
        <Field name="clientId" label={t("lead.fields.existingAccount")}>
          <Select id="lead-clientId" name="clientId" defaultValue={lead?.clientId ?? ""}>
            <option value="">—</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="entityId" label={t("lead.fields.entity")}>
          <Select id="lead-entityId" name="entityId" defaultValue={lead?.entityId ?? entities[0]?.id ?? ""}>
            <option value="">{t("account.groupWide")}</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="contactName" label={t("lead.fields.contactName")}>
          <Input id="contactName" name="contactName" maxLength={120} defaultValue={lead?.contactName ?? ""} />
        </Field>
        <Field name="contactTitle" label={t("lead.fields.contactTitle")}>
          <Input id="contactTitle" name="contactTitle" maxLength={120} defaultValue={lead?.contactTitle ?? ""} />
        </Field>
        <Field name="email" label={t("lead.fields.email")}>
          <Input id="lead-email" name="email" type="email" maxLength={200} defaultValue={lead?.email ?? ""} />
        </Field>
        <Field name="phone" label={t("lead.fields.phone")}>
          <Input id="lead-phone" name="phone" maxLength={40} defaultValue={lead?.phone ?? ""} />
        </Field>
      </div>
      <Field name="need" label={t("lead.fields.need")}>
        <NoteEditor id="need" name="need" rows={2} maxLength={2000} defaultValue={lead?.need ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="budgetText" label={t("lead.fields.budget")}>
          <Input id="budgetText" name="budgetText" maxLength={200} defaultValue={lead?.budgetText ?? ""} />
        </Field>
        <Field name="source" label={t("lead.fields.source")}>
          <Select id="lead-source" name="source" defaultValue={lead?.source ?? "referral"}>
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`enums.source.${source}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </>
  );
}

/** Anyone may pass on an enquiry; a seller may give it to someone at once. */
export function NewLeadForm({ entities, accounts, sellers, canAssign }: { entities: Named[]; accounts: Named[]; sellers: Person[]; canAssign: boolean }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={createLeadAction} submit={t("leads.create")} navigateTo={(data) => `/crm/leads/${(data as { id: string }).id}`}>
      <LeadFields entities={entities} accounts={accounts} />
      {canAssign ? (
        <Field name="ownerPersonId" label={t("lead.fields.owner")}>
          <Select id="lead-owner" name="ownerPersonId" defaultValue="">
            <option value="">{t("lead.me")}</option>
            {sellers.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">{t("leads.referralHint")}</p>
      )}
    </CrmForm>
  );
}

export function EditLeadForm({ leadId, lead, entities, accounts }: { leadId: string; lead: LeadValues; entities: Named[]; accounts: Named[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={updateLeadAction} extra={{ leadId }} submit={t("save")}>
      <LeadFields lead={lead} entities={entities} accounts={accounts} />
    </CrmForm>
  );
}

export function LeadStatusButtons({ leadId, status }: { leadId: string; status: string }) {
  const t = useTranslations("crm.lead");
  return (
    <div className="flex flex-wrap gap-2">
      {status === "new" ? <CrmButton action={setLeadStatusAction} input={{ leadId, status: "contacted" }} label={t("markContacted")} /> : null}
      {status !== "qualified" ? <CrmButton action={setLeadStatusAction} input={{ leadId, status: "qualified" }} label={t("markQualified")} /> : null}
    </div>
  );
}

export function DisqualifyForm({ leadId }: { leadId: string }) {
  const t = useTranslations("crm.lead");
  return (
    <CrmForm action={setLeadStatusAction} extra={{ leadId, status: "disqualified" }} submit={t("disqualify")} className="flex flex-wrap items-end gap-3">
      <Field name="reason" label={t("disqualifyReason")}>
        <Input id="disqualify-reason" name="reason" required maxLength={500} />
      </Field>
    </CrmForm>
  );
}

/** Erasure on request for somebody who is only a lead's contact: typed confirmation, because it cannot be undone. */
export function EraseLeadContactForm({ leadId }: { leadId: string }) {
  const t = useTranslations("crm");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="link" size="xs" className="self-start px-0 text-destructive" onClick={() => setOpen(true)}>
        {t("lead.eraseContact")}
      </Button>
    );
  return (
    <CrmForm action={eraseLeadContactAction} extra={{ leadId }} submit={t("contacts.eraseConfirm")} className="flex flex-wrap items-end gap-3 rounded-lg border border-destructive/40 p-3">
      <p className="w-full text-xs text-muted-foreground">{t("lead.eraseContactReach")}</p>
      <Field name="confirm" label={t("contacts.eraseType")}>
        <Input id={`erase-lead-${leadId}`} name="confirm" required placeholder="ERASE" />
      </Field>
    </CrmForm>
  );
}

export function AssignLeadForm({ leadId, current, sellers }: { leadId: string; current: string | null; sellers: Person[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={assignLeadAction} extra={{ leadId }} submit={t("lead.assign")} className="flex flex-wrap items-end gap-3">
      <Field name="ownerPersonId" label={t("lead.fields.owner")}>
        <Select id="assign-owner" name="ownerPersonId" required defaultValue={current ?? ""}>
          <option value="" disabled>
            —
          </option>
          {sellers.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </CrmForm>
  );
}

function ServiceLineChecks({ selected }: { selected?: readonly string[] }) {
  const t = useTranslations("crm");
  return (
    <fieldset className="flex flex-wrap gap-3 text-sm">
      <legend className="mb-1 text-sm font-medium">{t("deal.fields.serviceLines")}</legend>
      {SERVICE_LINES.map((line) => (
        <label key={line} className="flex items-center gap-1.5">
          <input type="checkbox" name="serviceLines[]" value={line} defaultChecked={selected?.includes(line)} /> {t(`enums.serviceLine.${line}`)}
        </label>
      ))}
    </fieldset>
  );
}

type DealValues = { title: string; brandId: string | null; serviceLines: string[]; oneOffVnd: number | null; monthlyVnd: number | null; months: number | null; probability: number | null; expectedCloseOn: string | null; teamId: string | null; entityId: string | null; source: string | null; competitors: string | null; nextStep: string | null };

function DealFields({ deal, brands, teams, entities, seesValue }: { deal?: Partial<DealValues>; brands: Named[]; teams: Named[]; entities: Named[]; seesValue: boolean }) {
  const t = useTranslations("crm");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field name="title" label={t("deal.fields.title")}>
            <Input id="deal-title" name="title" required maxLength={200} defaultValue={deal?.title ?? ""} />
          </Field>
        </div>
        <Field name="brandId" label={t("deal.fields.brand")}>
          <Select id="deal-brand" name="brandId" defaultValue={deal?.brandId ?? ""}>
            <option value="">—</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ServiceLineChecks selected={deal?.serviceLines} />
      {seesValue ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="oneOffVnd" label={t("deal.fields.oneOff")}>
            <MoneyInput id="deal-oneoff" name="oneOffVnd" defaultValue={deal?.oneOffVnd ?? ""} />
          </Field>
          <Field name="monthlyVnd" label={t("deal.fields.monthly")}>
            <MoneyInput id="deal-monthly" name="monthlyVnd" defaultValue={deal?.monthlyVnd ?? ""} />
          </Field>
          <Field name="months" label={t("deal.fields.months")}>
            <Input id="deal-months" name="months" type="number" min={1} max={120} defaultValue={deal?.months ?? ""} />
          </Field>
          <Field name="probability" label={t("deal.fields.probability")}>
            <Input id="deal-probability" name="probability" type="number" min={0} max={100} defaultValue={deal?.probability ?? ""} placeholder={t("deal.stageDefault")} />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="expectedCloseOn" label={t("deal.fields.expectedClose")}>
          <DatePicker id="deal-close" name="expectedCloseOn" defaultValue={deal?.expectedCloseOn ?? ""} />
        </Field>
        <Field name="teamId" label={t("deal.fields.team")}>
          <Select id="deal-team" name="teamId" defaultValue={deal?.teamId ?? ""}>
            <option value="">—</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="entityId" label={t("deal.fields.entity")}>
          <Select id="deal-entity" name="entityId" defaultValue={deal?.entityId ?? ""}>
            <option value="">{t("deal.accountEntity")}</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="source" label={t("deal.fields.source")}>
          <Select id="deal-source" name="source" defaultValue={deal?.source ?? ""}>
            <option value="">—</option>
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`enums.source.${source}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="competitors" label={t("deal.fields.competitors")}>
          <Input id="deal-competitors" name="competitors" maxLength={500} defaultValue={deal?.competitors ?? ""} />
        </Field>
        <Field name="nextStep" label={t("deal.fields.nextStep")}>
          <Input id="deal-next" name="nextStep" maxLength={500} defaultValue={deal?.nextStep ?? ""} />
        </Field>
      </div>
    </>
  );
}

/** A new deal on an account: the gates of the first stage apply, so contacts and a date may be needed at once. */
export function NewDealForm({ clientId, brands, teams, entities, contacts, stages, sellers, meId }: { clientId: string; brands: Named[]; teams: Named[]; entities: Named[]; contacts: Named[]; stages: StageOption[]; sellers: Person[]; meId: string }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={createDealAction} extra={{ clientId }} submit={t("deals.create")} navigateTo={(data) => `/crm/deals/${(data as { id: string }).id}`}>
      {(details) => (
        <>
          <DealFields brands={brands} teams={teams} entities={entities} seesValue />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="stageId" label={t("deal.fields.stage")}>
              <Select id="deal-stage" name="stageId" defaultValue={stages.find((stage) => stage.category === "open")?.id ?? ""}>
                {stages
                  .filter((stage) => stage.category === "open")
                  .map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field name="ownerPersonId" label={t("deal.fields.owner")}>
              <Select id="deal-owner" name="ownerPersonId" defaultValue={meId}>
                {sellers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            {contacts.length ? (
              <Field name="contacts.0.contactId" label={t("deal.fields.contact")}>
                <Select id="deal-contact" name="contacts.0.contactId" defaultValue="">
                  <option value="">—</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          <GateMessage details={details} />
        </>
      )}
    </CrmForm>
  );
}

/** "This stage needs: contacts, an expected close date" — what the service refused a stage for. */
export function GateMessage({ details }: { details: unknown }) {
  const t = useTranslations("crm.enums.gate");
  const tDeal = useTranslations("crm.deal");
  const gates = (details as { gates?: string[] } | null)?.gates ?? [];
  if (gates.length === 0) return null;
  return <p className="text-sm text-amber-700 dark:text-amber-400">{tDeal("gatesNeeded", { gates: gates.map((gate) => (t.has(gate as "contacts") ? t(gate as "contacts") : gate)).join(", ") })}</p>;
}

/** Everyone who may change a deal also sees its value (`canEditDeal` ⊂ `canSeeDealValue`), so the value fields are always there. */
export function EditDealForm({ dealId, deal, brands, teams, entities }: { dealId: string; deal: DealValues; brands: Named[]; teams: Named[]; entities: Named[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={updateDealAction} extra={{ dealId }} submit={t("save")}>
      <DealFields deal={deal} brands={brands} teams={teams} entities={entities} seesValue />
    </CrmForm>
  );
}

/** Move to another stage. Choosing a lost stage asks for the reason. */
export function MoveStageForm({ dealId, stages, currentStageId }: { dealId: string; stages: StageOption[]; currentStageId: string }) {
  const t = useTranslations("crm");
  const [stageId, setStageId] = useState(currentStageId);
  const lost = stages.find((stage) => stage.id === stageId)?.category === "lost";
  return (
    <CrmForm action={moveDealAction} extra={{ dealId }} submit={t("deal.move")}>
      {(details) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="stageId" label={t("deal.fields.stage")}>
              <Select id="move-stage" name="stageId" value={stageId} onChange={(event) => setStageId(event.target.value)}>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
            </Field>
            {lost ? (
              <>
                <Field name="lostReason" label={t("deal.fields.lostReason")}>
                  <Select id="move-lost-reason" name="lostReason" required defaultValue="">
                    <option value="" disabled>
                      —
                    </option>
                    {LOST_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {t(`enums.lostReason.${reason}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="lostNote" label={t("deal.fields.lostNote")}>
                  <Input id="move-lost-note" name="lostNote" maxLength={1000} />
                </Field>
              </>
            ) : null}
          </div>
          <GateMessage details={details} />
        </>
      )}
    </CrmForm>
  );
}

export function DealContactsForm({ dealId, contacts, chosen }: { dealId: string; contacts: Named[]; chosen: { contactId: string; role: string | null }[] }) {
  const t = useTranslations("crm");
  const rows = [...chosen, ...Array.from({ length: Math.max(1, 3 - chosen.length) }, () => ({ contactId: "", role: null }))];
  return (
    <CrmForm action={setDealContactsAction} extra={{ dealId }} submit={t("save")}>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-3 sm:grid-cols-2">
          <Select id={`dc-${index}`} name={`contacts.${index}.contactId`} defaultValue={row.contactId} aria-label={t("deal.fields.contact")}>
            <option value="">—</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </Select>
          <Input name={`contacts.${index}.role`} maxLength={80} defaultValue={row.role ?? ""} placeholder={t("deal.contactRole")} aria-label={t("deal.contactRole")} />
        </div>
      ))}
    </CrmForm>
  );
}

export function ReassignDealForm({ dealId, current, sellers }: { dealId: string; current: string; sellers: Person[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={reassignDealAction} extra={{ dealId }} submit={t("deal.reassign")} className="flex flex-wrap items-end gap-3">
      <Field name="ownerPersonId" label={t("deal.fields.owner")}>
        <Select id="reassign-owner" name="ownerPersonId" defaultValue={current}>
          {sellers.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </CrmForm>
  );
}

export function ReopenDealForm({ dealId, stages }: { dealId: string; stages: StageOption[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={reopenDealAction} extra={{ dealId }} submit={t("deal.reopen")} className="flex flex-wrap items-end gap-3">
      <Field name="stageId" label={t("deal.fields.stage")}>
        <Select id="reopen-stage" name="stageId" defaultValue={stages.find((stage) => stage.category === "open")?.id ?? ""}>
          {stages
            .filter((stage) => stage.category === "open")
            .map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
        </Select>
      </Field>
    </CrmForm>
  );
}

type TeamWithPeople = Named & { people: Person[] };

function TeamAndLead({ teams, defaultTeamId }: { teams: TeamWithPeople[]; defaultTeamId: string | null }) {
  const t = useTranslations("crm");
  const [teamId, setTeamId] = useState(defaultTeamId ?? teams[0]?.id ?? "");
  const people = teams.find((team) => team.id === teamId)?.people ?? [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="teamId" label={t("deal.fields.team")}>
        <Select id="setup-team" name="teamId" required value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="leadPersonId" label={t("deal.delivery.lead")}>
        <Select key={teamId} id="setup-lead" name="leadPersonId" required defaultValue={people[0]?.id ?? ""}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function PitchForm({ dealId, dealTitle, teams, defaultTeamId, today }: { dealId: string; dealTitle: string; teams: TeamWithPeople[]; defaultTeamId: string | null; today: string }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={openPitchAction} extra={{ dealId }} submit={t("deal.pitch.open")}>
      <TeamAndLead teams={teams} defaultTeamId={defaultTeamId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t("deal.pitch.name")}>
          <Input id="pitch-name" name="name" required maxLength={200} defaultValue={`Pitch — ${dealTitle}`} />
        </Field>
        <Field name="dueDate" label={t("deal.pitch.dueDate")}>
          <DatePicker id="pitch-due" name="dueDate" min={today} />
        </Field>
      </div>
    </CrmForm>
  );
}

/** The won deal's delivery project, prefilled from what was sold, and the note to its lead. */
export function DeliverySetupForm({ dealId, dealTitle, teams, defaultTeamId, templates, contracts, today }: { dealId: string; dealTitle: string; teams: TeamWithPeople[]; defaultTeamId: string | null; templates: Named[]; contracts: Named[]; today: string }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={setUpDeliveryAction} extra={{ dealId }} submit={t("deal.delivery.create")}>
      <TeamAndLead teams={teams} defaultTeamId={defaultTeamId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t("deal.delivery.name")}>
          <Input id="setup-name" name="name" required maxLength={200} defaultValue={dealTitle} />
        </Field>
        <Field name="templateId" label={t("deal.delivery.template")}>
          <Select id="setup-template" name="templateId" defaultValue="">
            <option value="">{t("deal.delivery.noTemplate")}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field name="startDate" label={t("deal.delivery.startDate")}>
          <DatePicker id="setup-start" name="startDate" required defaultValue={today} />
        </Field>
        <Field name="dueDate" label={t("deal.delivery.dueDate")}>
          <DatePicker id="setup-due" name="dueDate" />
        </Field>
        <Field name="visibility" label={t("deal.delivery.visibility")}>
          <Select id="setup-visibility" name="visibility" defaultValue="team">
            {(["team", "entity", "private"] as const).map((visibility) => (
              <option key={visibility} value={visibility}>
                {t(`deal.delivery.visibilities.${visibility}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="contractId" label={t("deal.delivery.contract")}>
          <Select id="setup-contract" name="contractId" defaultValue="">
            <option value="">—</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-sm font-medium">{t("deal.delivery.note")}</p>
      <Field name="context" label={t("deal.delivery.context")}>
        <NoteEditor id="setup-context" name="context" rows={2} maxLength={4000} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="next" label={t("deal.delivery.next")}>
          <NoteEditor id="setup-next" name="next" rows={2} maxLength={4000} />
        </Field>
        <Field name="questions" label={t("deal.delivery.questions")}>
          <NoteEditor id="setup-questions" name="questions" rows={2} maxLength={4000} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{t("deal.delivery.prefillHint")}</p>
    </CrmForm>
  );
}

export function HandoffAnswerForm({ projectId }: { projectId: string }) {
  const t = useTranslations("crm.deal.handoff");
  const [returning, setReturning] = useState(false);
  if (!returning)
    return (
      <div className="flex flex-wrap gap-2">
        <CrmButton action={respondToHandoffAction} input={{ projectId, answer: "accept" }} label={t("accept")} variant="default" />
        <button type="button" className="text-xs underline" onClick={() => setReturning(true)}>
          {t("return")}
        </button>
      </div>
    );
  return (
    <CrmForm action={respondToHandoffAction} extra={{ projectId, answer: "return" }} submit={t("return")} className="flex flex-wrap items-end gap-3">
      <Field name="reason" label={t("reason")}>
        <Input id={`return-${projectId}`} name="reason" required maxLength={1000} />
      </Field>
    </CrmForm>
  );
}

export function ResendHandoffForm({ dealId, projectId }: { dealId: string; projectId: string }) {
  const t = useTranslations("crm.deal");
  return (
    <CrmForm action={resendHandoffAction} extra={{ dealId, projectId }} submit={t("handoff.resend")}>
      <Field name="context" label={t("delivery.context")}>
        <NoteEditor id={`resend-context-${projectId}`} name="context" rows={2} maxLength={4000} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="next" label={t("delivery.next")}>
          <NoteEditor id={`resend-next-${projectId}`} name="next" rows={2} maxLength={4000} />
        </Field>
        <Field name="questions" label={t("delivery.questions")}>
          <NoteEditor id={`resend-questions-${projectId}`} name="questions" rows={2} maxLength={4000} />
        </Field>
      </div>
    </CrmForm>
  );
}

/** Converting a lead: an existing account or a new one, the contact from the lead, and the deal. */
export function ConvertLeadForm({ leadId, lead, accounts, entities, teams, stages, sellers, ownerId }: { leadId: string; lead: { companyName: string; clientId: string | null; entityId: string | null; need: string | null; contactName: string | null }; accounts: Named[]; entities: Named[]; teams: Named[]; stages: StageOption[]; sellers: Person[]; ownerId: string }) {
  const t = useTranslations("crm");
  const [existing, setExisting] = useState(!!lead.clientId);
  return (
    <CrmForm action={convertLeadAction} extra={{ leadId }} submit={t("lead.convert")} navigateTo={(data) => `/crm/deals/${(data as { dealId: string }).dealId}`}>
      {(details) => {
        const duplicates = (details as { duplicates?: { clientId: string; name: string }[] } | null)?.duplicates ?? [];
        return (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="accountMode" checked={existing} onChange={() => setExisting(true)} /> {t("lead.existingAccount")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="accountMode" checked={!existing} onChange={() => setExisting(false)} /> {t("lead.newAccount")}
              </label>
            </div>
            {existing ? (
              <Field name="clientId" label={t("lead.fields.existingAccount")}>
                <Select id="convert-client" name="clientId" required defaultValue={lead.clientId ?? ""}>
                  <option value="" disabled>
                    —
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-4">
                <Field name="name" label={t("account.fields.name")}>
                  <Input id="convert-name" name="name" required maxLength={120} defaultValue={lead.companyName} />
                </Field>
                <Field name="code" label={t("account.fields.code")}>
                  <Input id="convert-code" name="code" required maxLength={20} className="uppercase" />
                </Field>
                <Field name="accountEntityId" label={t("account.fields.entity")}>
                  <Select id="convert-entity" name="accountEntityId" defaultValue={lead.entityId ?? ""}>
                    <option value="">{t("account.groupWide")}</option>
                    {entities.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field name="tier" label={t("account.fields.tier")}>
                  <Select id="convert-tier" name="tier" defaultValue="">
                    <option value="">—</option>
                    {ACCOUNT_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {t(`enums.tier.${tier}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {duplicates.length ? (
                  <label className="flex items-center gap-2 text-sm sm:col-span-4">
                    <input type="checkbox" name="confirmDuplicate" /> {t("lead.confirmDuplicate", { names: duplicates.map((duplicate) => duplicate.name).join(", ") })}
                  </label>
                ) : null}
              </div>
            )}
            {lead.contactName ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="createContact" defaultChecked /> {t("lead.createContact", { name: lead.contactName })}
              </label>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field name="title" label={t("deal.fields.title")}>
                  <Input id="convert-title" name="title" required maxLength={200} defaultValue={`${lead.companyName} — ${lead.need?.slice(0, 80) ?? ""}`.trim()} />
                </Field>
              </div>
              <Field name="stageId" label={t("deal.fields.stage")}>
                <Select id="convert-stage" name="stageId" defaultValue={stages.find((stage) => stage.category === "open")?.id ?? ""}>
                  {stages
                    .filter((stage) => stage.category === "open")
                    .map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <ServiceLineChecks />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field name="oneOffVnd" label={t("deal.fields.oneOff")}>
                <MoneyInput id="convert-oneoff" name="oneOffVnd" />
              </Field>
              <Field name="monthlyVnd" label={t("deal.fields.monthly")}>
                <MoneyInput id="convert-monthly" name="monthlyVnd" />
              </Field>
              <Field name="expectedCloseOn" label={t("deal.fields.expectedClose")}>
                <DatePicker id="convert-close" name="expectedCloseOn" />
              </Field>
              <Field name="teamId" label={t("deal.fields.team")}>
                <Select id="convert-team" name="teamId" defaultValue="">
                  <option value="">—</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field name="ownerPersonId" label={t("deal.fields.owner")}>
              <Select id="convert-owner" name="ownerPersonId" defaultValue={ownerId}>
                {sellers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <GateMessage details={details} />
          </>
        );
      }}
    </CrmForm>
  );
}
