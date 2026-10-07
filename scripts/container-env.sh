# Points this shell at the demo database in the local Postgres container (`pnpm db:up`), never at
# the database `.env.local` names. Source it, then run anything that reads POSTGRES_URL:
#
#   source scripts/container-env.sh
#   pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo ...     # see scripts/seed-demo-all.sh
#   pnpm next dev --port 3124                                     # a server on the demo data
#
# dotenv never overrides a variable that is already set, so what is exported here wins over
# `.env.local` and everything else comes from it as usual.
#
# The key ring is the demo database's own and is deliberately public: the data it protects is the
# fake demo company, and a key written here can be found again by anyone who rebuilds it. It must
# never be used for real data — production's keys live in Vercel. (The container's old `postgres`
# database was encrypted with a key nobody kept, `local1`; this one replaces it.)

export DEMO_DATABASE="${DEMO_DATABASE:-suzu_local}"
export POSTGRES_URL="postgresql://postgres:postgres@127.0.0.1:55322/${DEMO_DATABASE}"
export POSTGRES_URL_NON_POOLING="$POSTGRES_URL"
export DATA_ENCRYPTION_KEYS="demo1:ZGVtby1jb250YWluZXIta2V5LW5vdC1hLXNlY3JldCE="
export DATA_BLIND_INDEX_KEY="ZGVtby1jb250YWluZXItaW5kZXgtbm90LXNlY3JldCE="
# The server the job-driven seeds call (payroll runs, ops, bonus): start it on this port.
export RECOMPUTE_URL="http://localhost:3124"
# Generous model budgets for evaluation runs against the demo data.
export AI_DAILY_BUDGET_USD_EVERYONE=50 AI_DAILY_BUDGET_USD_LEADS=50 AI_DAILY_BUDGET_USD_OFFICE=50 AI_MONTHLY_BUDGET_USD=200
# Files go to a local S3-compatible server, never to the R2 bucket: s3rver keeps them in
# ~/.suzu-demo/s3 and takes any signature with its fixed credentials. Start it with:
#   npx -y s3rver@3 --directory ~/.suzu-demo/s3 --port 4569 --address 127.0.0.1 --configure-bucket suzu-private
export R2_ENDPOINT="http://127.0.0.1:4569" R2_ACCESS_KEY_ID="S3RVER" R2_SECRET_ACCESS_KEY="S3RVER" STORAGE_BUCKET="suzu-private"
