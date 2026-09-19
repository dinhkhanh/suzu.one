import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { recordAudit } from "../audit/service";
import { accessStateOf, createBootstrapOwner, findPersonByEmail } from "../people/service";
import { decideSignIn, emailDomain } from "./sign-in-policy";

function create() {
  const config = env();

  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: "pg", schema }),

    // Google is the only way in (FR-PLT-01). The OAuth client is "External" because suzu.vn and
    // suzu.group are separate Workspace organisations, so domain enforcement is ours (FR-PLT-03).
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        // Require a verified hosted-domain claim: personal Gmail accounts are rejected here.
        hd: "*",
        prompt: "select_account",
        mapProfileToUser: (profile) => ({ hostedDomain: profile.hd ?? null }),
      },
    },

    user: {
      additionalFields: {
        hostedDomain: { type: "string", required: false, input: false },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // No cookie cache: every request re-reads the session row, so revocation is immediate (FR-PLT-05).
      cookieCache: { enabled: false },
    },

    onAPIError: { errorURL: "/sign-in" },

    databaseHooks: {
      user: {
        create: {
          // Never store accounts from outside the allowlist.
          before: async (user) => {
            const hostedDomain = typeof user.hostedDomain === "string" ? user.hostedDomain.toLowerCase() : "";
            const allowed = config.allowedWorkspaceDomains;
            if (!allowed.includes(hostedDomain) || !allowed.includes(emailDomain(user.email))) {
              await recordAudit({
                action: "auth.sign_in.rejected",
                actor: { email: user.email },
                summary: "domain_not_allowed",
              });
              throw new APIError("FORBIDDEN", { message: "domain_not_allowed" });
            }
          },
        },
      },
      session: {
        create: {
          // Runs on every sign-in: the account must map to a person who currently has access.
          before: async (session) => {
            const [account] = await db().select().from(schema.user).where(eq(schema.user.id, session.userId)).limit(1);
            if (!account) throw new APIError("UNAUTHORIZED", { message: "unknown_user" });

            const person = await findPersonByEmail(account.email);
            const decision = decideSignIn({
              identity: {
                email: account.email,
                emailVerified: account.emailVerified,
                hostedDomain: account.hostedDomain ?? undefined,
              },
              allowedDomains: config.allowedWorkspaceDomains,
              bootstrapOwnerEmails: config.bootstrapOwnerEmails,
              personState: accessStateOf(person),
            });

            if (!decision.allowed) {
              await recordAudit({
                action: "auth.sign_in.rejected",
                actor: { userId: account.id, personId: person?.id, email: account.email },
                summary: decision.reason,
                request: { ipAddress: session.ipAddress, userAgent: session.userAgent },
              });
              throw new APIError("FORBIDDEN", { message: decision.reason });
            }

            const signedIn = person ?? (await createBootstrapOwner({ email: account.email, name: account.name }));
            await recordAudit({
              action: person ? "auth.sign_in" : "auth.bootstrap_owner_created",
              actor: { userId: account.id, personId: signedIn.id, email: account.email },
              request: { ipAddress: session.ipAddress, userAgent: session.userAgent },
            });
          },
        },
      },
    },

    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof create>;
const globalForAuth = globalThis as unknown as { __suzuAuth?: Auth };

// Lazy for the same reason as `env()`: importing this module must not require runtime secrets.
export function auth(): Auth {
  return (globalForAuth.__suzuAuth ??= create());
}
