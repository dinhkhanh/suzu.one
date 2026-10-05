import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { visitorOf } from "@/lib/public-action";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { CONSENT_VERSION, DEFAULT_RETENTION_MONTHS, PUBLIC_LIMITS } from "@/modules/recruit/enums";
import { countFormLoad, findPublicOpening, issueFormToken, MAX_CV_BYTES } from "@/modules/recruit/public";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

/**
 * One advertisement and its application form (FR-REC-03).
 *
 * The form is a **plain HTML form** posting multipart to a route handler, not a server action
 * wired through React state. That is deliberate: this is the one form in the product filled in by
 * people the company has no relationship with, on whatever browser they have, possibly with
 * JavaScript off, and it carries a file. A POST-redirect-GET against a route handler works
 * everywhere, has no client bundle, and is trivial to reason about when the body is hostile.
 */
export async function generateMetadata({ params }: PageProps<"/careers/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const opening = await findPublicOpening(slug);
  // A refused page must not even have a title that says something exists here.
  if (!opening) return { title: "—", robots: { index: false, follow: false } };
  return { title: opening.title, description: noteToPlainText(opening.description).slice(0, 200) };
}

export default async function CareersOpeningPage({ params, searchParams }: PageProps<"/careers/[slug]">) {
  const { slug } = await params;
  const opening = await findPublicOpening(slug);
  // A draft, a closed job and a slug somebody made up are one and the same answer.
  if (!opening) notFound();

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const t = await getTranslations("recruit.careers");
  const locale = await getLocale();
  const format = await getFormatter();
  // Rendering the form mints a signed token, so form loads are counted per visitor. Over the limit
  // the advertisement is still shown — it is public — but no token is minted and no form drawn.
  const formAllowed = (await countFormLoad(visitorOf({ headers: new Headers(await headers()) }))).ok;
  const token = formAllowed ? issueFormToken(slug) : null;
  const title = locale === "en" && opening.titleEn ? opening.titleEn : opening.title;

  const sections = [
    ["description", opening.description],
    ["requirements", opening.requirements],
    ["benefits", opening.benefits],
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1>{title}</h1>
        <p className="text-sm text-muted-foreground">
          {[opening.entityName, opening.departmentName, opening.workLocation, t(`workMode.${opening.workMode}` as "workMode.onsite"), t(`employmentType.${opening.employmentType}` as "employmentType.employee")].filter(Boolean).join(" · ")}
        </p>
        {opening.salary ? (
          <p className="text-sm">
            {t("salary")}:{" "}
            {[opening.salary.minVnd, opening.salary.maxVnd]
              .filter((value): value is number => value !== null)
              .map((value) => format.number(value))
              .join(" – ")}{" "}
            ₫
          </p>
        ) : null}
      </header>

      {sections
        .filter(([, body]) => !!body)
        .map(([key, body]) => (
          <section key={key} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t(key)}</h2>
            {/* The recruiter's note, built into a document and rendered from that. Never
                `dangerouslySetInnerHTML`: an advertisement is not a place to start rendering markup. */}
            <RichText text={body} className="text-sm text-muted-foreground" />
          </section>
        ))}

      <section className="flex flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-base font-medium">{t("apply")}</h2>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t.has(`errors.${error}`) ? t(`errors.${error}` as "errors.failed") : t("errors.failed")}
          </p>
        ) : null}

        {token === null ? (
          <p className="text-sm text-muted-foreground">{t("formLimited")}</p>
        ) : (
        <form method="post" action={`/careers/${slug}/apply`} encType="multipart/form-data" className="flex flex-col gap-4">
          <input type="hidden" name="formToken" value={token} />
          {/* The honeypot. Hidden from people by CSS and from screen readers by aria-hidden, and
              taken out of the tab order — anything in it was put there by a machine. */}
          <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">{t("fields.fullName")} *</Label>
              <Input id="fullName" name="fullName" required maxLength={PUBLIC_LIMITS.fullName} autoComplete="name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t("fields.email")} *</Label>
              <Input id="email" name="email" type="email" required maxLength={PUBLIC_LIMITS.email} autoComplete="email" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">{t("fields.phone")}</Label>
              <Input id="phone" name="phone" maxLength={PUBLIC_LIMITS.phone} autoComplete="tel" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="location">{t("fields.location")}</Label>
              <Input id="location" name="location" maxLength={PUBLIC_LIMITS.location} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currentTitle">{t("fields.currentTitle")}</Label>
              <Input id="currentTitle" name="currentTitle" maxLength={PUBLIC_LIMITS.currentTitle} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currentEmployer">{t("fields.currentEmployer")}</Label>
              <Input id="currentEmployer" name="currentEmployer" maxLength={PUBLIC_LIMITS.currentEmployer} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cv">{t("fields.cv")}</Label>
            <input id="cv" name="cv" type="file" accept={ACCEPT_ATTRIBUTE} className="text-sm" />
            <p className="text-xs text-muted-foreground">{t("fields.cvHint", { megabytes: Math.round(MAX_CV_BYTES / (1024 * 1024)) })}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="links">{t("fields.links")}</Label>
            <Textarea id="links" name="links" rows={3} maxLength={PUBLIC_LIMITS.link * PUBLIC_LIMITS.links} placeholder={t("fields.linksPlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("fields.linksHint")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="coverLetter">{t("fields.coverLetter")}</Label>
            <Textarea id="coverLetter" name="coverLetter" rows={6} maxLength={PUBLIC_LIMITS.coverLetter} />
          </div>

          {opening.questions.map((question) => (
            <div key={question.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`answers.${question.key}`}>
                {locale === "en" && question.labelEn ? question.labelEn : question.label}
                {question.required ? " *" : ""}
              </Label>
              {question.kind === "choice" ? (
                <Select id={`answers.${question.key}`} name={`answers.${question.key}`} required={question.required} defaultValue="">
                  <option value="">—</option>
                  {question.choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </Select>
              ) : question.kind === "long_text" ? (
                <Textarea id={`answers.${question.key}`} name={`answers.${question.key}`} rows={4} required={question.required} maxLength={PUBLIC_LIMITS.answer} />
              ) : (
                <Input id={`answers.${question.key}`} name={`answers.${question.key}`} required={question.required} maxLength={PUBLIC_LIMITS.answer} />
              )}
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="salaryExpectationVnd">{t("fields.salaryExpectation")}</Label>
            <MoneyInput id="salaryExpectationVnd" name="salaryExpectationVnd" />
          </div>

          {/* The notice, and the two separate permissions it asks for. The version is submitted
              with the form so the record says which wording this person actually agreed to. */}
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="font-medium">{t("consent.title")}</p>
            {/* The months are the retention job's own figure, and the address is where an erasure
                request goes: HR acts on it from the candidate's page. */}
            <p className="whitespace-pre-line text-muted-foreground">{t("consent.body", { months: DEFAULT_RETENTION_MONTHS, email: t("consent.contactEmail") })}</p>
            <input type="hidden" name="consentVersion" value={CONSENT_VERSION} />
            <label className="flex items-start gap-2">
              <Checkbox name="consent" value="true" required className="mt-0.5" />
              <span>{t("consent.agree")} *</span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox name="talentPool" value="true" className="mt-0.5" />
              <span>{t("consent.talentPool")}</span>
            </label>
          </div>

          <Button type="submit" className="self-start">
            {t("submit")}
          </Button>
        </form>
        )}
      </section>
    </div>
  );
}
