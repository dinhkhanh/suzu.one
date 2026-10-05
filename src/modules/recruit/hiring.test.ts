// Who may open a hiring request, against a real Postgres (PGlite). One rule, and the bug it
// guards against: the request names its department and team, and a recruiter granted on that
// unit — or a unit above it — reaches it. Asked of `can()` with the units as plain fields, the
// question named no unit at all, so only group- and entity-wide grants ever answered yes.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { getHiringRequestView } from "./hiring";

const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const ids = {} as Record<"szm" | "creative" | "video" | "design" | "requester" | "recruiter" | "hiringRequest", string>;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty SuZu Media", shortName: "SuZu Media" }).returning();
  // Creative ⊃ Video; Design is a sibling of Creative.
  const [creative] = await db().insert(schema.orgUnit).values({ code: "CRE", name: "Creative", kind: "department" }).returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video", parentId: creative.id }).returning();
  const [design] = await db().insert(schema.orgUnit).values({ code: "DES", name: "Design", kind: "department" }).returning();
  Object.assign(ids, { szm: szm.id, creative: creative.id, video: video.id, design: design.id });
  for (const key of ["requester", "recruiter"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, primaryEntityId: szm.id, orgUnitId: video.id, status: "active" }).returning();
    ids[key] = row.id;
  }
  const [request] = await db()
    .insert(schema.hiringRequest)
    .values({ entityId: szm.id, departmentId: creative.id, teamId: video.id, positionTitle: "Video Editor", reason: "Thêm người cho mảng TVC", requestedByPersonId: ids.requester })
    .returning();
  ids.hiringRequest = request.id;
});

const viewerWith = (grants: Principal["grants"]) => ({ principal: principal(ids.recruiter, grants), personId: ids.recruiter });

describe("opening a hiring request", () => {
  it("lets a recruiter granted on the request's team open it", async () => {
    expect(await getHiringRequestView(viewerWith([{ role: "recruiter", scope: { type: "unit", id: ids.video } }]), ids.hiringRequest)).not.toBeNull();
  });

  it("lets a recruiter granted on the department above the team open it", async () => {
    expect(await getHiringRequestView(viewerWith([{ role: "recruiter", scope: { type: "unit", id: ids.creative } }]), ids.hiringRequest)).not.toBeNull();
  });

  it("still refuses a recruiter granted on another department", async () => {
    expect(await getHiringRequestView(viewerWith([{ role: "recruiter", scope: { type: "unit", id: ids.design } }]), ids.hiringRequest)).toBeNull();
  });

  it("and lets the entity's recruiter in, as before", async () => {
    expect(await getHiringRequestView(viewerWith([{ role: "recruiter", scope: { type: "entity", id: ids.szm } }]), ids.hiringRequest)).not.toBeNull();
  });
});
