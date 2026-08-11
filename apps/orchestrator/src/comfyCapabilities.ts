import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./config.js";
import { comfyHealth, resolveComfyTarget } from "./comfyClient.js";

export type WorkflowCapability = {
  workflowId: string;
  knobs: string[];
  description: string;
  profiles: {
    profileId: string;
    hasApiGraph: boolean;
    hasMap: boolean;
    ready: boolean;
    patchKeys: string[];
    notes: string;
  }[];
};

export type ComfyCapabilities = {
  mode: string;
  baseUrl: string;
  isCloud: boolean;
  hasApiKey: boolean;
  defaultModelProfile: string;
  fallbackModelProfile: string;
  health: Awaited<ReturnType<typeof comfyHealth>>;
  /** What ATTATTA can actually do today */
  pipeline: {
    stillDiffusion: boolean;
    stillToMp4Wrap: boolean;
    nativeVideoModels: boolean;
    imageUploadToComfy: boolean;
    videoUploadToComfy: boolean;
    faceProtectIpAdapter: boolean;
    feedsRemotionAssemble: boolean;
    /** Library ingredient upload / generate still supported */
    perIngredientPlates: boolean;
    /** Matrix cell Comfy variants (needsGen → sizeAssets.genPath) */
    cellPlateGeneration: boolean;
    /** Alias flag — matrix is the variant list */
    matrixVariantGeneration: boolean;
    perVariantContext: boolean;
    plateHashCache: boolean;
    bgOnlyBriaReplace: boolean;
    combinatorialMinimaxH3: boolean;
  };
  limitations: string[];
  /** Remote Comfy HTTP surface we call */
  remoteEndpoints: {
    local: { method: string; path: string; purpose: string }[];
    cloud: { method: string; path: string; purpose: string }[];
  };
  /** ATTATTA orchestrator endpoints that touch Comfy */
  attattaEndpoints: {
    method: string;
    path: string;
    purpose: string;
    body?: string;
  }[];
  models: unknown;
  workflows: WorkflowCapability[];
};

function workflowsDir() {
  return process.env.COMFY_WORKFLOWS_DIR
    ? path.resolve(REPO_ROOT, process.env.COMFY_WORKFLOWS_DIR)
    : path.join(REPO_ROOT, "comfy/workflows");
}

async function scanWorkflows(): Promise<WorkflowCapability[]> {
  const root = workflowsDir();
  let dirs: string[] = [];
  try {
    dirs = (await readdir(root)).filter((d) => !d.startsWith("."));
  } catch {
    return [];
  }

  const out: WorkflowCapability[] = [];
  for (const workflowId of dirs.sort()) {
    const dir = path.join(root, workflowId);
    let description = "";
    let knobs: string[] = [];
    try {
      const manifest = JSON.parse(
        await readFile(path.join(dir, "manifest.json"), "utf8"),
      ) as {
        description?: string;
        notes?: string;
        label?: string;
        knobs?: string[];
        knob?: string;
      };
      description = manifest.description || manifest.notes || manifest.label || "";
      knobs = manifest.knobs || (manifest.knob ? [manifest.knob] : []);
    } catch {
      /* optional */
    }

    const files = await readdir(dir);
    const profiles = new Set<string>();
    for (const f of files) {
      const m = f.match(/^(.+)\.(api|map)\.json$/);
      if (m) profiles.add(m[1]);
    }

    const profileRows = [];
    for (const profileId of [...profiles].sort()) {
      const hasApiGraph = files.includes(`${profileId}.api.json`);
      const hasMap = files.includes(`${profileId}.map.json`);
      let patchKeys: string[] = [];
      let notes = "";
      if (hasMap) {
        try {
          const map = JSON.parse(
            await readFile(path.join(dir, `${profileId}.map.json`), "utf8"),
          ) as { patches?: Record<string, unknown>; notes?: string };
          patchKeys = Object.keys(map.patches || {});
          notes = map.notes || "";
        } catch {
          /* ignore */
        }
      }
      profileRows.push({
        profileId,
        hasApiGraph,
        hasMap,
        ready: hasApiGraph && hasMap,
        patchKeys,
        notes,
      });
    }

    out.push({ workflowId, knobs, description, profiles: profileRows });
  }
  return out;
}

export async function getComfyCapabilities(): Promise<ComfyCapabilities> {
  const target = resolveComfyTarget();
  const health = await comfyHealth(target);
  const workflows = await scanWorkflows();
  let models: unknown = {};
  try {
    models = JSON.parse(
      await readFile(path.join(REPO_ROOT, "comfy/models.registry.json"), "utf8"),
    );
  } catch {
    models = { error: "models.registry.json missing" };
  }

  const readyWorkflows = workflows.filter((w) => w.profiles.some((p) => p.ready));

  return {
    mode: process.env.COMFY_MODE || "auto",
    baseUrl: target.baseUrl,
    isCloud: target.isCloud,
    hasApiKey: Boolean(target.apiKey),
    defaultModelProfile: process.env.COMFY_MODEL_PROFILE || "sd15",
    fallbackModelProfile: process.env.COMFY_MODEL_FALLBACK_PROFILE || "sd15",
    health,
    pipeline: {
      stillDiffusion: readyWorkflows.length > 0 && health.ok,
      stillToMp4Wrap: true,
      nativeVideoModels: process.env.COMFY_VARIANT_VIDEO !== "0",
      imageUploadToComfy: true,
      videoUploadToComfy: true,
      faceProtectIpAdapter: true,
      feedsRemotionAssemble: true,
      perIngredientPlates: true,
      cellPlateGeneration: true,
      matrixVariantGeneration: true,
      perVariantContext: true,
      plateHashCache: true,
      bgOnlyBriaReplace: true,
      combinatorialMinimaxH3: true,
    },
    limitations: [
      "Matrix cells = variant list. Generate variants → one VIDEO per needsGen cell (default); Assemble → Remotion",
      "BG-only cells → Bria video background replace (talent MP4 + BG image/video). Credits ~per second of talent video",
      "Attire/prop/multi-axis cells → MiniMax H3 R2V with cell-scoped prompt + talent video + ingredient stills",
      "Prompt pack uses only active + rail + this cell’s combo (not whole library). COMFY_VARIANT_VIDEO=0 restores still path",
      "preview/render default skipComfy=true; assemble uses library talent/hands plus cell genPath when present",
      "requireReadyMedia gates assemble on talent (+ hands if pinned); attire/BG/prop may be prompt-only refs",
      "POST /campaigns/:id/generate-variants queues one Comfy job per cell @ primary size; Remotion scales",
      "Library / Ingredients: background plates = scene still (prompt+size, no talent); attire/prop/hands video = MiniMax when talent MP4 present; outputMode image|video",
      "Only profiles with both .api.json + .map.json are runnable; video graphs use cloud.api.json",
      "COMFY_MODE=stub copies library placeholders; auto falls back to stub if unreachable; live hard-fails",
      "Comfy Cloud polls /api/job/:id/status then /api/jobs/:id; local uses /history/:id",
    ],
    remoteEndpoints: {
      local: [
        { method: "GET", path: "/system_stats", purpose: "Health / GPU stats" },
        { method: "POST", path: "/upload/image", purpose: "Upload talent/product still refs" },
        { method: "GET", path: "/object_info", purpose: "Detect IPAdapter / custom nodes" },
        { method: "POST", path: "/prompt", purpose: "Queue workflow API JSON" },
        { method: "GET", path: "/history/{prompt_id}", purpose: "Poll completion + outputs" },
        { method: "GET", path: "/view?filename&subfolder&type", purpose: "Download output file" },
      ],
      cloud: [
        { method: "GET", path: "/api/user", purpose: "Auth / account health" },
        { method: "POST", path: "/api/upload/image", purpose: "Upload talent/product still refs" },
        { method: "GET", path: "/api/object_info", purpose: "Detect IPAdapter / custom nodes" },
        { method: "POST", path: "/api/prompt", purpose: "Queue workflow" },
        { method: "GET", path: "/api/job/{prompt_id}/status", purpose: "Poll job status" },
        { method: "GET", path: "/api/jobs/{prompt_id}", purpose: "Fetch outputs after complete" },
        { method: "GET", path: "/api/view?filename&subfolder&type", purpose: "Download output" },
      ],
    },
    attattaEndpoints: [
      {
        method: "GET",
        path: "/comfy/status",
        purpose: "Short health + mode summary",
      },
      {
        method: "GET",
        path: "/comfy/capabilities",
        purpose: "Full UI design surface: workflows, patches, limits, endpoints",
      },
      {
        method: "POST",
        path: "/comfy/test-generate",
        purpose: "Smoke-test one plate (default hands_product_v1 / sd15)",
        body: "{ prompt?, negative?, workflowId?, modelProfileId?, knob?, seed?, steps? }",
      },
      {
        method: "GET",
        path: "/models",
        purpose: "Model registry profiles for settings UI",
      },
      {
        method: "POST",
        path: "/library/:id/generate",
        purpose: "Canonical: generate / refresh a library ingredient plate via Comfy",
        body: '{ modelProfileId?, sourceTalentId?, campaignId?, outputMode?: "image"|"video" }',
      },
      {
        method: "POST",
        path: "/library/:id/media",
        purpose: "Replace uploaded plate media on a library ingredient",
      },
      {
        method: "GET",
        path: "/campaigns/:id/cells/:cellId/prompt-pack",
        purpose: "English prompt pack for a cell (+ optional ?sizeId=)",
      },
      {
        method: "POST",
        path: "/campaigns/:id/comfy-generate",
        purpose: "Comfy for one cell (scripts); operator UI uses generate-variants",
        body: "{ cellId, sizeId?, force? }",
      },
      {
        method: "POST",
        path: "/campaigns/:id/generate-plates",
        purpose: "Queue Comfy variant stills for needsGen matrix cells",
        body: "{ cellIds?, forceRegen? }",
      },
      {
        method: "POST",
        path: "/campaigns/:id/generate-variants",
        purpose: "Alias of generate-plates — matrix cells as variant list",
        body: "{ cellIds?, forceRegen? }",
      },
      {
        method: "POST",
        path: "/campaigns/:id/preview",
        purpose: "Remotion preview assemble (uses cell genPath when present)",
        body: "{ cellIds?, skipComfy?, forceRegen? }",
      },
      {
        method: "POST",
        path: "/campaigns/:id/render",
        purpose: "Remotion final assemble (uses cell genPath when present)",
        body: "{ cellIds?, skipComfy?, forceRegen? }",
      },
    ],
    models,
    workflows,
  };
}

export async function workflowReady(
  workflowId: string,
  modelProfileId: string,
): Promise<boolean> {
  const caps = await getComfyCapabilities();
  const wf = caps.workflows.find((w) => w.workflowId === workflowId);
  if (!wf) return false;
  const direct = wf.profiles.find((p) => p.profileId === modelProfileId);
  if (direct?.ready) return true;
  const fallback = caps.fallbackModelProfile;
  return Boolean(wf.profiles.find((p) => p.profileId === fallback)?.ready);
}

export async function assertWorkflowsDir() {
  const dir = workflowsDir();
  await stat(dir);
  return dir;
}
