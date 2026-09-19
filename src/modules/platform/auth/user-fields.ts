// Extra columns on Better Auth's `user` table.
//
// `hostedDomain` must NOT be `input: false`: Better Auth applies that flag to the OAuth provider
// profile too, so the value returned by `mapProfileToUser` would be dropped before the
// `user.create.before` hook and every sign-in would fail with "domain_not_allowed".
// It is instead frozen after creation by the `user.update.before` hook in auth.ts.
export const USER_ADDITIONAL_FIELDS = {
  hostedDomain: { type: "string", required: false },
} as const;
