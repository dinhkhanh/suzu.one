import { parseAdditionalUserInputFromProviderProfile } from "better-auth/db";
import { describe, expect, it } from "vitest";
import { USER_ADDITIONAL_FIELDS } from "./user-fields";

// Regression: with `input: false` on the field, Better Auth silently dropped Google's hosted-domain
// claim, and every sign-in was rejected as "domain_not_allowed". This runs the library's own filter.
describe("hostedDomain user field", () => {
  const profile = { hostedDomain: "suzu.vn" };

  it("survives Better Auth's provider-profile filtering on user creation", () => {
    const options = { user: { additionalFields: USER_ADDITIONAL_FIELDS } };
    expect(parseAdditionalUserInputFromProviderProfile(options, profile, "create")).toEqual(profile);
  });

  it("would be dropped if the field were marked input: false (the original bug)", () => {
    const options = { user: { additionalFields: { hostedDomain: { type: "string", required: false, input: false } } } } as const;
    expect(parseAdditionalUserInputFromProviderProfile(options, profile, "create")).toEqual({});
  });
});
