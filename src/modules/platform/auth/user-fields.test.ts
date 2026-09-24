import { parseAdditionalUserInputFromProviderProfile, parseUserInput } from "better-auth/db";
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

// The account's preferences are the app's to write (`preference-actions.ts`), through its own
// audited action: a browser talking to Better Auth's update-user endpoint may not set them.
describe("locale and theme user fields", () => {
  const options = { user: { additionalFields: USER_ADDITIONAL_FIELDS } };

  it("are refused when a client sends them to Better Auth", () => {
    expect(() => parseUserInput(options, { name: "Ngọc", locale: "en" }, "update")).toThrow("locale is not allowed to be set");
    expect(() => parseUserInput(options, { name: "Ngọc", theme: "dark" }, "update")).toThrow("theme is not allowed to be set");
  });

  it("leave the hosted-domain claim untouched at sign-in", () => {
    expect(parseAdditionalUserInputFromProviderProfile(options, { hostedDomain: "suzu.vn" }, "create")).toEqual({ hostedDomain: "suzu.vn" });
  });
});
