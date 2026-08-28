import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  MagicWorkflowPackageSchema,
  comfyTemplateFromMagicPackage,
  assemblyRecipeFromMagicPackage,
  isMagicManifestFilename,
  isMagicWorkflowFilename,
  isMagicWorkflowUrlFilename,
  magicOutputSizes,
  MAGIC_COMFY_TEMPLATE,
  MAGIC_ASSEMBLY_RECIPE,
  normalizeComfyTemplate,
  resolveOutputSizes,
  type Brief,
  type Campaign,
  type MagicChecklistSource,
  type MagicWorkflowPackage,
} from "@attatta/shared";
import { getImportSessionFilesDir } from "./libraryImport.js";

export type MagicWorkflowApplyResult = {
  source: MagicChecklistSource;
  package: MagicWorkflowPackage | null;
  detail: string;
  warnings: string[];
};

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__MACOSX" || e.name.startsWith(".")) continue;
        await walk(abs);
      } else if (e.isFile()) {
        out.push(abs);
      }
    }
  }
  await walk(root);
  return out;
}

function looksLikeComfyApiGraph(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const vals = Object.values(obj as Record<string, unknown>);
  if (!vals.length) return false;
  const sample = vals.slice(0, 5);
  return sample.every(
    (v) =>
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      "class_type" in (v as object),
  );
}

export function parseMagicWorkflowJson(
  raw: string,
  label: string,
): { pkg: MagicWorkflowPackage | null; warnings: string[] } {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { pkg: null, warnings: [`${label}: invalid JSON`] };
  }
  if (looksLikeComfyApiGraph(data)) {
    return {
      pkg: null,
      warnings: [
        `${label}: looks like a ComfyUI api.json graph — unsupported in Magic MVP; using AI/preset template`,
      ],
    };
  }
  const parsed = MagicWorkflowPackageSchema.safeParse(data);
  if (!parsed.success) {
    // Allow bare ComfyTemplate-shaped objects
    const loose = MagicWorkflowPackageSchema.safeParse({
      version: 1,
      ...(typeof data === "object" && data ? data : {}),
    });
    if (!loose.success) {
      return {
        pkg: null,
        warnings: [`${label}: not a valid ATTATTA workflow package`],
      };
    }
    return { pkg: loose.data, warnings };
  }
  return { pkg: parsed.data, warnings };
}

/** Block SSRF: HTTPS only, no localhost / private IPs / link-local. */
export function assertSafeWorkflowUrl(urlStr: string): URL {
  let u: URL;
  try {
    u = new URL(urlStr.trim());
  } catch {
    throw new Error("Invalid workflow URL");
  }
  if (u.protocol !== "https:") {
    throw new Error("Workflow URL must be HTTPS");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("169.254.")
  ) {
    throw new Error("Workflow URL host is not allowed");
  }
  return u;
}

export async function fetchMagicWorkflowUrl(
  urlStr: string,
): Promise<{ pkg: MagicWorkflowPackage | null; warnings: string[] }> {
  const u = assertSafeWorkflowUrl(urlStr);
  const res = await fetch(u.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    return {
      pkg: null,
      warnings: [`URL fetch failed: HTTP ${res.status}`],
    };
  }
  const text = await res.text();
  return parseMagicWorkflowJson(text, u.toString());
}

/**
 * Scan an import session's staged files for workflow JSON / URL / manifest.
 * Prefers explicit workflow files over manifest-embedded packages.
 */
export async function detectMagicWorkflowFromImport(
  importId: string,
): Promise<MagicWorkflowApplyResult> {
  const root = getImportSessionFilesDir(importId);
  const warnings: string[] = [];
  let files: string[] = [];
  try {
    await stat(root);
    files = await walkFiles(root);
  } catch {
    return {
      source: "missing",
      package: null,
      detail: "No import files staged",
      warnings,
    };
  }

  const rel = (abs: string) => path.relative(root, abs);

  // 1) workflow.url text file
  for (const abs of files) {
    if (!isMagicWorkflowUrlFilename(rel(abs))) continue;
    const text = (await readFile(abs, "utf8")).trim();
    if (!text) continue;
    try {
      const { pkg, warnings: w } = await fetchMagicWorkflowUrl(text);
      warnings.push(...w);
      if (pkg) {
        return {
          source: "url",
          package: pkg,
          detail: `Fetched workflow from ${text.slice(0, 120)}`,
          warnings,
        };
      }
    } catch (err) {
      warnings.push(
        `workflow.url: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2) *.workflow.json / named workflow files
  for (const abs of files) {
    if (!isMagicWorkflowFilename(rel(abs))) continue;
    const raw = await readFile(abs, "utf8");
    const { pkg, warnings: w } = parseMagicWorkflowJson(raw, rel(abs));
    warnings.push(...w);
    if (pkg) {
      return {
        source: "imported",
        package: pkg,
        detail: `Loaded ${rel(abs)}`,
        warnings,
      };
    }
  }

  // 3) manifest.json / brief.json with workflowUrl or embedded template
  for (const abs of files) {
    if (!isMagicManifestFilename(rel(abs))) continue;
    const raw = await readFile(abs, "utf8");
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      warnings.push(`${rel(abs)}: invalid JSON`);
      continue;
    }
    const url =
      (typeof data.workflowUrl === "string" && data.workflowUrl) ||
      (typeof data["workflow.url"] === "string" && data["workflow.url"]) ||
      (data.workflow &&
      typeof data.workflow === "object" &&
      data.workflow &&
      typeof (data.workflow as { url?: string }).url === "string"
        ? (data.workflow as { url: string }).url
        : null);
    if (url) {
      try {
        const { pkg, warnings: w } = await fetchMagicWorkflowUrl(url);
        warnings.push(...w);
        if (pkg) {
          // Merge brief from manifest if present
          if (data.brief && typeof data.brief === "object") {
            pkg.brief = {
              ...(pkg.brief || {}),
              ...(data.brief as MagicWorkflowPackage["brief"]),
            };
          }
          return {
            source: "url",
            package: pkg,
            detail: `Manifest workflow URL from ${rel(abs)}`,
            warnings,
          };
        }
      } catch (err) {
        warnings.push(
          `${rel(abs)} URL: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const { pkg, warnings: w } = parseMagicWorkflowJson(raw, rel(abs));
    warnings.push(...w);
    if (pkg) {
      return {
        source: "imported",
        package: pkg,
        detail: `Loaded package fields from ${rel(abs)}`,
        warnings,
      };
    }
  }

  return {
    source: "missing",
    package: null,
    detail: "No workflow template in package",
    warnings,
  };
}

export function applyMagicWorkflowToCampaign(
  campaign: Campaign,
  pkg: MagicWorkflowPackage | null,
  source: MagicChecklistSource,
): Campaign {
  const next = { ...campaign };
  if (pkg) {
    next.comfyTemplate = comfyTemplateFromMagicPackage(pkg);
    next.assemblyRecipe = assemblyRecipeFromMagicPackage(pkg);
    if (pkg.celtraTemplateProfileId) {
      next.celtraTemplateProfileId = pkg.celtraTemplateProfileId;
    }
    if (pkg.outputSizeIds?.length) {
      next.outputSizes = resolveOutputSizes(pkg.outputSizeIds);
    } else if (source === "imported" || source === "url") {
      next.outputSizes = magicOutputSizes();
    }
    if (pkg.brief) {
      next.brief = {
        ...next.brief,
        prompt: pkg.brief.prompt ?? next.brief.prompt,
        audience: pkg.brief.audience ?? next.brief.audience,
        offer: pkg.brief.offer ?? next.brief.offer,
        cta: pkg.brief.cta ?? next.brief.cta,
        mustSay: pkg.brief.mustSay ?? next.brief.mustSay,
        mustNot: pkg.brief.mustNot ?? next.brief.mustNot,
      };
    }
  } else if (source === "preset" || source === "missing") {
    next.comfyTemplate = normalizeComfyTemplate(MAGIC_COMFY_TEMPLATE);
    next.assemblyRecipe = {
      ...MAGIC_ASSEMBLY_RECIPE,
      scenes: [...MAGIC_ASSEMBLY_RECIPE.scenes],
    };
    next.outputSizes = magicOutputSizes();
  }
  return next;
}

export function mergeBriefHint(
  brief: Brief,
  hint: MagicWorkflowPackage["brief"] | undefined,
): Brief {
  if (!hint) return brief;
  return {
    prompt: hint.prompt?.trim() || brief.prompt,
    audience: hint.audience?.trim() || brief.audience,
    offer: hint.offer?.trim() || brief.offer,
    cta: hint.cta?.trim() || brief.cta,
    mustSay: hint.mustSay?.length ? hint.mustSay : brief.mustSay,
    mustNot: hint.mustNot?.length ? hint.mustNot : brief.mustNot,
  };
}
