"use client";
// Putting a colleague-to-be forward (FR-REC-10).
//
// The form posts **FormData**, because a CV may come with it, and it is deliberately incurious:
// whatever happens on the server — a new name, somebody already on file, somebody a colleague
// referred last week — the answer here is the same thank-you. See `referrals.ts`: a referral form
// that distinguished those cases would be a way of reading the candidate database.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { submitReferralAction } from "../referral-actions";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";
const MAX_CV_BYTES = 5 * 1024 * 1024;

export type ReferralOpening = { id: string; title: string; code: string; departmentName: string | null; entityName: string | null };

export function ReferralForm({ openings }: { openings: ReferralOpening[] }) {
  const t = useTranslations("recruit.referral");
  const tErrors = useTranslations("recruit.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cv = form.get("cv");
    if (cv instanceof File && cv.size > MAX_CV_BYTES) return setErrorKey("file_too_large");
    const element = event.currentTarget;
    setErrorKey(null);
    startTransition(async () => {
      const result = await submitReferralAction(form);
      if (result.ok) {
        setDone(true);
        element.reset();
        router.refresh();
        return;
      }
      setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
    });
  }

  if (openings.length === 0) return <p className="text-sm text-muted-foreground">{t("noOpenings")}</p>;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="referral-opening">{t("opening")}</Label>
        <Select id="referral-opening" name="openingId" required defaultValue={openings[0].id}>
          {openings.map((opening) => (
            <option key={opening.id} value={opening.id}>
              {opening.title}
              {opening.departmentName ? ` · ${opening.departmentName}` : ""}
              {opening.entityName ? ` · ${opening.entityName}` : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referral-name">{t("fullName")}</Label>
          <Input id="referral-name" name="fullName" required maxLength={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referral-email">{t("email")}</Label>
          <Input id="referral-email" name="email" type="email" maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referral-phone">{t("phone")}</Label>
          <Input id="referral-phone" name="phone" maxLength={40} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referral-title">{t("currentTitle")}</Label>
          <Input id="referral-title" name="currentTitle" maxLength={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referral-employer">{t("currentEmployer")}</Label>
          <Input id="referral-employer" name="currentEmployer" maxLength={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referral-cv">{t("cv")}</Label>
          <Input id="referral-cv" name="cv" type="file" accept=".pdf,.doc,.docx" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="referral-links">{t("links")}</Label>
        <textarea id="referral-links" name="links" rows={2} className={textarea} placeholder={t("linksHint")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="referral-note">{t("note")}</Label>
        <textarea id="referral-note" name="note" rows={3} maxLength={2000} className={textarea} placeholder={t("noteHint")} />
      </div>

      {/* PDPL: the person being referred has agreed to nothing, and the referrer should know it. */}
      <p className="text-xs text-muted-foreground">{t("consentNotice")}</p>

      {errorKey ? <p className="text-sm text-destructive">{tErrors.has(errorKey as never) ? tErrors(errorKey as never) : tErrors("generic")}</p> : null}
      {done ? <p className="text-sm text-muted-foreground">{t("thanks")}</p> : null}

      <div>
        <Button type="submit" disabled={pending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
