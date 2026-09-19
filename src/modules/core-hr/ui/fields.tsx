"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { GENDERS, MARITAL_STATUSES, WORKFORCE_TYPES } from "../enums";

export type PlacementOptions = {
  departments: { id: string; name: string }[];
  teams: { id: string; name: string; departmentId: string }[];
  branches: { id: string; name: string; entityId: string }[];
  positions: string[];
  people: { id: string; fullName: string }[];
};

export function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
    </div>
  );
}

export function FormError({ errorKey }: { errorKey: string | null }) {
  const t = useTranslations("people.errors");
  if (!errorKey) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(errorKey) ? t(errorKey) : t("generic")}
    </p>
  );
}

type IdentityDefaults = {
  fullName?: string;
  workEmail?: string | null;
  profile?: {
    dateOfBirth: string | null;
    gender: string | null;
    maritalStatus: string | null;
    nationality: string | null;
    phone: string | null;
    personalEmail: string | null;
    permanentAddress: string | null;
    currentAddress: string | null;
  } | null;
};

export function IdentityFields({ defaults = {} }: { defaults?: IdentityDefaults }) {
  const t = useTranslations("people");
  const profile = defaults.profile;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field name="fullName" label={t("fields.fullName")}>
        <Input id="fullName" name="fullName" required minLength={2} maxLength={120} defaultValue={defaults.fullName} />
      </Field>
      <Field name="workEmail" label={t("fields.workEmail")}>
        <Input id="workEmail" name="workEmail" type="email" defaultValue={defaults.workEmail ?? ""} placeholder={t("fields.workEmailHint")} />
      </Field>
      <Field name="profile.phone" label={t("fields.phone")}>
        <Input id="profile.phone" name="profile.phone" type="tel" maxLength={30} defaultValue={profile?.phone ?? ""} />
      </Field>
      <Field name="profile.dateOfBirth" label={t("fields.dateOfBirth")}>
        <Input id="profile.dateOfBirth" name="profile.dateOfBirth" type="date" defaultValue={profile?.dateOfBirth ?? ""} />
      </Field>
      <Field name="profile.gender" label={t("fields.gender")}>
        <Select id="profile.gender" name="profile.gender" defaultValue={profile?.gender ?? ""}>
          <option value="">—</option>
          {GENDERS.map((value) => (
            <option key={value} value={value}>
              {t(`gender.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="profile.maritalStatus" label={t("fields.maritalStatus")}>
        <Select id="profile.maritalStatus" name="profile.maritalStatus" defaultValue={profile?.maritalStatus ?? ""}>
          <option value="">—</option>
          {MARITAL_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`maritalStatus.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="profile.nationality" label={t("fields.nationality")}>
        <Input id="profile.nationality" name="profile.nationality" maxLength={60} defaultValue={profile?.nationality ?? ""} />
      </Field>
      <Field name="profile.personalEmail" label={t("fields.personalEmail")}>
        <Input id="profile.personalEmail" name="profile.personalEmail" type="email" defaultValue={profile?.personalEmail ?? ""} />
      </Field>
      <div className="hidden lg:block" />
      <Field name="profile.permanentAddress" label={t("fields.permanentAddress")}>
        <Input id="profile.permanentAddress" name="profile.permanentAddress" maxLength={300} defaultValue={profile?.permanentAddress ?? ""} />
      </Field>
      <Field name="profile.currentAddress" label={t("fields.currentAddress")}>
        <Input id="profile.currentAddress" name="profile.currentAddress" maxLength={300} defaultValue={profile?.currentAddress ?? ""} />
      </Field>
    </div>
  );
}

type PlacementDefaults = {
  workforceType?: string;
  branchId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  positionName?: string | null;
  jobLevel?: string | null;
  managerId?: string | null;
  dottedManagerId?: string | null;
  workLocation?: string | null;
};

export function PlacementFields({ options, defaults = {}, exceptPersonId }: { options: PlacementOptions; defaults?: PlacementDefaults; exceptPersonId?: string }) {
  const t = useTranslations("people");
  const people = options.people.filter((person) => person.id !== exceptPersonId);
  const personPicker = (name: "managerId" | "dottedManagerId") => (
    <Field name={`placement.${name}`} label={t(`fields.${name}`)}>
      <Select id={`placement.${name}`} name={`placement.${name}`} defaultValue={defaults[name] ?? ""}>
        <option value="">—</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.fullName}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field name="placement.workforceType" label={t("fields.workforceType")}>
        <Select id="placement.workforceType" name="placement.workforceType" required defaultValue={defaults.workforceType ?? "employee"}>
          {WORKFORCE_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`workforceType.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="placement.departmentId" label={t("fields.department")}>
        <Select id="placement.departmentId" name="placement.departmentId" defaultValue={defaults.departmentId ?? ""}>
          <option value="">—</option>
          {options.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </Field>
      {options.teams.length > 0 ? (
        <Field name="placement.teamId" label={t("fields.team")}>
          <Select id="placement.teamId" name="placement.teamId" defaultValue={defaults.teamId ?? ""}>
            <option value="">—</option>
            {options.departments.map((department) => {
              const teams = options.teams.filter((team) => team.departmentId === department.id);
              return teams.length === 0 ? null : (
                <optgroup key={department.id} label={department.name}>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </Select>
        </Field>
      ) : null}
      <Field name="placement.positionName" label={t("fields.position")}>
        <Input id="placement.positionName" name="placement.positionName" list="position-names" maxLength={120} defaultValue={defaults.positionName ?? ""} />
        <datalist id="position-names">
          {options.positions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Field>
      <Field name="placement.jobLevel" label={t("fields.jobLevel")}>
        <Input id="placement.jobLevel" name="placement.jobLevel" maxLength={60} defaultValue={defaults.jobLevel ?? ""} />
      </Field>
      {personPicker("managerId")}
      {personPicker("dottedManagerId")}
      {options.branches.length > 0 ? (
        <Field name="placement.branchId" label={t("fields.branch")}>
          <Select id="placement.branchId" name="placement.branchId" defaultValue={defaults.branchId ?? ""}>
            <option value="">—</option>
            {options.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field name="placement.workLocation" label={t("fields.workLocation")}>
        <Input id="placement.workLocation" name="placement.workLocation" maxLength={200} defaultValue={defaults.workLocation ?? ""} />
      </Field>
    </div>
  );
}
