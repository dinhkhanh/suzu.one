// The same record read by two tools is shown once, under the tool that read further.
import { describe, expect, it } from "vitest";
import type { AgentCard } from "../enums";
import { distinctCards } from "./cards";

const card = (tool: string, hrefs: string[], extra: Partial<AgentCard> = {}): AgentCard => ({ tool, href: null, items: hrefs.map((href) => ({ label: href, href, meta: null })), more: 0, ...extra });

describe("distinctCards", () => {
  it("keeps one card for a project found and then read", () => {
    const found = card("find_project", ["/projects/a"]);
    const status = card("project_status", ["/projects/a"]);
    expect(distinctCards([found, status])).toEqual([status]);
  });

  it("keeps a look-up's candidates beside the one read", () => {
    const found = card("find_person", ["/people/a", "/people/b"]);
    const overview = card("person_overview", ["/people/a"]);
    expect(distinctCards([found, overview])).toEqual([found, overview]);
  });

  it("never drops a proposal or a card with nothing listed", () => {
    const proposal = card("propose_task", ["/projects/a"], { proposal: { id: "p" } as AgentCard["proposal"] });
    const stepUp = card("step_up", [], { href: "/reauth" });
    const status = card("project_status", ["/projects/a"]);
    expect(distinctCards([proposal, stepUp, status])).toEqual([proposal, stepUp, status]);
  });
});
