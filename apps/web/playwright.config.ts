import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun run -F @offline-first-backend-sync/infra dev",
      url: "http://localhost:3000",
      cwd: repoRoot,
      env: {
        ...process.env,
        BETTER_AUTH_URL: "http://localhost:3000",
        CORS_ORIGIN: "http://localhost:3001",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "bun run dev:bare -- --host localhost --port 3001",
      url: "http://localhost:3001",
      cwd: appDir,
      env: {
        ...process.env,
        VITE_SERVER_URL: "http://localhost:3000",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
