import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import vi from "../../messages/vi.json";
import { parseStoredMessage, storedMessage, storedText } from "./stored-text";

const translator = (locale: "vi" | "en") => createTranslator({ locale, messages: locale === "vi" ? vi : en, namespace: "stored" });

describe("stored text", () => {
  it("says a message the system stored in the reader's language", () => {
    const stored = storedMessage("toilGrant", { month: "08/2026", minutes: 120 });
    expect(storedText(stored, translator("vi"))).toBe("Nghỉ bù làm thêm giờ tháng 08/2026 (120 phút)");
    expect(storedText(stored, translator("en"))).toBe("Time off in lieu of overtime in 08/2026 (120 min)");
  });

  it("says a stored value inside a stored message too", () => {
    const first = storedMessage("retroSalaryChange", { validFrom: "2026-07-01", month: "2026-07" });
    const cancelled = storedMessage("retroCancelled", { reason: first, why: "nhập trùng" });
    expect(storedText(cancelled, translator("en"))).toBe("Salary decision effective 2026-07-01, approved after 2026-07 was paid — cancelled: nhập trùng");
  });

  it("gives back what a person typed, an older row and anything it cannot read, unchanged", () => {
    for (const text of ["Đi khám bệnh", "Nghỉ bù làm thêm giờ tháng 08/2026 (120 phút)", "i18n:{not json", 'i18n:{"key":"noSuchKey","values":{}}']) expect(storedText(text, translator("en"))).toBe(text);
    expect(storedText(null, translator("en"))).toBeNull();
    expect(parseStoredMessage("i18n:[]")).toBeNull();
  });
});
