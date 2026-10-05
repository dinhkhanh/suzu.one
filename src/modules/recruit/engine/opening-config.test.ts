import { describe, expect, it } from "vitest";
import { cleanKit, cleanQuestions, keyFor } from "./opening-config";

const question = (over: Partial<Parameters<typeof cleanQuestions>[0][number]> = {}) => ({ key: null, label: "Link showreel", labelEn: null, kind: "text" as const, required: false, choices: [], ...over });

describe("keyFor", () => {
  it("is the label, ascii and snake-cased, and unique against the keys taken", () => {
    expect(keyFor("Khi nào bạn có thể bắt đầu?", new Set(), "question")).toBe("khi_nao_ban_co_the_bat_dau");
    expect(keyFor("Link showreel", new Set(["link_showreel"]), "question")).toBe("link_showreel_2");
    expect(keyFor("???", new Set(), "question")).toBe("question");
  });
});

describe("cleanQuestions", () => {
  it("keeps the key a question already has — renaming it does not orphan the answers given to it", () => {
    const result = cleanQuestions([question({ key: "portfolio_reel", label: "Đường dẫn showreel (mới)" })]);
    expect(result).toEqual({ questions: [{ key: "portfolio_reel", label: "Đường dẫn showreel (mới)", labelEn: null, kind: "text", required: false, choices: [] }] });
  });

  it("gives a new question a key from its label, never one that is taken", () => {
    const result = cleanQuestions([question({ key: "link_showreel" }), question({ key: null })]);
    expect("questions" in result && result.questions.map((row) => row.key)).toEqual(["link_showreel", "link_showreel_2"]);
  });

  it("keeps the options of a choice question once each, and drops them from any other kind", () => {
    const result = cleanQuestions([question({ kind: "choice", choices: ["Ngay", " Ngay ", "Sau 1 tháng", ""] }), question({ label: "Khác", choices: ["x"] })]);
    expect("questions" in result && result.questions.map((row) => row.choices)).toEqual([["Ngay", "Sau 1 tháng"], []]);
  });

  it("refuses a blank question, a choice with one option, and too many questions", () => {
    expect(cleanQuestions([question({ label: "  " })])).toEqual({ problem: "opening_question_label_required" });
    expect(cleanQuestions([question({ kind: "choice", choices: ["Một"] })])).toEqual({ problem: "opening_question_choices_required" });
    expect(cleanQuestions(Array.from({ length: 16 }, () => question()))).toEqual({ problem: "opening_questions_too_many" });
  });
});

describe("cleanKit", () => {
  it("keeps existing keys, mints new ones, and trims the optional words to null", () => {
    const result = cleanKit([
      { key: "craft", label: "Chuyên môn", labelEn: " ", hint: null },
      { key: null, label: "Tư duy hình ảnh", labelEn: "Visual thinking", hint: " Cách kể chuyện bằng hình " },
    ]);
    expect(result).toEqual({
      kit: [
        { key: "craft", label: "Chuyên môn", labelEn: null, hint: null },
        { key: "tu_duy_hinh_anh", label: "Tư duy hình ảnh", labelEn: "Visual thinking", hint: "Cách kể chuyện bằng hình" },
      ],
    });
  });

  it("allows an empty kit — the opening then uses the default — and refuses a nameless criterion", () => {
    expect(cleanKit([])).toEqual({ kit: [] });
    expect(cleanKit([{ key: null, label: "", labelEn: null, hint: null }])).toEqual({ problem: "interview_kit_label_required" });
  });
});
