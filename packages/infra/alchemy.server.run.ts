import alchemy from "alchemy";
import { Worker } from "alchemy/cloudflare";
import { config } from "dotenv";

const mode = process.env.NODE_ENV === "production" ? "production" : "development";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

if (mode === "production") {
  config({ path: "./.env.production", override: true });
  config({ path: "../../apps/web/.env.production", override: true });
  config({ path: "../../apps/server/.env.production", override: true });
}

const app = await alchemy("tauri-local-first-sync");

export const server = await Worker("server", {
  cwd: "../../apps/server",
  entrypoint: "src/index.ts",
  compatibility: "node",
  bindings: {
    DATABASE_URL: alchemy.secret.env.DATABASE_URL!,
    CORS_ORIGIN: alchemy.env.CORS_ORIGIN!,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: alchemy.env.BETTER_AUTH_URL!,
  },
  dev: {
    port: 3000,
  },
});

console.log(`Server -> ${server.url}`);

await app.finalize();
