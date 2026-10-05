// The end-to-end smoke suite (NFR-MNT-04, development plan §4): the seven critical journeys,
// driven through a real browser against the built app and a real Postgres reached through a
// transaction-mode pooler — the path PGlite never exercises.
//
// It runs in CI only (`.github/workflows/ci.yml`, job `e2e`), against a throwaway Postgres service
// container that the job migrates and seeds with the demo company. **Never point it at a real
// database**: it signs people in by writing session rows, and its journeys create leave, lock a
// month and run payroll. `e2e/support/db.ts` refuses any database that is not on this machine.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

export default defineConfig({
  testDir: "e2e",
  // The journeys share one seeded company and some of them change it (a locked month, a run):
  // one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-GB",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  // Phone first (docs/UI.md): the journeys run at the width most people use the app at.
  projects: [{ name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } }],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
