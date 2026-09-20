"use client";
// The recruiter's controls on an opening page: publish it, put it on hold, close it, and say who
// is on the hiring team. The team form posts the whole list — what is on screen is what is saved.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { setOpeningStatusAction, setOpeningTeamAction } from "../actions";
import { OPENING_MEMBER_ROLES, type OpeningMemberRole, type OpeningStatus } from "../enums";

/** Which status buttons make sense from where. A closed opening can be reopened; a filled one stays filled. */
const NEXT_STATUSES: Record<OpeningStatus, { status: OpeningStatus; key: "publish" | "hold" | "reopen" | "close" | "fill" }[]> = {
  draft: [{ status: "open", key: "publish" }],
  open: [
    { status: "on_hold", key: "hold" },
    { status: "filled", key: "fill" },
    { status: "closed", key: "close" },
  ],
  on_hold: [
    { status: "open", key: "reopen" },
    { status: "closed", key: "close" },
  ],
  closed: [{ status: "open", key: "reopen" }],
  filled: [{ status: "open", key: "reopen" }],
};

export function OpeningStatusControls({ openingId, status }: { openingId: string; status: OpeningStatus }) {
  const actions = useTranslations("recruit.actions");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(setOpeningStatusAction, { extra: { openingId }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      {NEXT_STATUSES[status].map((next) => (
        <Button key={next.status} type="submit" name="status" value={next.status} size="sm" variant={next.key === "publish" ? "default" : "outline"} disabled={pending}>
          {actions(next.key)}
        </Button>
      ))}
      <FormError namespace="recruit.errors" errorKey={errorKey} />
    </form>
  );
}

type Member = { personId: string; role: OpeningMemberRole };

export function HiringTeamForm({ openingId, members, people }: { openingId: string; members: Member[]; people: { id: string; fullName: string }[] }) {
  const t = useTranslations("recruit.form");
  const tRoot = useTranslations("recruit");
  const roles = useTranslations("recruit.memberRole");
  const router = useRouter();
  const [rows, setRows] = useState<Member[]>(members.length > 0 ? members : []);
  const { onSubmit, pending, errorKey, saved } = useActionForm(setOpeningTeamAction, { extra: { openingId, members: rows }, onSuccess: () => router.refresh() });

  const update = (index: number, patch: Partial<Member>) => setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={`${row.personId}-${index}`} className="flex flex-wrap items-center gap-2">
            <Select aria-label={t("person")} value={row.personId} onChange={(event) => update(index, { personId: event.target.value })} className="max-w-60">
              <option value="">—</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
            <Select aria-label={t("role")} value={row.role} onChange={(event) => update(index, { role: event.target.value as OpeningMemberRole })} className="max-w-48">
              {OPENING_MEMBER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roles(role)}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRows((current) => current.filter((_, position) => position !== index))}>
              ×
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setRows((current) => [...current, { personId: people[0]?.id ?? "", role: "interviewer" }])}>
          {t("addMember")}
        </Button>
        <Button type="submit" size="sm" disabled={pending || rows.some((row) => !row.personId)}>
          {tRoot("save")}
        </Button>
        {saved ? <span className="text-xs text-muted-foreground">{tRoot("saved")}</span> : null}
      </div>
      <FormError namespace="recruit.errors" errorKey={errorKey} />
    </form>
  );
}
