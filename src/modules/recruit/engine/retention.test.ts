import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { DEFAULT_RETENTION_MONTHS } from "../enums";
import { effectiveRetainUntil, isDue, type RetentionFacts, retainUntilFrom, retentionOutcome } from "./retention";

const today = "2026-09-20" as IsoDate;

const facts = (overrides: Partial<RetentionFacts> = {}): RetentionFacts => ({
  retainUntil: "2026-09-19" as IsoDate,
  createdOn: "2025-09-19" as IsoDate,
  lastClosedOn: null,
  talentPoolConsent: false,
  anonymised: false,
  hasOpenApplication: false,
  hasHire: false,
  ...overrides,
});

describe("retainUntilFrom", () => {
  it("adds the configured window", () => {
    expect(retainUntilFrom("2026-01-15" as IsoDate)).toBe(retainUntilFrom("2026-01-15" as IsoDate, DEFAULT_RETENTION_MONTHS));
    expect(retainUntilFrom("2026-01-15" as IsoDate, 12)).toBe("2027-01-15");
  });

  it("keeps the end of a short month rather than rolling forward", () => {
    expect(retainUntilFrom("2026-08-31" as IsoDate, 6)).toBe("2027-02-28");
  });
});

describe("effectiveRetainUntil", () => {
  it("uses the stored date when there is one", () => {
    expect(effectiveRetainUntil({ retainUntil: "2027-01-01" as IsoDate, createdOn: "2020-01-01" as IsoDate })).toBe("2027-01-01");
  });

  it("runs the window from the creation day when the column is empty", () => {
    expect(effectiveRetainUntil({ retainUntil: null, createdOn: "2024-03-10" as IsoDate })).toBe(retainUntilFrom("2024-03-10" as IsoDate));
  });

  it("runs the window from the latest application's close when that is later than the date on the record", () => {
    // First applied in 2024; applied again and was turned down in August 2026.
    expect(effectiveRetainUntil({ retainUntil: "2025-03-10" as IsoDate, createdOn: "2024-03-10" as IsoDate, lastClosedOn: "2026-08-01" as IsoDate })).toBe("2027-08-01");
  });

  it("never shortens the date on the record because an application closed early", () => {
    expect(effectiveRetainUntil({ retainUntil: "2027-06-01" as IsoDate, createdOn: "2026-06-01" as IsoDate, lastClosedOn: "2026-06-02" as IsoDate })).toBe("2027-06-02");
    expect(effectiveRetainUntil({ retainUntil: "2028-01-01" as IsoDate, createdOn: "2026-06-01" as IsoDate, lastClosedOn: "2026-06-02" as IsoDate })).toBe("2028-01-01");
  });
});

describe("retentionOutcome", () => {
  it("anonymises an unsuccessful candidate whose window has passed", () => {
    expect(retentionOutcome(facts(), today)).toBe("anonymise");
    expect(isDue(facts(), today)).toBe(true);
  });

  it("leaves the window alone until it has actually passed", () => {
    expect(retentionOutcome(facts({ retainUntil: today }), today)).toBe("not_due");
    expect(retentionOutcome(facts({ retainUntil: "2026-09-21" as IsoDate }), today)).toBe("not_due");
  });

  it("keeps somebody who asked to be kept — consent is the one thing that extends the window", () => {
    expect(retentionOutcome(facts({ talentPoolConsent: true }), today)).toBe("consented");
  });

  it("never touches a live process", () => {
    expect(retentionOutcome(facts({ hasOpenApplication: true }), today)).toBe("in_progress");
  });

  it("never touches somebody who became a colleague", () => {
    expect(retentionOutcome(facts({ hasHire: true }), today)).toBe("hired");
  });

  it("is a no-op the second time — the job runs every night", () => {
    expect(retentionOutcome(facts({ anonymised: true }), today)).toBe("already_done");
    expect(isDue(facts({ anonymised: true }), today)).toBe(false);
  });

  it("checks every reason to keep before it looks at the clock", () => {
    // All of them at once, with a window long past: still kept, and for the first reason given.
    expect(retentionOutcome(facts({ retainUntil: "2020-01-01" as IsoDate, hasHire: true, talentPoolConsent: true, hasOpenApplication: true }), today)).toBe("hired");
  });

  it("does not anonymise a returning candidate the night their new application closes", () => {
    // The date on the record lapsed long ago; they applied again and were turned down yesterday.
    const returning = facts({ retainUntil: "2025-01-01" as IsoDate, createdOn: "2024-01-01" as IsoDate, lastClosedOn: "2026-09-19" as IsoDate });
    expect(retentionOutcome(returning, today)).toBe("not_due");
    // A year after that close, and a day, they are due.
    expect(retentionOutcome(returning, "2027-09-19" as IsoDate)).toBe("not_due");
    expect(retentionOutcome(returning, "2027-09-20" as IsoDate)).toBe("anonymise");
  });

  it("does not keep a record for ever because its window was never written", () => {
    expect(retentionOutcome(facts({ retainUntil: null, createdOn: "2023-01-01" as IsoDate }), today)).toBe("anonymise");
    expect(retentionOutcome(facts({ retainUntil: null, createdOn: today }), today)).toBe("not_due");
  });
});
