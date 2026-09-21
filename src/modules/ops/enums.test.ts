import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { AUTHORITIES, EVENT_TYPES, EVIDENCE_KEYS, OBLIGATION_CATEGORIES, RECURRENCES, SHIFTS, STATUS_COLOURS } from "./enums";

// A value added to a list without its label renders as the raw key (`ops.enums.event.licence_renewal`).
const lists = { category: OBLIGATION_CATEGORIES, authority: AUTHORITIES, recurrence: RECURRENCES, shift: SHIFTS, event: EVENT_TYPES, evidence: EVIDENCE_KEYS, colour: STATUS_COLOURS };

describe("every ops enum value has a label", () => {
  for (const [locale, messages] of Object.entries({ vi, en })) {
    it(locale, () => {
      const labels = messages.ops.enums as Record<string, Record<string, string>>;
      const missing = Object.entries(lists).flatMap(([group, values]) => values.filter((value) => !labels[group]?.[value]).map((value) => `${group}.${value}`));
      expect(missing).toEqual([]);
    });
  }
});
