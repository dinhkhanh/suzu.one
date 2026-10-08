"use client";
// The forms of the digital-asset register (FR-AST-07, 08): registering a page or a channel, letting
// somebody in, asking to be let in, answering a request, taking access away, and recording that a
// shared password was changed. Every one of them says what happened: it closes, clears or moves on.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { decideDigitalAccessAction, endDigitalAccessAction, grantDigitalAccessAction, markCredentialsRotatedAction, requestDigitalAccessAction, saveDigitalAssetAction } from "../digital-actions";
import {
  ACCESS_LEVELS,
  ACCESS_METHODS,
  type AccessLevel,
  DIGITAL_KINDS,
  DIGITAL_OWNERSHIPS,
  DIGITAL_PLATFORMS,
  DIGITAL_STATUSES,
  DIGITAL_VISIBILITIES,
  type DigitalKind,
  type DigitalOwnership,
  type DigitalPlatform,
  type DigitalStatus,
  type DigitalVisibility,
} from "../enums";

type Named = { id: string; name: string };
type Person = { id: string; fullName: string };

export type DigitalAssetFormValue = {
  id: string | null;
  kind: DigitalKind;
  platform: DigitalPlatform;
  name: string;
  handle: string | null;
  url: string | null;
  entityId: string;
  ownership: DigitalOwnership;
  clientId: string | null;
  ownerPersonId: string | null;
  visibility: DigitalVisibility;
  status: DigitalStatus;
  loginIdentity: string | null;
  recoveryContact: string | null;
  credentialLocation: string | null;
  notes: string | null;
};

export function DigitalAssetForm({
  value,
  entities,
  clients,
  people,
  canMoveEntity,
}: {
  value: DigitalAssetFormValue;
  entities: { id: string; code: string; shortName: string | null }[];
  clients: Named[];
  people: Person[];
  /** False for an owner who does not keep the register: the entity is shown, not changed. */ canMoveEntity: boolean;
}) {
  const t = useTranslations("assets.digital");
  const router = useRouter();
  const [ownership, setOwnership] = useState<DigitalOwnership>(value.ownership);
  const form = useActionForm(saveDigitalAssetAction, {
    extra: { assetId: value.id ?? "", ...(canMoveEntity ? {} : { entityId: value.entityId }) },
    // Saved: the form gives way to the asset's own page, where its people are.
    onSuccess: (data) => {
      router.push(`/assets/digital/${data.id}`);
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-5">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" label={t("fields.name")}>
            <Input id="name" name="name" required maxLength={200} defaultValue={value.name} placeholder={t("form.namePlaceholder")} />
          </Field>
          <Field name="platform" label={t("fields.platform")}>
            <Select id="platform" name="platform" required defaultValue={value.platform}>
              {DIGITAL_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {t(`platform.${platform}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="kind" label={t("fields.kind")}>
            <Select id="kind" name="kind" required defaultValue={value.kind} searchable={false}>
              {DIGITAL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kind.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="handle" label={t("fields.handle")}>
            <Input id="handle" name="handle" maxLength={200} defaultValue={value.handle ?? ""} placeholder="@suzumedia" />
          </Field>
          <div className="sm:col-span-2">
            <Field name="url" label={t("fields.url")}>
              <Input id="url" name="url" type="url" pattern="https://.*" maxLength={1000} defaultValue={value.url ?? ""} placeholder="https://www.facebook.com/…" />
            </Field>
          </div>
          <Field name="entityId" label={t("fields.entity")}>
            <Select id="entityId" name="entityId" required defaultValue={value.entityId} disabled={!canMoveEntity}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.shortName ?? entity.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="ownerPersonId" label={t("fields.owner")}>
            <Select id="ownerPersonId" name="ownerPersonId" defaultValue={value.ownerPersonId ?? ""}>
              <option value="">{t("noOwner")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="ownership" label={t("fields.ownership")}>
            <Select id="ownership" name="ownership" value={ownership} searchable={false} onChange={(event) => setOwnership(event.target.value as DigitalOwnership)}>
              {DIGITAL_OWNERSHIPS.map((option) => (
                <option key={option} value={option}>
                  {t(`ownership.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="clientId" label={ownership === "client" ? t("fields.client") : t("fields.brand")}>
            <Select id="clientId" name="clientId" required={ownership === "client"} defaultValue={value.clientId ?? ""}>
              <option value="">—</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="visibility" label={t("fields.visibility")}>
            <Select id="visibility" name="visibility" defaultValue={value.visibility} searchable={false}>
              {DIGITAL_VISIBILITIES.map((option) => (
                <option key={option} value={option}>
                  {t(`visibility.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="status" label={t("fields.status")}>
            <Select id="status" name="status" defaultValue={value.status} searchable={false}>
              {DIGITAL_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {t(`status.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("form.visibilityHint")}</p>

        {/* Restricted: read only by whoever runs the asset. Where the password is — never the password. */}
        <fieldset className="flex flex-col gap-4 border-t pt-4">
          <legend className="section-label">{t("secrets.title")}</legend>
          <Alert variant="warning">{t("secrets.never")}</Alert>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="loginIdentity" label={t("secrets.loginIdentity")}>
              <Input id="loginIdentity" name="loginIdentity" maxLength={200} defaultValue={value.loginIdentity ?? ""} placeholder="social@suzu.group" autoComplete="off" />
            </Field>
            <Field name="recoveryContact" label={t("secrets.recoveryContact")}>
              <Input id="recoveryContact" name="recoveryContact" maxLength={200} defaultValue={value.recoveryContact ?? ""} autoComplete="off" />
            </Field>
            <div className="sm:col-span-2">
              <Field name="credentialLocation" label={t("secrets.credentialLocation")}>
                <Input id="credentialLocation" name="credentialLocation" maxLength={300} defaultValue={value.credentialLocation ?? ""} placeholder={t("secrets.credentialPlaceholder")} autoComplete="off" />
              </Field>
            </div>
          </div>
          <Field name="notes" label={t("fields.notes")}>
            <NoteEditor id="notes" name="notes" rows={3} maxLength={2000} defaultValue={value.notes ?? ""} />
          </Field>
        </fieldset>
      </FieldErrors>

      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" className="w-full md:w-auto" disabled={form.pending || form.saved}>
          {value.id ? t("form.save") : t("form.register")}
        </Button>
        {form.saved ? <span className="text-sm text-success">{t("form.saved")}</span> : null}
      </div>
    </form>
  );
}

/** Runs one action and says how it went; `done` closes or clears whatever asked. */
function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const run = <T,>(call: () => Promise<ActionResult<T>>, done?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) {
        done?.();
        router.refresh();
      }
    });
  return { run, pending, errorKey };
}

// The house Select reads its `<option>` children directly, so these are arrays of options to put
// inside one — not components, which it would not look into.
function useLevelOptions() {
  const t = useTranslations("assets.digital.level");
  return ACCESS_LEVELS.map((level) => (
    <option key={level} value={level}>
      {t(level)}
    </option>
  ));
}

function useMethodOptions() {
  const t = useTranslations("assets.digital.method");
  return ACCESS_METHODS.map((method) => (
    <option key={method} value={method}>
      {t(method)}
    </option>
  ));
}

/** Lets somebody in. Naming a person who already holds access changes their level. */
export function GrantAccessForm({ assetId, people }: { assetId: string; people: Person[] }) {
  const t = useTranslations("assets.digital.grant");
  const levelOptions = useLevelOptions();
  const methodOptions = useMethodOptions();
  const router = useRouter();
  // A new key mounts the form empty once a grant has gone through.
  const [round, setRound] = useState(0);
  const [granted, setGranted] = useState(false);
  const form = useActionForm(grantDigitalAccessAction, {
    extra: { assetId },
    onSuccess: () => {
      setRound((count) => count + 1);
      setGranted(true);
      router.refresh();
    },
  });
  return (
    <form key={round} onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="personId" label={t("person")}>
            <Select id="personId" name="personId" required defaultValue="">
              <option value="">—</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="level" label={t("level")}>
            <Select id="level" name="level" defaultValue="editor" searchable={false}>
              {levelOptions}
            </Select>
          </Field>
          <Field name="method" label={t("method")}>
            <Select id="method" name="method" defaultValue="own_account" searchable={false}>
              {methodOptions}
            </Select>
          </Field>
          <Field name="expiresOn" label={t("expiresOn")}>
            <DatePicker id="expiresOn" name="expiresOn" />
          </Field>
        </div>
        <Field name="note" label={t("note")}>
          <Input id="note" name="note" maxLength={500} placeholder={t("notePlaceholder")} />
        </Field>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("submit")}
        </Button>
        {granted && !form.pending && !form.errorKey ? <span className="text-sm text-success">{t("done")}</span> : null}
      </div>
    </form>
  );
}

/** Asking to be let in. The owner answers; until then the request holds the place. */
export function RequestAccessForm({ assetId }: { assetId: string }) {
  const t = useTranslations("assets.digital.request");
  const levelOptions = useLevelOptions();
  const router = useRouter();
  const form = useActionForm(requestDigitalAccessAction, { extra: { assetId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Field name="level" label={t("level")}>
            <Select id="request-level" name="level" defaultValue="editor" searchable={false}>
              {levelOptions}
            </Select>
          </Field>
          <Field name="note" label={t("note")}>
            <Input id="request-note" name="note" maxLength={500} placeholder={t("notePlaceholder")} />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div>
        <Button type="submit" variant="accent" disabled={form.pending || form.saved}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}

/** The owner's answer to one request: let them in (at the level asked, or another), or say no and why. */
export function AccessRequestActions({ accessId, level }: { accessId: string; level: AccessLevel }) {
  const t = useTranslations("assets.digital.decide");
  const levelOptions = useLevelOptions();
  const methodOptions = useMethodOptions();
  const tErrors = useTranslations("assets.errors");
  const { run, pending, errorKey } = useRun();
  const [mode, setMode] = useState<"none" | "approve" | "decline">("none");
  if (mode === "none")
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setMode("approve")}>
          {t("approve")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("decline")}>
          {t("decline")}
        </Button>
      </div>
    );
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(
          () => decideDigitalAccessAction({ accessId, decision: mode, level: data.get("level"), method: data.get("method"), expiresOn: data.get("expiresOn"), note: data.get("note") }),
          () => setMode("none"),
        );
      }}
    >
      {mode === "approve" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Select name="level" defaultValue={level} searchable={false} aria-label={t("level")}>
            {levelOptions}
          </Select>
          <Select name="method" defaultValue="own_account" searchable={false} aria-label={t("method")}>
            {methodOptions}
          </Select>
          <DatePicker name="expiresOn" aria-label={t("expiresOn")} />
        </div>
      ) : (
        <Input name="note" required maxLength={500} placeholder={t("reason")} aria-label={t("reason")} autoFocus />
      )}
      {errorKey ? <Alert variant="destructive">{tErrors.has(errorKey) ? tErrors(errorKey) : tErrors("generic")}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={mode === "decline" ? "destructive" : "default"} disabled={pending}>
          {mode === "approve" ? t("confirmApprove") : t("confirmDecline")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>
          {t("back")}
        </Button>
      </div>
    </form>
  );
}

/** Takes access away — or, for the person themselves, gives it up or withdraws a request. */
export function EndAccessButton({ accessId, label, confirm }: { accessId: string; label: string; confirm: string }) {
  const t = useTranslations("assets.digital.end");
  const tErrors = useTranslations("assets.errors");
  const { run, pending, errorKey } = useRun();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(
          () => endDigitalAccessAction({ accessId, note: data.get("note") }),
          () => setOpen(false),
        );
      }}
    >
      <Input name="note" maxLength={500} placeholder={t("note")} aria-label={t("note")} autoFocus />
      {errorKey ? <Alert variant="destructive">{tErrors.has(errorKey) ? tErrors(errorKey) : tErrors("generic")}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {confirm}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("back")}
        </Button>
      </div>
    </form>
  );
}

/** Somebody who knew the shared password is out; this records that it has been changed. */
export function CredentialsRotatedButton({ assetId }: { assetId: string }) {
  const t = useTranslations("assets.digital.rotation");
  const { run, pending } = useRun();
  return (
    <Button type="button" size="sm" disabled={pending} onClick={() => run(() => markCredentialsRotatedAction({ assetId }))}>
      {t("done")}
    </Button>
  );
}
