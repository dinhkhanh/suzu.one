// What a signed-in page hands the browser of the message catalogue (PERF-01).
//
// The root layout's `NextIntlClientProvider` serialises its messages into every page. The app's
// pages used to get the whole catalogue — most of a megabyte — on every navigation; now the shell
// gets the namespaces its client components bind a translator to, and each section of the app
// (`(app)/<segment>/layout.tsx`) adds its own. Which namespaces those are is read off the code by
// `scripts/i18n-route-namespaces.ts` and committed as `src/i18n/route-namespaces.generated.ts`.
// These tests keep the committed table equal to the code, so a client component never loses a word
// it uses. Regenerate with: pnpm i18n:routes
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAZY_NAMESPACES, SEGMENT_NAMESPACES, SHELL_NAMESPACES } from "@/i18n/route-namespaces.generated";
import { mergeMessages, pickMessages } from "@/i18n/surfaces";
import { appSegments, computeRouteNamespaces, GENERATED_PATH, renderGenerated } from "../scripts/i18n-route-namespaces";
import catalogue from "../messages/vi.json";

const computed = computeRouteNamespaces();
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const sent = (segment: keyof typeof SEGMENT_NAMESPACES) => mergeMessages(pickMessages(catalogue, SHELL_NAMESPACES), pickMessages(catalogue, SEGMENT_NAMESPACES[segment]));
const covers = (namespaces: readonly string[], namespace: string) => namespaces.some((held) => namespace === held || namespace.startsWith(`${held}.`));

describe("the namespaces each part of the app sends", () => {
  it("are read off the code, and the committed table is up to date (run `pnpm i18n:routes`)", () => {
    expect(readFileSync(GENERATED_PATH, "utf8"), "src/i18n/route-namespaces.generated.ts is stale: run `pnpm i18n:routes`").toBe(renderGenerated(computed));
  });

  it("can all be read: every client translator is bound to a literal, a constant or a namespace prop", () => {
    expect(computed.unresolved).toEqual([]);
  });

  it("are handed over by every section's layout", () => {
    for (const segment of appSegments()) {
      const layout = join(GENERATED_PATH, "..", "..", "app", "(app)", segment, "layout.tsx");
      expect(existsSync(layout), `src/app/(app)/${segment}/layout.tsx must render <SegmentMessages segment="${segment}">`).toBe(true);
      expect(readFileSync(layout, "utf8")).toContain(`<SegmentMessages segment="${segment}">`);
    }
  });

  it("follow a namespace handed to a client component as a prop, from a client file or a server page", () => {
    // <FormError namespace="kb.errors"> in a client form; errorNamespace="payroll.errors" on a server page.
    expect(covers(SEGMENT_NAMESPACES.kb, "kb.errors")).toBe(true);
    expect(covers(SEGMENT_NAMESPACES.payroll, "payroll.errors")).toBe(true);
    // const ERRORS = "attendance.requests.errors"; useTranslations(ERRORS)
    expect(covers(SEGMENT_NAMESPACES.attendance, "attendance.requests.errors")).toBe(true);
  });

  it("keep the shell's words in the shell: the theme switch and the selects", () => {
    expect(covers(SHELL_NAMESPACES, "theme")).toBe(true);
    expect(covers(SHELL_NAMESPACES, "controls")).toBe(true);
  });

  it("leave a lazy surface's words out of the shell: the assistant's sheet fetches its own when it opens", () => {
    // The button is in the shell; the chat behind it, loaded with import(), is not.
    expect(covers(SHELL_NAMESPACES, "assistantSheet")).toBe(true);
    expect(covers(SHELL_NAMESPACES, "assistant")).toBe(false);
    expect(covers(LAZY_NAMESPACES.assistantSheet, "assistant.agent.proposal")).toBe(true);
    expect(covers(LAZY_NAMESPACES.assistantSheet, "assistant.feedback")).toBe(true);
  });

  it("are a fraction of the catalogue on every page", () => {
    const whole = bytes(catalogue);
    for (const segment of Object.keys(SEGMENT_NAMESPACES) as (keyof typeof SEGMENT_NAMESPACES)[]) {
      expect(bytes(sent(segment)), segment).toBeLessThan(whole / 3);
    }
  });
});

describe("laying a section's words over the shell's", () => {
  it("merges namespace by namespace and keeps the shell's", () => {
    expect(mergeMessages({ theme: { dark: "Tối" }, work: { palette: { open: "Mở" } } }, { work: { errors: { generic: "Lỗi" } } })).toEqual({
      theme: { dark: "Tối" },
      work: { palette: { open: "Mở" }, errors: { generic: "Lỗi" } },
    });
  });

  it("leaves both inputs untouched", () => {
    const base = { work: { palette: { open: "Mở" } } };
    mergeMessages(base, { work: { errors: {} } });
    expect(base).toEqual({ work: { palette: { open: "Mở" } } });
  });
});
