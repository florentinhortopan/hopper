import { existsSync } from "node:fs";
import path from "node:path";

/** Repo root when running from apps/* or packages/* */
export function resolveRepoRoot(from = process.cwd()): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

export function dataPaths(repoRoot: string) {
  const data = path.join(repoRoot, "data");
  const libraries = path.join(data, "libraries");
  /** Active default pack root (post-migrate). Legacy `data/library` is migrated here. */
  const library = path.join(libraries, "default");
  return {
    data,
    libraries,
    imports: path.join(data, "imports"),
    library,
    talent: path.join(library, "talent"),
    hands: path.join(library, "hands"),
    motion: path.join(library, "motion"),
    attire: path.join(library, "attire"),
    background: path.join(library, "background"),
    prop: path.join(library, "prop"),
    theme: path.join(library, "theme"),
    copy: path.join(library, "copy"),
    tokens: path.join(data, "tokens"),
    campaigns: path.join(data, "campaigns"),
    packages: path.join(data, "packages"),
  };
}
