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
import { invalidateSessionsOfUser, invalidateSessionTokens } from "./session-cache";
import { decideSignIn, emailDomain } from "./sign-in-policy";
import { USER_ADDITIONAL_FIELDS } from "./user-fields";

/**
 * How long a session lives without being used (FR-PLT-06). The SRS names no figure; three days
 * outlasts a Sunday and a Saturday off — a person who uses the app on working days never signs in
 * again — and ends a session left open on a lost phone or a shared machine by the middle of the
 * week, where the old rolling week kept it for seven. Compensation keeps its own, much shorter
 * window on top (the step-up, `step-up-policy.ts`).
 */
export const IDLE_TIMEOUT_SECONDS = 3 * 24 * 60 * 60;
/** How often a session in use has its expiry pushed forward: one write per person per hour of use at most, and the idle window is exact to the hour. */
export const SESSION_REFRESH_SECONDS = 60 * 60;

// Better Auth only turns an error into a redirect to the sign-in page when it carries a `code`;
// without one the browser is left on a raw JSON response.
function reject(reason: string) {
  return new APIError("FORBIDDEN", { code: reason, message: reason });
}

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

    user: { additionalFields: USER_ADDITIONAL_FIELDS },

    // Counted per address in Postgres before the request gets here (`/api/auth/[...all]/route.ts`,
    // NFR-SEC-03). Better Auth's own limiter counts in each instance's memory — every new Vercel
    // instance starts from zero — and its sign-in rule (three in ten seconds per address) would turn
    // a whole office away on a Monday morning once the count were shared.
    rateLimit: { enabled: false },

    // The idle timeout (FR-PLT-06, NFR-SEC-03): a session nobody uses for IDLE_TIMEOUT_SECONDS ends;
    // one in use is pushed forward at most once an hour.
    session: {
      expiresIn: IDLE_TIMEOUT_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      // No cookie cache: a signed cookie cannot be revoked. The session row is read through the
      // shared cache instead (session-cache.ts), whose entry every writer below drops, so
      // revocation is still immediate (FR-PLT-05).
      cookieCache: { enabled: false },
      // A new session starts with no proof of identity (FR-PLT-06, owner's decision 2026-09-23):
      // signing in does not open the compensation screens — with a live Google session it takes
      // only an account pick — so they always ask for the step-up round trip, however recent the
      // sign-in. Never accepted from a request: only the step-up adapter sets it.
      additionalFields: {
        reauthAt: { type: "date", required: false, input: false },
        // Who the session is looking through (FR-PLT-40). Written by `impersonation.ts` alone.
        impersonatePersonId: { type: "string", required: false, input: false },
        impersonatedAt: { type: "date", required: false, input: false },
      },
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
              throw reject("domain_not_allowed");
            }
          },
        },
        update: {
          // The hosted domain is set once, from Google's verified claim; nobody may change it later.
          before: async (changes) => {
            if (!("hostedDomain" in changes)) return;
            const rest = { ...changes };
            delete rest.hostedDomain;
            return { data: rest };
          },
          // The account travels with every cached session of its holder.
          after: async (account) => {
            if (account?.id) await invalidateSessionsOfUser(account.id);
          },
        },
      },
      session: {
        // Better Auth's own writes: the daily refresh of `expiresAt`, sign-out, revocation.
        update: {
          after: async (session) => {
            if (session?.token) await invalidateSessionTokens([session.token]);
          },
        },
        delete: {
          before: async (session) => {
            if (session?.token) await invalidateSessionTokens([session.token]);
          },
        },
        create: {
          // Runs on every sign-in: the account must map to a person who currently has access.
          before: async (session) => {
            const [account] = await db().select().from(schema.user).where(eq(schema.user.id, session.userId)).limit(1);
            if (!account) throw reject("unknown_user");

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
              throw reject(decision.reason);
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

// Cached per module instance, not on globalThis: a hot reload of this file must rebuild the
// instance so configuration edits take effect. (The database pool in lib/db is the global one.)
let cached: Auth | undefined;

// Lazy for the same reason as `env()`: importing this module must not require runtime secrets.
export function auth(): Auth {
  return (cached ??= create());
}
