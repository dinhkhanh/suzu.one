// The submit action's parser, as the form actually calls it: the /feedback page has no page path
// and sends null, which used to fail parsing and blame the message's length for it. Parsing runs
// before the session is read, so an input that passes reaches "unauthenticated" here and one that
// fails stops at "invalid".
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => null, requireUser: async () => null }));

import { submitFeedbackAction } from "./actions";

const message = "Nút lưu không phản hồi";

describe("parsing a feedback submission", () => {
  it("accepts the form from the /feedback page, where there is no page path", async () => {
    expect(await submitFeedbackAction({ category: "bug", message, pagePath: null, screenshotFileId: "" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(await submitFeedbackAction({ category: "idea", message, blocking: "on", pagePath: "/projects/x", screenshotFileId: "" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(await submitFeedbackAction({ category: "praise", message })).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("still refuses a message that is too short, and says which field", async () => {
    expect(await submitFeedbackAction({ category: "bug", message: "hi", pagePath: null, screenshotFileId: "" })).toMatchObject({ ok: false, error: "invalid", fieldErrors: { message: ["too_small"] } });
  });
});
