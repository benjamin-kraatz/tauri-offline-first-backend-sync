const TAURI_TRUSTED_ORIGINS = [
  "https://tauri.localhost",
  "http://tauri.localhost",
  "tauri://localhost",
  "https://tauri-local-first-sync-web-benn.sebbenkra.workers.dev",
] as const;

function splitOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getAllowedOrigins(configuredOrigin: string | undefined): string[] {
  return Array.from(new Set([...splitOrigins(configuredOrigin), ...TAURI_TRUSTED_ORIGINS]));
}

export function isAllowedOrigin(origin: string | undefined, configuredOrigin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  return getAllowedOrigins(configuredOrigin).includes(origin);
}
