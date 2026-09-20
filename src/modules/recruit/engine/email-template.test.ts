import { describe, expect, it } from "vitest";
import { emailTemplateProblems, MAX_BODY_LENGTH, placeholdersIn, renderEmail, unknownPlaceholders } from "./email-template";

describe("placeholdersIn", () => {
  it("finds each one once, in order, with or without spaces inside the braces", () => {
    expect(placeholdersIn("Chào {{candidate_name}}, về vị trí {{ job_title }} — {{candidate_name}}")).toEqual(["candidate_name", "job_title"]);
  });

  it("ignores text that only looks like one", () => {
    expect(placeholdersIn("{single} {{Not-A-Key}} {{ }} {{}}")).toEqual([]);
  });
});

describe("unknownPlaceholders", () => {
  it("catches a typo before it ships", () => {
    expect(unknownPlaceholders("Chào {{candidat_name}}")).toEqual(["candidat_name"]);
    expect(unknownPlaceholders("Chào {{candidate_name}}")).toEqual([]);
  });

  it("has no placeholder for money — an amount belongs in the offer letter, not in a wording", () => {
    expect(unknownPlaceholders("{{salary}} {{offer_amount}} {{amount}}")).toEqual(["salary", "offer_amount", "amount"]);
  });
});

describe("emailTemplateProblems", () => {
  const good = { subject: "Mời phỏng vấn — {{job_title}}", body: "Chào {{candidate_name}},\n\nTrân trọng,\n{{sender_name}}" };

  it("passes a wording that names only what exists", () => {
    expect(emailTemplateProblems(good)).toEqual([]);
  });

  it("refuses an empty subject or body", () => {
    expect(emailTemplateProblems({ ...good, subject: "   " })).toContain("email_template_subject_empty");
    expect(emailTemplateProblems({ ...good, body: "" })).toContain("email_template_body_empty");
  });

  it("refuses a body that is too long", () => {
    expect(emailTemplateProblems({ ...good, body: "x".repeat(MAX_BODY_LENGTH + 1) })).toContain("email_template_body_too_long");
  });

  it("refuses an unknown placeholder wherever it hides", () => {
    expect(emailTemplateProblems({ ...good, subject: "{{secret_field}}" })).toContain("email_template_unknown_placeholder");
    expect(emailTemplateProblems({ ...good, body: "{{secret_field}}" })).toContain("email_template_unknown_placeholder");
  });
});

describe("renderEmail", () => {
  it("substitutes what it has", () => {
    const rendered = renderEmail({ subject: "{{job_title}}", body: "Chào {{candidate_name}} — {{company_name}}" }, { job_title: "Biên tập viên", candidate_name: "Trần Thị Mai", company_name: "Suzu Media" });
    expect(rendered.subject).toBe("Biên tập viên");
    expect(rendered.body).toBe("Chào Trần Thị Mai — Suzu Media");
    expect(rendered.missing).toEqual([]);
  });

  it("leaves a placeholder it cannot fill standing, and says which", () => {
    const rendered = renderEmail({ subject: "x", body: "Chào {{candidate_name}}, {{stage_name}}" }, { candidate_name: "Mai" });
    expect(rendered.body).toBe("Chào Mai, {{stage_name}}");
    expect(rendered.missing).toEqual(["stage_name"]);
  });

  it("treats an empty value as missing rather than printing a hole", () => {
    expect(renderEmail({ subject: "x", body: "{{sender_title}}" }, { sender_title: "" }).missing).toEqual(["sender_title"]);
  });

  it("substitutes once — a value containing a placeholder is not expanded again", () => {
    const rendered = renderEmail({ subject: "x", body: "{{candidate_name}}" }, { candidate_name: "{{company_name}}", company_name: "Suzu" });
    expect(rendered.body).toBe("{{company_name}}");
  });
});
