import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataPaths, resolveRepoRoot } from "@attatta/shared/paths";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolveRepoRoot(path.join(here, "../../.."));
export const PATHS = dataPaths(REPO_ROOT);
export const PORT = Number(process.env.PORT || 8787);
export const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://127.0.0.1:${PORT}`;
