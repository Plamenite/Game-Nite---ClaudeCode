import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Colyseus loads `.env.development` (or `.env.production`) on its own, but
 * not the `.local` file next to it, which is where secrets live on a
 * developer's PC (the Supabase service key, the Agora certificate). Git
 * ignores `.local` files. Load it here, over the committed values.
 */
export function loadLocalEnv(folder: string, nodeEnv = process.env.NODE_ENV || "development"): string | null {
  const file = `${folder.replace(/[\\/]+$/, "")}/.env.${nodeEnv}.local`;
  if (!existsSync(file)) return null;
  dotenv.config({ path: file, override: true, quiet: true });
  return file;
}

// apps/server/, whether running from src/ (development) or dist/ (production).
const serverFolder = fileURLToPath(new URL("..", import.meta.url));
const loaded = loadLocalEnv(serverFolder);
if (loaded) console.info(`✅ ${loaded.split(/[\\/]/).pop()} loaded (local secrets).`);
