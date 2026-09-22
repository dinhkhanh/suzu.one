// The brief as read by everyone who may open the project (and by its kick-off approver).
import { getTranslations } from "next-intl/server";
import type { ProjectBrief } from "../schema";

const TEXT_FIELDS = ["objective", "scopeIn", "scopeOut", "successCriteria", "audience", "keyMessages", "assumptions"] as const;

export async function BriefView({ brief }: { brief: ProjectBrief }) {
  const t = await getTranslations("projects.brief");
  const filled = TEXT_FIELDS.filter((field) => brief[field]?.trim());
  if (filled.length === 0 && !brief.clientContacts?.length && !brief.links?.length) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2 [&>div]:min-w-0">
      {filled.map((field) => (
        <div key={field} className={field === "objective" || field === "successCriteria" ? "sm:col-span-2" : undefined}>
          <dt className="text-xs text-muted-foreground">{t(`fields.${field}`)}</dt>
          <dd className="whitespace-pre-line break-words">{brief[field]}</dd>
        </div>
      ))}
      {brief.clientContacts?.length ? (
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.clientContacts")}</dt>
          <dd>
            <ul>
              {brief.clientContacts.map((contact, index) => (
                <li key={index}>{[contact.name, contact.role, contact.contact].filter(Boolean).join(" — ")}</li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
      {brief.links?.length ? (
        <div>
          <dt className="text-xs text-muted-foreground">{t("fields.links")}</dt>
          <dd>
            <ul>
              {brief.links.map((link) => (
                <li key={link} className="truncate">
                  <a href={link} target="_blank" rel="noreferrer" className="underline">
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
