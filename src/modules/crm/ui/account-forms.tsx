"use client";
// Account forms (FR-CRM-01..03, 07): a new account with the duplicate guard, the profile, the
// commercial terms, the lifecycle, the team, and contacts with their PDPL basis and erasure.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { RecordLink } from "@/components/ui/record-link";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { accountMemberAction, createAccountAction, eraseContactAction, moveAccountWorkAction, saveContactAction, saveProfileAction, saveTermsAction, setLifecycleAction, setSalesOwnerAction } from "../account-actions";
import { ACCOUNT_SIZES, ACCOUNT_TIERS, CONTACT_CHANNELS, CONTACT_SOURCES, CONTACT_STATUSES, DECISION_ROLES, LAWFUL_BASES, LIFECYCLES, SOURCES } from "../enums";
import { CrmButton, CrmForm, type Named, type Person } from "./common";

type Profile = { legalName: string | null; taxCode: string | null; address: string | null; website: string | null; industry: string | null; size: string | null; source: string | null; tier: string | null; contractingEntityId: string | null };

function ProfileFields({ profile, entities }: { profile?: Partial<Profile>; entities: Named[] }) {
  const t = useTranslations("crm");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="legalName" label={t("account.fields.legalName")}>
          <Input id="legalName" name="legalName" maxLength={200} defaultValue={profile?.legalName ?? ""} />
        </Field>
        <Field name="taxCode" label={t("account.fields.taxCode")}>
          <Input id="taxCode" name="taxCode" maxLength={20} inputMode="numeric" placeholder="0312345678" defaultValue={profile?.taxCode ?? ""} />
        </Field>
      </div>
      <Field name="address" label={t("account.fields.address")}>
        <Input id="address" name="address" maxLength={500} defaultValue={profile?.address ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="website" label={t("account.fields.website")}>
          <Input id="website" name="website" maxLength={300} defaultValue={profile?.website ?? ""} />
        </Field>
        <Field name="industry" label={t("account.fields.industry")}>
          <Input id="industry" name="industry" maxLength={100} defaultValue={profile?.industry ?? ""} />
        </Field>
        <Field name="contractingEntityId" label={t("account.fields.contractingEntity")}>
          <Select id="contractingEntityId" name="contractingEntityId" defaultValue={profile?.contractingEntityId ?? ""}>
            <option value="">—</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="size" label={t("account.fields.size")}>
          <Select id="size" name="size" defaultValue={profile?.size ?? ""}>
            <option value="">—</option>
            {ACCOUNT_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`enums.size.${size}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="tier" label={t("account.fields.tier")}>
          <Select id="tier" name="tier" defaultValue={profile?.tier ?? ""}>
            <option value="">—</option>
            {ACCOUNT_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {t(`enums.tier.${tier}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="source" label={t("account.fields.source")}>
          <Select id="source" name="source" defaultValue={profile?.source ?? ""}>
            <option value="">—</option>
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

type Duplicate = { clientId: string; name: string; reason: "tax_code" | "name" };

/** A new client with its CRM profile. A likely duplicate is shown, and saving again needs a tick. */
export function NewAccountForm({ entities, people, defaultEntityId }: { entities: Named[]; people: Person[]; defaultEntityId: string | null }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={createAccountAction} submit={t("accounts.create")} navigateTo={(data) => `/crm/accounts/${(data as { id: string }).id}`}>
      {(details) => {
        const duplicates = (details as { duplicates?: Duplicate[] } | null)?.duplicates ?? [];
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field name="name" label={t("account.fields.name")}>
                <Input id="name" name="name" required maxLength={120} />
              </Field>
              <Field name="code" label={t("account.fields.code")}>
                <Input id="code" name="code" required maxLength={20} placeholder="VNM" className="uppercase" />
              </Field>
              <Field name="entityId" label={t("account.fields.entity")}>
                <Select id="entityId" name="entityId" defaultValue={defaultEntityId ?? ""}>
                  <option value="">{t("account.groupWide")}</option>
                  {entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <ProfileFields entities={entities} profile={{ contractingEntityId: defaultEntityId }} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="accountManagerPersonId" label={t("account.fields.accountManager")}>
                <Select id="accountManagerPersonId" name="accountManagerPersonId" defaultValue="">
                  <option value="">—</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="note" label={t("account.fields.note")}>
                <Input id="note" name="note" maxLength={1000} />
              </Field>
            </div>
            {duplicates.length ? (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <p>{t("accounts.duplicates")}</p>
                <ul className="list-disc pl-5">
                  {duplicates.map((duplicate) => (
                    <li key={duplicate.clientId}>
                      <RecordLink kind="account" id={duplicate.clientId} className="underline" target="_blank" rel="noreferrer">
                        {duplicate.name}
                      </RecordLink>{" "}
                      <span className="text-muted-foreground">({t(`accounts.duplicateReason.${duplicate.reason}`)})</span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="confirmDuplicate" /> {t("accounts.confirmDuplicate")}
                </label>
              </div>
            ) : null}
          </>
        );
      }}
    </CrmForm>
  );
}

export function ProfileForm({ clientId, profile, entities }: { clientId: string; profile: Profile | null; entities: Named[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={saveProfileAction} extra={{ clientId }} submit={t("save")}>
      <ProfileFields profile={profile ?? undefined} entities={entities} />
    </CrmForm>
  );
}

export function TermsForm({ clientId, terms }: { clientId: string; terms: { paymentTermsDays: number | null; creditHold: boolean; creditHoldReason: string | null; creditLimitVnd: number | null } }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={saveTermsAction} extra={{ clientId }} submit={t("save")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="paymentTermsDays" label={t("account.fields.paymentTermsDays")}>
          <Input id="paymentTermsDays" name="paymentTermsDays" type="number" min={0} max={365} defaultValue={terms.paymentTermsDays ?? ""} placeholder={t("account.defaultTerms")} />
        </Field>
        <Field name="creditLimitVnd" label={t("account.fields.creditLimit")}>
          <MoneyInput id="creditLimitVnd" name="creditLimitVnd" defaultValue={terms.creditLimitVnd ?? ""} />
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" name="creditHold" defaultChecked={terms.creditHold} /> {t("account.fields.creditHold")}
        </label>
      </div>
      <Field name="creditHoldReason" label={t("account.fields.creditHoldReason")}>
        <Input id="creditHoldReason" name="creditHoldReason" maxLength={500} defaultValue={terms.creditHoldReason ?? ""} />
      </Field>
    </CrmForm>
  );
}

export function LifecycleForm({ clientId, lifecycle, manual }: { clientId: string; lifecycle: string; manual: boolean }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={setLifecycleAction} extra={{ clientId }} submit={t("save")} className="flex flex-wrap items-end gap-3">
      <Field name="lifecycle" label={t("account.fields.lifecycle")}>
        <Select id="lifecycle" name="lifecycle" defaultValue={manual ? lifecycle : "auto"}>
          <option value="auto">{t("account.lifecycleAuto", { lifecycle: t(`enums.lifecycle.${lifecycle as "active"}`) })}</option>
          {LIFECYCLES.map((value) => (
            <option key={value} value={value}>
              {t(`enums.lifecycle.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
    </CrmForm>
  );
}

export function SalesOwnerForm({ clientId, current, people }: { clientId: string; current: string | null; people: Person[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={setSalesOwnerAction} extra={{ clientId }} submit={t("save")} className="flex flex-wrap items-end gap-3">
      <Field name="personId" label={t("account.fields.salesOwner")}>
        <Select id="personId" name="personId" defaultValue={current ?? ""}>
          <option value="">—</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </CrmForm>
  );
}

export function AddMemberForm({ clientId, people }: { clientId: string; people: Person[] }) {
  const t = useTranslations("crm");
  return (
    <CrmForm action={accountMemberAction} extra={{ clientId, op: "add" }} submit={t("account.team.add")} className="flex flex-wrap items-end gap-3">
      <Field name="personId" label={t("account.team.person")}>
        <Select id="personId" name="personId" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </CrmForm>
  );
}

export function RemoveMemberButton({ clientId, personId }: { clientId: string; personId: string }) {
  const t = useTranslations("crm");
  return <CrmButton action={accountMemberAction} input={{ clientId, personId, op: "remove" }} label={t("account.team.remove")} variant="ghost" />;
}

type ContactValues = { id: string; fullName: string; title: string | null; decisionRole: string | null; isPrimary: boolean; status: string; brandIds: string[]; details: { email: string | null; phone: string | null; zalo: string | null; preferredChannel: string | null; birthday: string | null; notes: string | null; source: string; lawfulBasis: string } | null };

/** A contact, new or existing. The source and the lawful basis are required (PDPL). */
export function ContactForm({ clientId, contact, brands }: { clientId: string; contact?: ContactValues; brands: Named[] }) {
  const t = useTranslations("crm");
  const id = contact?.id ?? "new";
  const details = contact?.details;
  return (
    <CrmForm action={saveContactAction} extra={{ clientId, contactId: contact?.id ?? "" }} submit={contact ? t("save") : t("contacts.add")}>
      {(refusal) => {
        const duplicates = (refusal as { duplicates?: { id: string; fullName: string }[] } | null)?.duplicates ?? [];
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field name="fullName" label={t("contacts.fields.fullName")}>
                <Input id={`fullName-${id}`} name="fullName" required maxLength={120} defaultValue={contact?.fullName ?? ""} />
              </Field>
              <Field name="title" label={t("contacts.fields.title")}>
                <Input id={`title-${id}`} name="title" maxLength={120} defaultValue={contact?.title ?? ""} />
              </Field>
              <Field name="decisionRole" label={t("contacts.fields.decisionRole")}>
                <Select id={`decisionRole-${id}`} name="decisionRole" defaultValue={contact?.decisionRole ?? ""}>
                  <option value="">—</option>
                  {DECISION_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`enums.decisionRole.${role}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field name="email" label={t("contacts.fields.email")}>
                <Input id={`email-${id}`} name="email" type="email" maxLength={200} defaultValue={details?.email ?? ""} />
              </Field>
              <Field name="phone" label={t("contacts.fields.phone")}>
                <Input id={`phone-${id}`} name="phone" maxLength={40} defaultValue={details?.phone ?? ""} />
              </Field>
              <Field name="zalo" label={t("contacts.fields.zalo")}>
                <Input id={`zalo-${id}`} name="zalo" maxLength={80} defaultValue={details?.zalo ?? ""} />
              </Field>
              <Field name="preferredChannel" label={t("contacts.fields.preferredChannel")}>
                <Select id={`channel-${id}`} name="preferredChannel" defaultValue={details?.preferredChannel ?? ""}>
                  <option value="">—</option>
                  {CONTACT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {t(`enums.channel.${channel}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field name="source" label={t("contacts.fields.source")}>
                <Select id={`source-${id}`} name="source" required defaultValue={details?.source ?? "business_card"}>
                  {CONTACT_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {t(`enums.contactSource.${source}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="lawfulBasis" label={t("contacts.fields.lawfulBasis")}>
                <Select id={`basis-${id}`} name="lawfulBasis" required defaultValue={details?.lawfulBasis ?? "legitimate_interest"}>
                  {LAWFUL_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {t(`enums.lawfulBasis.${basis}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field name="birthday" label={t("contacts.fields.birthday")}>
                <DatePicker id={`birthday-${id}`} name="birthday" defaultValue={details?.birthday ?? ""} />
              </Field>
              <Field name="status" label={t("contacts.fields.status")}>
                <Select id={`status-${id}`} name="status" defaultValue={contact?.status ?? "active"}>
                  {CONTACT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`enums.contactStatus.${status}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {brands.length ? (
              <fieldset className="flex flex-wrap gap-3 text-sm">
                <legend className="mb-1 text-sm font-medium">{t("contacts.fields.brands")}</legend>
                {brands.map((brand) => (
                  <label key={brand.id} className="flex items-center gap-1.5">
                    <input type="checkbox" name="brandIds[]" value={brand.id} defaultChecked={contact?.brandIds.includes(brand.id)} /> {brand.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <Field name="notes" label={t("contacts.fields.notes")}>
              <NoteEditor id={`notes-${id}`} name="notes" rows={2} maxLength={2000} defaultValue={details?.notes ?? ""} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary} /> {t("contacts.fields.isPrimary")}
            </label>
            {duplicates.length ? (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <p>{t("contacts.duplicates", { names: duplicates.map((duplicate) => duplicate.fullName).join(", ") })}</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="confirmDuplicate" /> {t("contacts.confirmDuplicate")}
                </label>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("contacts.pdpl")}</p>
          </>
        );
      }}
    </CrmForm>
  );
}

/** Erasure on the contact's request: typed confirmation, because it cannot be undone. */
export function EraseContactForm({ contactId }: { contactId: string }) {
  const t = useTranslations("crm");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="text-xs text-destructive underline" onClick={() => setOpen(true)}>
        {t("contacts.erase")}
      </button>
    );
  return (
    <CrmForm action={eraseContactAction} extra={{ contactId }} submit={t("contacts.eraseConfirm")} className="flex flex-wrap items-end gap-3 rounded-lg border border-destructive/40 p-3">
      {/* How far the erasure reaches, and the one place it cannot: free text somebody typed. */}
      <p className="w-full text-xs text-muted-foreground">{t("contacts.eraseReach")}</p>
      <Field name="confirm" label={t("contacts.eraseType")}>
        <Input id={`erase-${contactId}`} name="confirm" required placeholder="ERASE" />
      </Field>
    </CrmForm>
  );
}

/** After a change of account manager: the previous manager's open deals and follow-ups on this account go to the new one. */
export function MoveAccountWorkButton({ clientId, fromPersonId, label }: { clientId: string; fromPersonId: string; label: string }) {
  return <CrmButton action={moveAccountWorkAction} input={{ clientId, fromPersonId }} label={label} />;
}
