import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "@attatta/shared/paths";
import { fileURLToPath } from "node:url";

/** Minimal .env loader (no dotenv dep) — repo root then cwd */
export function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = resolveRepoRoot(path.join(here, "../../.."));
  for (const file of [path.join(root, ".env"), path.join(process.cwd(), ".env")]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadEnv();
