// The quote as a document — báo giá (FR-CRM-23): the library's `TM-BAO-GIA` template on the
// contracting entity's letterhead, filled with the quote's own lines and totals. Client-facing, so
// it carries no internal hours, cost or margin, and no contact's personal details. HR (or whoever
// keeps Admin → Document templates) edits the wording; the entity supplies its own name, address,
// tax code and representative.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { type LetterheadFields, renderTemplate } from "../documents/service";
import { lineDiscount, lineNet, periodsOf } from "./engine/quote";
import type { QuoteLineRow, QuoteRow } from "./quotes";
import { QUOTE_TEMPLATE_BODY, QUOTE_TEMPLATE_CODE } from "./seed";

export type QuoteWords = { title: string; months: (count: number) => string; money: (amount: number) => string; none: string };

const formatDay = (date: string) => date.split("-").reverse().join("/");

/** The lines as plain text: one numbered line each, its quantity, unit price, months and amount. */
export function quoteLinesText(lines: readonly Pick<QuoteLineRow, "title" | "description" | "quantity" | "unit" | "unitPriceVnd" | "discountBp" | "months">[], words: QuoteWords): string {
  return lines
    .map((line, index) => {
      const head = `${index + 1}. ${line.title}${line.description ? ` — ${line.description}` : ""}`;
      const qty = `${line.quantity}${line.unit ? ` ${line.unit}` : ""} × ${words.money(line.unitPriceVnd)}${line.months ? ` × ${words.months(periodsOf(line))}` : ""}`;
      const discount = line.discountBp ? ` − ${words.money(lineDiscount(line))} (${line.discountBp / 100}%)` : "";
      return `${head}\n   ${qty}${discount} = ${words.money(lineNet(line))}`;
    })
    .join("\n");
}

export type QuoteDocument = { title: string; number: string; text: string; missing: string[]; letterhead: LetterheadFields };

/** The quote as text on the letterhead. The caller has checked the reader may see the deal's value. */
export async function quoteDocument(quote: QuoteRow, lines: readonly QuoteLineRow[], words: QuoteWords): Promise<QuoteDocument> {
  const [[deal], [template]] = await Promise.all([
    db()
      .select({ clientName: schema.workClient.name, entity: schema.entity })
      .from(schema.crmDeal)
      .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmDeal.clientId))
      .leftJoin(schema.entity, eq(schema.entity.id, schema.crmDeal.entityId))
      .where(eq(schema.crmDeal.id, quote.dealId))
      .limit(1),
    db().select().from(schema.documentTemplate).where(and(eq(schema.documentTemplate.code, QUOTE_TEMPLATE_CODE), eq(schema.documentTemplate.isActive, true))).limit(1),
  ]);
  const entity = deal?.entity;
  const own = Object.fromEntries(Object.entries({ companyName: entity?.legalName, address: entity?.address, taxCode: entity?.taxCode, representative: entity?.legalRepresentative }).filter(([, value]) => !!value)) as LetterheadFields;
  const letterhead: LetterheadFields = { ...(template?.letterhead ?? {}), ...own };
  const number = `${quote.number} v${quote.version}`;
  const context: Record<string, string> = {
    "company.name": letterhead.companyName ?? "",
    "company.address": letterhead.address ?? "",
    "company.taxCode": letterhead.taxCode ?? "",
    "company.phone": letterhead.phone ?? "",
    "company.representative": letterhead.representative ?? "",
    "company.representativeTitle": letterhead.representativeTitle ?? "",
    "document.number": number,
    "document.date": formatDay((quote.sentAt ?? quote.updatedAt).toISOString().slice(0, 10)),
    "document.place": letterhead.place ?? "",
    "client.name": deal?.clientName ?? "",
    "quote.number": number,
    "quote.title": quote.title,
    "quote.validUntil": quote.validUntil ? formatDay(quote.validUntil) : words.none,
    "quote.intro": quote.intro ?? "",
    "quote.lines": quoteLinesText(lines, words),
    "quote.subtotal": words.money(quote.subtotalVnd),
    "quote.discount": words.money(quote.discountVnd),
    "quote.vat": `${words.money(quote.vatVnd)} (${quote.vatRateBp / 100}%)`,
    "quote.total": words.money(quote.totalVnd),
    "quote.terms": quote.terms ?? words.none,
  };
  const { text, missing } = renderTemplate(template?.body ?? QUOTE_TEMPLATE_BODY, context);
  return { title: template?.name ?? words.title, number, text, missing, letterhead };
}
