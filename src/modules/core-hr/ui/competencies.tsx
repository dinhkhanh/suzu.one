import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/page";
import { competenciesOf, competencyChoices } from "../competencies";
import { CompetenciesForm } from "./competencies-form";
import { Fact, FactSheet } from "./fact-sheet";

// What a person is good at (FR-CHR-14), on their page: professional fields and skills, each a row
// of chips. Directory information — the page has already decided the viewer may see the person. A
// chip leads to everyone who holds it, for a viewer who has the directory. The person and HR get
// the form below; for everyone else an empty profile shows nothing at all. Server component.
export async function PersonCompetencies({ personId, canEdit, browsable }: { personId: string; canEdit: boolean; /** The viewer may open the people directory. */ browsable: boolean }) {
  const [held, choices] = await Promise.all([competenciesOf(personId), canEdit ? competencyChoices() : null]);
  if (!canEdit && held.profession.length + held.skill.length === 0) return null;
  const t = await getTranslations("people.competencies");

  const chips = (items: { id: string; name: string }[]) =>
    items.length ? (
      <span className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const chip = <Badge variant="secondary">{item.name}</Badge>;
          return browsable ? (
            <Link key={item.id} href={`/people?competencyId=${item.id}`} title={t("find", { name: item.name })} className="press rounded-full">
              {chip}
            </Link>
          ) : (
            <span key={item.id}>{chip}</span>
          );
        })}
      </span>
    ) : null;
  const names = (items: { name: string }[]) => items.map((item) => item.name);

  return (
    <Section title={t("title")}>
      <FactSheet>
        <Fact label={t("profession")}>{chips(held.profession)}</Fact>
        <Fact label={t("skill")}>{chips(held.skill)}</Fact>
      </FactSheet>
      {choices ? <CompetenciesForm personId={personId} held={{ profession: names(held.profession), skill: names(held.skill) }} choices={{ profession: names(choices.profession), skill: names(choices.skill) }} /> : null}
    </Section>
  );
}
