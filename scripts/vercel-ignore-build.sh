#!/bin/sh
# Vercel's "Ignored Build Step" (vercel.json → ignoreCommand): exit 0 skips the build, exit 1 builds.
#
# Skipped: a push whose changes since the last deployed commit are only docs, Markdown or CI
# workflows. Built: everything else — including a redeploy, which is the same commit as the one
# deployed and so shows no change at all; the runbooks redeploy after changing an environment
# variable (MAINTENANCE_MODE, AI_AGENT_AUDIENCE…), and that must never be skipped. Also built
# when there is no previous deployment or its commit is not in this clone.
prev="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$prev" ] || exit 1
[ "$prev" != "$VERCEL_GIT_COMMIT_SHA" ] || exit 1
git cat-file -e "$prev^{commit}" 2>/dev/null || exit 1
git diff --quiet "$prev" HEAD -- . ':!docs' ':!*.md' ':!.github' && exit 0
exit 1
