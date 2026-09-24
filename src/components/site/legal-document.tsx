import { Fragment } from "react";

type Section = { heading: string; body?: string[]; list?: string[]; after?: string[] };

/** A policy as the catalogue holds it (`legal.privacy`, `legal.terms`): paragraphs and lists, no markup. */
export type LegalDocumentContent = { title: string; updated: string; intro: string[]; sections: Section[] };

// Web addresses and email addresses, which the policies spell out in full so they read the same
// printed as on screen.
const LINK = /(https?:\/\/[^\s,;]+[^\s,;.)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/** Plain catalogue text with its web and email addresses made into links. */
export function LinkedText({ text }: { text: string }) {
  return text.split(LINK).map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
    const href = part.includes("@") && !part.startsWith("http") ? `mailto:${part}` : part;
    return (
      <a key={index} href={href} className="break-words text-foreground underline underline-offset-4">
        {part}
      </a>
    );
  });
}

function Paragraphs({ items }: { items?: string[] }) {
  return items?.map((text) => (
    <p key={text}>
      <LinkedText text={text} />
    </p>
  ));
}

export function LegalDocument({ content }: { content: LegalDocumentContent }) {
  return (
    <article className="flex flex-col gap-8 text-sm leading-relaxed text-muted-foreground">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-foreground">{content.title}</h1>
        <p className="text-xs">{content.updated}</p>
      </header>
      <div className="flex flex-col gap-3">
        <Paragraphs items={content.intro} />
      </div>
      {content.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">{section.heading}</h2>
          <Paragraphs items={section.body} />
          {section.list ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              {section.list.map((item) => (
                <li key={item}>
                  <LinkedText text={item} />
                </li>
              ))}
            </ul>
          ) : null}
          <Paragraphs items={section.after} />
        </section>
      ))}
    </article>
  );
}
