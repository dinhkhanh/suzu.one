// Professional fields and skills (FR-CHR-14) against a real Postgres (PGlite): one catalogue the
// whole group reuses, a person's two lists, and the directory filter that finds who holds one.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

import { db, schema } from "@/lib/db";
import type { Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { addCompetency, cleanCompetencyNames, competenciesOf, competencyChoices, deleteCompetency, listCompetencies, listCompetencyCatalogue, setPersonCompetencies, updateCompetency } from "./competencies";
import { listPeople } from "./service";

const ids = {} as Record<"an" | "binh" | "chi", string>;
const owner: Principal = { personId: null, workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] };
const names = (list: { name: string }[]) => list.map((item) => item.name);
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );

beforeAll(async () => {
  await migrateTestDb();
  for (const key of ["an", "binh", "chi"] as const) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active" })
      .returning();
    ids[key] = row.id;
  }
});

describe("cleanCompetencyNames", () => {
  it("capitalises every word, single-spaces and keeps one of each, accents and case aside", () => {
    expect(cleanCompetencyNames("skill", ["  problem   solving ", "Problem Solving", "", "thuyết trình", "thuyet trinh", "SEO", "ui/ux"]).map((row) => row.name)).toEqual(["Problem Solving", "Thuyết Trình", "SEO", "Ui/Ux"]);
  });
});

describe("setPersonCompetencies", () => {
  it("keeps a person's two lists and adds new names to the catalogue", async () => {
    // Typed in lower case: stored capitalised, nobody is asked to retype it.
    const { before, after } = await setPersonCompetencies(ids.an, { profession: ["social media", "video production"], skill: ["problem solving"] }, ids.an);
    expect(before).toEqual({ profession: [], skill: [] });
    expect(after).toEqual({ profession: ["Social Media", "Video Production"], skill: ["Problem Solving"] });
    const held = await competenciesOf(ids.an);
    expect(names(held.profession)).toEqual(["Social Media", "Video Production"]);
    expect(names(held.skill)).toEqual(["Problem Solving"]);
  });

  it("reuses an entry under any spelling, and keeps the two kinds apart", async () => {
    // Bình types it his own way: it is the entry An made, under the name it already has.
    await setPersonCompetencies(ids.binh, { profession: ["social  media"], skill: ["Social Media", "PROBLEM SOLVING"] }, ids.binh);
    const held = await competenciesOf(ids.binh);
    expect(names(held.profession)).toEqual(["Social Media"]);
    expect(names(held.skill)).toEqual(["Problem Solving", "Social Media"]);
    const catalogue = await listCompetencies();
    // "Social Media" exists once as a field and once as a skill; nothing was doubled.
    expect(catalogue.map((row) => `${row.kind}:${row.name}`)).toEqual(["profession:Social Media", "profession:Video Production", "skill:Problem Solving", "skill:Social Media"]);
    expect((await competenciesOf(ids.an)).profession[0].id).toBe(held.profession[0].id);
  });

  it("replaces the lists: what is left out is dropped from the person, not from the catalogue", async () => {
    const { before, after } = await setPersonCompetencies(ids.an, { profession: ["Video Production"], skill: [] }, ids.chi);
    expect(before).toEqual({ profession: ["Social Media", "Video Production"], skill: ["Problem Solving"] });
    expect(after).toEqual({ profession: ["Video Production"], skill: [] });
    expect(names((await competenciesOf(ids.an)).skill)).toEqual([]);
    expect(names((await competencyChoices()).skill)).toEqual(["Problem Solving", "Social Media"]);
    // Somebody else's list is untouched.
    expect(names((await competenciesOf(ids.binh)).skill)).toEqual(["Problem Solving", "Social Media"]);
  });

  it("refuses a list that is too long, a name that is too long and a person who is not there", async () => {
    expect(await fails(setPersonCompetencies(ids.chi, { profession: [], skill: Array.from({ length: 31 }, (_, index) => `Skill ${index}`) }, ids.chi))).toBe("competencies_too_many");
    expect(await fails(setPersonCompetencies(ids.chi, { profession: ["x".repeat(61)], skill: [] }, ids.chi))).toBe("competency_name_too_long");
    expect(await fails(setPersonCompetencies("00000000-0000-4000-8000-000000000000", { profession: ["Design"], skill: [] }, ids.chi))).toBe("person_not_found");
    // Nothing of the refused writes reached the catalogue.
    expect((await listCompetencies()).some((row) => row.name === "Design" || row.name.startsWith("Skill "))).toBe(false);
  });
});

describe("the directory", () => {
  it("finds the people who hold a professional field or a skill", async () => {
    const choices = await competencyChoices();
    const socialMedia = choices.profession.find((item) => item.name === "Social Media")!;
    const problemSolving = choices.skill.find((item) => item.name === "Problem Solving")!;
    const found = async (competencyId: string) => (await listPeople(owner, { competencyId })).rows.map((row) => row.fullName);
    expect(await found(socialMedia.id)).toEqual(["binh"]);
    expect(await found(problemSolving.id)).toEqual(["binh"]);
    const videoProduction = choices.profession.find((item) => item.name === "Video Production")!;
    expect(await found(videoProduction.id)).toEqual(["an"]);
    expect((await listPeople(owner, { competencyId: videoProduction.id })).total).toBe(1);
  });
});

describe("the catalogue, for HR", () => {
  const entry = async (kind: "profession" | "skill", name: string) => (await listCompetencyCatalogue()).find((row) => row.kind === kind && row.name === name);

  it("lists every entry of both kinds with the number of people who hold it", async () => {
    expect((await listCompetencyCatalogue()).map((row) => `${row.kind}:${row.name}:${row.holders}`)).toEqual(["profession:Social Media:1", "profession:Video Production:1", "skill:Problem Solving:1", "skill:Social Media:1"]);
  });

  it("adds an entry capitalised, and refuses one the catalogue already has", async () => {
    expect(await addCompetency({ kind: "skill", name: "  team  work " }, ids.chi)).toMatchObject({ kind: "skill", name: "Team Work" });
    expect(await fails(addCompetency({ kind: "skill", name: "TEAM WORK" }, ids.chi))).toBe("competency_exists");
    expect(await fails(addCompetency({ kind: "skill", name: "   " }, ids.chi))).toBe("competency_name_empty");
  });

  it("corrects a misspelt name where it stands: everybody who holds it sees the new name", async () => {
    await setPersonCompetencies(ids.chi, { profession: [], skill: ["comunication"] }, ids.chi);
    const typo = (await entry("skill", "Comunication"))!;
    const { before, after, merged } = await updateCompetency(typo.id, { name: "communication", kind: "skill" });
    expect({ before: before.name, after: after.name, merged }).toEqual({ before: "Comunication", after: "Communication", merged: false });
    expect(after.id).toBe(typo.id);
    expect(names((await competenciesOf(ids.chi)).skill)).toEqual(["Communication"]);
  });

  it("merges a corrected entry into the one the catalogue already has", async () => {
    // Chi holds the misspelt entry, Bình the right one, An both.
    await setPersonCompetencies(ids.chi, { profession: [], skill: ["Communication", "Problm Solving"] }, ids.chi);
    await setPersonCompetencies(ids.an, { profession: ["Video Production"], skill: ["Problm Solving", "Problem Solving"] }, ids.an);
    const typo = (await entry("skill", "Problm Solving"))!;
    const right = (await entry("skill", "Problem Solving"))!;
    expect(typo.holders).toBe(2);

    const { after, merged } = await updateCompetency(typo.id, { name: "problem solving", kind: "skill" });
    expect(merged).toBe(true);
    expect(after.id).toBe(right.id);
    expect(await entry("skill", "Problm Solving")).toBeUndefined();
    // An held both and holds it once; Chi came over; Bình is where he was.
    expect((await entry("skill", "Problem Solving"))!.holders).toBe(3);
    expect(names((await competenciesOf(ids.an)).skill)).toEqual(["Problem Solving"]);
    expect(names((await competenciesOf(ids.chi)).skill)).toEqual(["Communication", "Problem Solving"]);
  });

  it("moves an entry to the other kind, merging there too", async () => {
    // "Social Media" was typed as a skill by Bình; it is a professional field, which he already holds.
    const stray = (await entry("skill", "Social Media"))!;
    const { merged } = await updateCompetency(stray.id, { name: "Social Media", kind: "profession" });
    expect(merged).toBe(true);
    const held = await competenciesOf(ids.binh);
    expect(names(held.profession)).toEqual(["Social Media"]);
    expect(names(held.skill)).toEqual(["Problem Solving"]);
    // One nobody else has under the other kind simply moves.
    const teamWork = (await entry("skill", "Team Work"))!;
    expect((await updateCompetency(teamWork.id, { name: "Team Work", kind: "profession" })).merged).toBe(false);
    expect(await entry("profession", "Team Work")).toMatchObject({ id: teamWork.id });
  });

  it("removes an entry from the catalogue and from everybody who held it", async () => {
    const communication = (await entry("skill", "Communication"))!;
    expect(await deleteCompetency(communication.id)).toMatchObject({ before: { name: "Communication" }, holders: 1 });
    expect(names((await competenciesOf(ids.chi)).skill)).toEqual(["Problem Solving"]);
    expect(await fails(deleteCompetency(communication.id))).toBe("competency_not_found");
    expect(await fails(updateCompetency(communication.id, { name: "X", kind: "skill" }))).toBe("competency_not_found");
  });
});
