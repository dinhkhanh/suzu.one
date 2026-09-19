import { describe, expect, it } from "vitest";
import { decideSignIn, emailDomain, type PersonAccessState, type SignInIdentity } from "./sign-in-policy";

const allowedDomains = ["suzu.vn", "suzu.group"];
const bootstrapOwnerEmails = ["owner@suzu.vn"];

function decide(identity: Partial<SignInIdentity>, personState: PersonAccessState = "active") {
  return decideSignIn({
    identity: { email: "lan@suzu.group", emailVerified: true, hostedDomain: "suzu.group", ...identity },
    allowedDomains,
    bootstrapOwnerEmails,
    personState,
  });
}

describe("decideSignIn", () => {
  it("allows a provisioned employee from each workspace", () => {
    expect(decide({})).toEqual({ allowed: true, bootstrapOwner: false });
    expect(decide({ email: "ceo@suzu.vn", hostedDomain: "suzu.vn" })).toEqual({ allowed: true, bootstrapOwner: false });
  });

  it("rejects personal Gmail accounts, which carry no hosted-domain claim", () => {
    expect(decide({ email: "lan@gmail.com", hostedDomain: undefined })).toEqual({
      allowed: false,
      reason: "not_a_workspace_account",
    });
  });

  it("rejects other Google Workspace organisations", () => {
    expect(decide({ email: "lan@other.com", hostedDomain: "other.com" })).toEqual({
      allowed: false,
      reason: "domain_not_allowed",
    });
  });

  it("rejects an allowed-looking email whose hosted domain is not allowed", () => {
    expect(decide({ email: "lan@suzu.group", hostedDomain: "evil.com" })).toEqual({
      allowed: false,
      reason: "domain_not_allowed",
    });
  });

  it("rejects an allowed hosted domain with an email on a domain outside the allowlist", () => {
    expect(decide({ email: "lan@alias.example", hostedDomain: "suzu.group" })).toEqual({
      allowed: false,
      reason: "domain_not_allowed",
    });
  });

  it("rejects unverified emails", () => {
    expect(decide({ emailVerified: false })).toEqual({ allowed: false, reason: "email_not_verified" });
  });

  it("rejects allowed-domain accounts with no person record", () => {
    expect(decide({}, "none")).toEqual({ allowed: false, reason: "not_provisioned" });
  });

  it("lets a bootstrap owner in before any person record exists", () => {
    expect(decide({ email: "Owner@Suzu.vn", hostedDomain: "suzu.vn" }, "none")).toEqual({
      allowed: true,
      bootstrapOwner: true,
    });
  });

  it("revokes access for suspended and offboarded people, including bootstrap owners", () => {
    expect(decide({}, "suspended")).toEqual({ allowed: false, reason: "access_revoked" });
    expect(decide({}, "offboarded")).toEqual({ allowed: false, reason: "access_revoked" });
    expect(decide({ email: "owner@suzu.vn", hostedDomain: "suzu.vn" }, "offboarded")).toEqual({
      allowed: false,
      reason: "access_revoked",
    });
  });

  it("allows pre-boarding hires so they can fill in their own data", () => {
    expect(decide({}, "preboarding")).toEqual({ allowed: true, bootstrapOwner: false });
  });

  it("treats domains case-insensitively", () => {
    expect(decide({ email: "Lan@SUZU.Group", hostedDomain: "SUZU.GROUP" })).toEqual({
      allowed: true,
      bootstrapOwner: false,
    });
    expect(emailDomain("a@B.Co")).toBe("b.co");
  });
});
