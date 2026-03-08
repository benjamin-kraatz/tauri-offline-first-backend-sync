import alchemy from "alchemy";
import { Vite, Worker } from "alchemy/cloudflare";
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

function joinOrigins(...originLists: Array<string | undefined>) {
  return Array.from(
    new Set(
      originLists
        .flatMap((value) => value?.split(",") ?? [])
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ).join(",");
}

export const web = await Vite("web", {
  cwd: "../../apps/web",
  assets: "dist",
  bindings: {
    VITE_SERVER_URL: alchemy.env.VITE_SERVER_URL!,
  },
});

export const server = await Worker("server", {
  cwd: "../../apps/server",
  entrypoint: "src/index.ts",
  compatibility: "node",
  bindings: {
    DATABASE_URL: alchemy.secret.env.DATABASE_URL!,
    CORS_ORIGIN: joinOrigins(alchemy.env.CORS_ORIGIN, web.url),
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: alchemy.env.BETTER_AUTH_URL!,
    POWERSYNC_ENDPOINT: alchemy.env.POWERSYNC_ENDPOINT!,
    POWERSYNC_DEVELOPMENT_TOKEN: alchemy.secret.env.POWERSYNC_DEVELOPMENT_TOKEN!,
  },
  dev: {
    port: 3000,
  },
});

console.log(`Web    -> ${web.url}`);
console.log(`Server -> ${server.url}`);

await app.finalize();
