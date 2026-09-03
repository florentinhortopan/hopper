import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { nanoid } from "nanoid";
import { PATHS, REPO_ROOT } from "./config.js";
import {
  applyImageConditioning,
  pickIpAdapterApplyClass,
  primaryRefPatchKey,
  type PromptGraph,
} from "./comfyConditioning.js";
import {
  comfyHealth,
  comfyImageRef,
  comfyVideoRef,
  downloadOutput,
  getObjectInfo,
  hashWorkflow,
  isVideoFilename,
  listJobOutputs,
  newClientId,
  queuePrompt,
  resolveComfyTarget,
  uploadImage,
  uploadVideo,
  waitForJob,
  type ComfyTarget,
} from "./comfyClient.js";
import { fitVideoToSize, resolveStillPng, stillCacheKey } from "./mediaRefs.js";
import { listLibrary, libraryAbsolutePath } from "./store.js";
import type { VideoPipeline } from "./promptPack.js";

/** MiniMax H3 R2V combo ratios (no native 4:5 — Feed uses adaptive after talent fit). */
function minimaxRatioForAspect(
  aspect: unknown,
  opts?: { talentFitted?: boolean; fallbackRatio?: unknown },
): string {
  const a = String(aspect || "");
  // Prefer native enum values when available
  if (a === "1:1" || a === "16:9" || a === "9:16") return a;
  // No 4:5 in MiniMax — follow pre-fitted talent frame when possible
  if (a === "4:5") return opts?.talentFitted ? "adaptive" : "3:4";
  const allowed = new Set([
    "adaptive",
    "16:9",
    "4:3",
    "1:1",
    "3:4",
    "9:16",
    "21:9",
  ]);
  if (
    typeof opts?.fallbackRatio === "string" &&
    allowed.has(opts.fallbackRatio)
  ) {
    return opts.fallbackRatio;
  }
  return opts?.talentFitted ? "adaptive" : "9:16";
}

function genSizeFromPatches(patches: Record<string, unknown>): {
  width: number;
  height: number;
} | null {
  const width = Number(patches.width);
  const height = Number(patches.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

export type ComfyJobRequest = {
  workflowId: string;
  modelProfileId: string;
  cellId: string;
  knob: "hands" | "attire" | "background" | "prop";
  patches: Record<string, unknown>;
  /** Live queue UI — Comfy Cloud status has no %; we emit soft progress + status. */
  onProgress?: (progress: number, message: string) => void;
  /** Stop waiting / cancel Comfy when aborted */
  signal?: AbortSignal;
  /** Fired when a prompt_id is queued (for Stop → Comfy cancel). */
  onPromptId?: (promptId: string) => void;
};

function waitOpts(req: ComfyJobRequest, timeoutMs = 900_000) {
  return {
    timeoutMs,
    signal: req.signal,
    onTick: (tick: {
      status: string;
      softProgress: number;
    }) => {
      if (!req.onProgress) return;
      req.onProgress(
        tick.softProgress,
        `Comfy ${tick.status.replace(/_/g, " ")}`,
      );
    },
  };
}

function notePrompt(req: ComfyJobRequest, promptId: string) {
  req.onPromptId?.(promptId);
}

type PatchMap = {
  profileId: string;
  workflowFile: string;
  patches: Record<string, { nodeId: string; input: string; type?: string }>;
};

function workflowsDir() {
  return process.env.COMFY_WORKFLOWS_DIR
    ? path.resolve(REPO_ROOT, process.env.COMFY_WORKFLOWS_DIR)
    : path.join(REPO_ROOT, "comfy/workflows");
}

async function loadWorkflowPair(workflowId: string, modelProfileId: string) {
  const dir = path.join(workflowsDir(), workflowId);
  const fallback = process.env.COMFY_MODEL_FALLBACK_PROFILE || "sd15";
  // Video partner graphs ship as cloud.api.json
  const tryProfiles = ["cloud", modelProfileId, fallback, "sd15"].filter(
    (v, i, a) => Boolean(v) && a.indexOf(v) === i,
  );

  let lastErr: Error | null = null;
  for (const profile of tryProfiles) {
    const mapPath = path.join(dir, `${profile}.map.json`);
    const apiPath = path.join(dir, `${profile}.api.json`);
    try {
      const map = JSON.parse(await readFile(mapPath, "utf8")) as PatchMap;
      const prompt = JSON.parse(await readFile(apiPath, "utf8")) as PromptGraph;
      return { map, prompt, profileId: profile };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `No workflow graph for ${workflowId} / ${modelProfileId}: ${lastErr?.message}`,
  );
}

function applyPatches(
  prompt: PromptGraph,
  map: PatchMap,
  patches: Record<string, unknown>,
) {
  const next = structuredClone(prompt);
  for (const [key, value] of Object.entries(patches)) {
    const binding = map.patches[key];
    if (!binding || binding.nodeId === "TODO") continue;
    if (value === undefined || value === null) continue;
    // Skip local filesystem paths — only Comfy filenames after upload
    if (
      (key.endsWith("Ref") || key === "productRef" || key === "talentRef") &&
      typeof value === "string" &&
      (value.includes("/") || value.includes("\\")) &&
      !patches[`${key}Comfy`]
    ) {
      continue;
    }
    const node = next[binding.nodeId];
    if (!node) continue;
    if (binding.type === "int") node.inputs[binding.input] = Number(value) | 0;
    else if (binding.type === "number") node.inputs[binding.input] = Number(value);
    else node.inputs[binding.input] = value;
  }
  return next;
}

/**
 * Still → short MP4 for Remotion. Fit the whole plate into the target size
 * (no Ken Burns crop/zoom — that was cutting heads when wrapping missing-size
 * stills). True AI motion is a separate pipeline.
 */
function stillToMp4(
  imagePath: string,
  mp4Path: string,
  width = 1080,
  height = 1920,
  seconds = 5,
) {
  const fps = 24;
  // Fit inside frame + center pad — preserves talent/background composition.
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const res = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-i",
      imagePath,
      "-t",
      String(seconds),
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      mp4Path,
    ],
    { stdio: "pipe" },
  );
  if (res.status !== 0) {
    const fallback = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loop",
        "1",
        "-i",
        imagePath,
        "-t",
        String(seconds),
        "-vf",
        `scale=${width}:${height}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(fps),
        mp4Path,
      ],
      { stdio: "pipe" },
    );
    if (fallback.status !== 0) {
      throw new Error(
        `ffmpeg still→mp4 failed: ${res.stderr?.toString() || res.status}`,
      );
    }
  }
}

async function resolveLocalRefPath(relOrAbs: string): Promise<string | null> {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  const fromData = path.join(PATHS.data, relOrAbs);
  try {
    await readFile(fromData);
    return fromData;
  } catch {
    /* try as repo-relative */
  }
  const fromRepo = path.join(REPO_ROOT, relOrAbs);
  try {
    await readFile(fromRepo);
    return fromRepo;
  } catch {
    return null;
  }
}

/**
 * Extract still + upload primary (and secondary) refs. Mutates semantic patches
 * with *Comfy filename fields and conditioning metadata.
 */
async function prepareAndUploadRefs(
  target: ComfyTarget,
  knob: ComfyJobRequest["knob"],
  semantic: Record<string, unknown>,
): Promise<{
  primaryComfyImage: string | null;
  uploaded: Record<string, string>;
}> {
  const uploaded: Record<string, string> = {};
  const primaryKey = primaryRefPatchKey(knob);

  // Prefer talent for face-lock knobs; product for hands — also upload the other as secondary
  const keys: Array<"talentRef" | "productRef" | "wardrobeRef" | "backgroundRef"> = [
    primaryKey,
    "talentRef",
    "productRef",
    "wardrobeRef",
    "backgroundRef",
  ];
  const seen = new Set<string>();

  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const localRel = semantic[key];
    if (typeof localRel !== "string" || !localRel) continue;

    const abs = await resolveLocalRefPath(localRel);
    if (!abs) continue;

    const stillKey = stillCacheKey(key, String(semantic.promptHash || "x"), abs);
    const still = await resolveStillPng(abs, stillKey);
    if (!still) continue;

    try {
      const up = await uploadImage(target, still, {
        subfolder: "attatta",
        overwrite: true,
      });
      const ref = comfyImageRef(up);
      uploaded[key] = ref;
      semantic[`${key}Comfy`] = ref;
      semantic[`${key}Still`] = still;
    } catch (err) {
      semantic[`${key}UploadError`] =
        err instanceof Error ? err.message : String(err);
    }
  }

  return {
    primaryComfyImage: uploaded[primaryKey] || uploaded.talentRef || uploaded.productRef || null,
    uploaded,
  };
}

async function runStub(req: ComfyJobRequest) {
  const kind =
    req.knob === "attire"
      ? "attire"
      : req.knob === "background"
        ? "background"
        : req.knob === "prop"
          ? "prop"
          : "hands";
  const pool = await listLibrary(kind);
  const fallback = pool[0] ?? (await listLibrary("hands"))[0];
  if (!fallback) {
    throw new Error("No library items for Comfy stub — run pnpm seed");
  }

  const assetId = `stub_${req.knob}_${nanoid(8)}`;
  const outDir = path.join(PATHS.library, "gen", req.knob);
  await mkdir(outDir, { recursive: true });
  const ext = path.extname(fallback.path) || ".mp4";
  const assetPath = path.join(outDir, `${assetId}${ext}`);
  await copyFile(libraryAbsolutePath(fallback), assetPath);

  const lineage = {
    assetId,
    source: "stub",
    workflowId: req.workflowId,
    modelProfileId: req.modelProfileId,
    cellId: req.cellId,
    knob: req.knob,
    language: "en",
    patches: req.patches,
    promptHash: req.patches.promptHash ?? null,
    note: "Stub — set COMFY_MODE=live and a reachable COMFY_BASE_URL for real diffusion",
    createdAt: new Date().toISOString(),
    contractFlags: req.patches.contractFlags ?? {
      touches_face: false,
      touches_voice: false,
    },
  };
  await writeFile(
    path.join(outDir, `${assetId}.lineage.json`),
    JSON.stringify(lineage, null, 2),
  );
  return { assetId, assetPath, lineage };
}

async function resolveLocalMedia(
  relOrAbs: string | null | undefined,
): Promise<string | null> {
  if (!relOrAbs || typeof relOrAbs !== "string") return null;
  return resolveLocalRefPath(relOrAbs);
}

async function runBriaReplaceJob(
  target: ComfyTarget,
  req: ComfyJobRequest,
): Promise<{
  assetId: string;
  assetPath: string;
  lineage: Record<string, unknown>;
}> {
  const { map, prompt, profileId } = await loadWorkflowPair(
    "talent_bg_video_v1",
    "cloud",
  );
  const semantic = { ...req.patches };
  const talentAbs = await resolveLocalMedia(String(semantic.talentRef || ""));
  const bgAbs = await resolveLocalMedia(String(semantic.backgroundRef || ""));
  if (!talentAbs) throw new Error("Bria replace needs a talent video path");
  if (!bgAbs) throw new Error("Bria replace needs a background media path");

  const genSize = genSizeFromPatches(semantic);
  let talentForUpload = talentAbs;
  if (genSize) {
    const fitKey = stillCacheKey(
      "talentFit",
      String(semantic.promptHash || semantic.sizeId || "x"),
      talentAbs,
    );
    const fitted = await fitVideoToSize(
      talentAbs,
      genSize.width,
      genSize.height,
      fitKey,
    );
    talentForUpload = fitted;
    semantic.talentFittedTo = `${genSize.width}x${genSize.height}`;
  }

  const talentUp = await uploadVideo(target, talentForUpload, {
    subfolder: "attatta",
    overwrite: true,
  });
  const talentComfy = comfyVideoRef(talentUp);
  semantic.talentVideo = talentComfy;

  const bgIsVideo = isVideoFilename(bgAbs);
  let patched = applyPatches(prompt, map, {
    seed: semantic.seed,
    talentVideo: talentComfy,
  });

  // Exactly one of background_image | background_video
  const bria = patched["3"];
  if (!bria) throw new Error("Bria workflow missing node 3");
  if (bgIsVideo) {
    const bgUp = await uploadVideo(target, bgAbs, {
      subfolder: "attatta",
      overwrite: true,
    });
    const bgComfy = comfyVideoRef(bgUp);
    semantic.backgroundVideo = bgComfy;
    if (patched["10"]) patched["10"].inputs.file = bgComfy;
    bria.inputs.background_video = ["10", 0];
    delete bria.inputs.background_image;
    delete patched["8"];
  } else {
    const stillKey = stillCacheKey(
      "backgroundRef",
      String(semantic.promptHash || "x"),
      bgAbs,
    );
    const still = await resolveStillPng(bgAbs, stillKey);
    if (!still) throw new Error("Could not prepare background still for Bria");
    const bgUp = await uploadImage(target, still, {
      subfolder: "attatta",
      overwrite: true,
    });
    const bgComfy = comfyImageRef(bgUp);
    semantic.backgroundImage = bgComfy;
    if (patched["8"]) patched["8"].inputs.image = bgComfy;
    bria.inputs.background_image = ["8", 0];
    delete bria.inputs.background_video;
    delete patched["10"];
  }

  const promptId = await queuePrompt(target, patched, newClientId());
  notePrompt(req, promptId);
  req.onProgress?.(0.05, "Comfy queued (Bria)");
  await waitForJob(target, promptId, waitOpts(req));
  return persistVideoOutput(target, req, {
    promptId,
    patched,
    profileId,
    semantic,
    videoPipeline: "bria_replace",
    uploaded: {
      talentVideo: String(semantic.talentVideo || ""),
      background: String(
        semantic.backgroundVideo || semantic.backgroundImage || "",
      ),
    },
  });
}

async function runMinimaxVariantJob(
  target: ComfyTarget,
  req: ComfyJobRequest,
): Promise<{
  assetId: string;
  assetPath: string;
  lineage: Record<string, unknown>;
}> {
  const { map, prompt, profileId } = await loadWorkflowPair(
    "talent_variant_video_v1",
    "cloud",
  );
  const semantic = { ...req.patches };
  const talentAbs = await resolveLocalMedia(String(semantic.talentRef || ""));
  if (!talentAbs) throw new Error("MiniMax variant needs a talent video path");

  // MiniMax R2V often follows the reference video aspect ("adaptive"). Pre-fit
  // talent to this size's gen dims so 4:5 / 1:1 / 16:9 plates are not stuck
  // at the talent take's 9:16 (e.g. 464×832).
  const genSize = genSizeFromPatches(semantic);
  let talentForUpload = talentAbs;
  let talentFitted = false;
  if (genSize) {
    const fitKey = stillCacheKey(
      "talentFit",
      String(semantic.promptHash || semantic.sizeId || "x"),
      talentAbs,
    );
    talentForUpload = await fitVideoToSize(
      talentAbs,
      genSize.width,
      genSize.height,
      fitKey,
    );
    talentFitted = true;
    semantic.talentFittedTo = `${genSize.width}x${genSize.height}`;
  }

  const talentUp = await uploadVideo(target, talentForUpload, {
    subfolder: "attatta",
    overwrite: true,
  });
  const talentComfy = comfyVideoRef(talentUp);

  const refPaths = Array.isArray(semantic.variantRefPaths)
    ? (semantic.variantRefPaths as string[])
    : ([
        semantic.wardrobeRef,
        semantic.backgroundRef,
        semantic.productRef,
      ].filter((x): x is string => typeof x === "string" && Boolean(x)));

  const imageComfy: string[] = [];
  const seenAbs = new Set<string>();
  for (let i = 0; i < refPaths.length && imageComfy.length < 4; i++) {
    const abs = await resolveLocalMedia(refPaths[i]!);
    if (!abs || seenAbs.has(abs)) continue;
    seenAbs.add(abs);
    const stillKey = stillCacheKey(
      `ref${imageComfy.length + 1}`,
      String(semantic.promptHash || "x"),
      abs,
    );
    const still = await resolveStillPng(abs, stillKey);
    if (!still) continue;
    const up = await uploadImage(target, still, {
      subfolder: "attatta",
      overwrite: true,
    });
    imageComfy.push(comfyImageRef(up));
  }

  // 1:1 / 16:9 / 9:16 → native MiniMax ratios; 4:5 → adaptive after talent fit
  const ratio = minimaxRatioForAspect(semantic.aspect, {
    talentFitted,
    fallbackRatio: semantic.ratio,
  });

  let patched = applyPatches(prompt, map, {
    seed: semantic.seed,
    prompt: semantic.prompt,
    talentVideo: talentComfy,
    resolution: semantic.resolution || "768P",
    ratio,
    duration: Number(semantic.duration || 5),
    refImage1: imageComfy[0],
    refImage2: imageComfy[1],
    refImage3: imageComfy[2],
    refImage4: imageComfy[3],
  });

  const maxim = patched["4"];
  if (!maxim) throw new Error("MiniMax workflow missing node 4");
  maxim.inputs["model.reference_videos.video_1"] = ["20", 0];
  // Wire only connected image slots; drop unused LoadImage nodes
  const imageSlots = [
    ["21", "model.reference_images.image_1"],
    ["22", "model.reference_images.image_2"],
    ["23", "model.reference_images.image_3"],
    ["24", "model.reference_images.image_4"],
  ] as const;
  for (let i = 0; i < imageSlots.length; i++) {
    const [nodeId, inputName] = imageSlots[i]!;
    if (imageComfy[i]) {
      if (patched[nodeId]) patched[nodeId].inputs.image = imageComfy[i];
      maxim.inputs[inputName] = [nodeId, 0];
    } else {
      delete maxim.inputs[inputName];
      delete patched[nodeId];
    }
  }

  const promptId = await queuePrompt(target, patched, newClientId());
  notePrompt(req, promptId);
  req.onProgress?.(0.05, "Comfy queued (MiniMax)");
  await waitForJob(target, promptId, waitOpts(req));
  return persistVideoOutput(target, req, {
    promptId,
    patched,
    profileId,
    semantic: {
      ...semantic,
      ratio,
      talentVideo: talentComfy,
      refImages: imageComfy,
    },
    videoPipeline: "minimax_h3_r2v",
    uploaded: {
      talentVideo: talentComfy,
      refImages: imageComfy.join(","),
    },
  });
}

async function persistVideoOutput(
  target: ComfyTarget,
  req: ComfyJobRequest,
  opts: {
    promptId: string;
    patched: PromptGraph;
    profileId: string;
    semantic: Record<string, unknown>;
    videoPipeline: VideoPipeline;
    uploaded: Record<string, string>;
  },
): Promise<{
  assetId: string;
  assetPath: string;
  lineage: Record<string, unknown>;
}> {
  const outputs = await listJobOutputs(target, opts.promptId);
  if (!outputs.length) {
    throw new Error(`Comfy job ${opts.promptId} completed with no outputs`);
  }
  const primary =
    outputs.find((o) => isVideoFilename(o.filename)) || outputs[0]!;
  const assetId = `comfy_${req.knob}_${nanoid(8)}`;
  const outDir = path.join(PATHS.library, "gen", req.knob);
  await mkdir(outDir, { recursive: true });
  const ext = path.extname(primary.filename) || ".mp4";
  const assetPath = path.join(outDir, `${assetId}${ext}`);
  await downloadOutput(target, primary, assetPath);

  // Safety net: MiniMax/Bria may still emit talent-aspect pixels. Normalize this
  // size's plate to the requested gen dims (do not leave a 9:16 file in a 4:5 slot).
  const genSize = genSizeFromPatches(req.patches);
  if (genSize && isVideoFilename(assetPath)) {
    const normKey = stillCacheKey(
      "outFit",
      String(req.patches.promptHash || req.cellId || assetId),
      assetPath,
    );
    const fitted = await fitVideoToSize(
      assetPath,
      genSize.width,
      genSize.height,
      normKey,
    );
    if (fitted !== assetPath) {
      await copyFile(fitted, assetPath);
    }
  }

  const lineage = {
    assetId,
    source: "comfyui",
    promptId: opts.promptId,
    workflowId: req.workflowId,
    modelProfileId: opts.profileId,
    workflowHash: `sha256:${hashWorkflow(opts.patched)}`,
    cellId: req.cellId,
    knob: req.knob,
    videoPipeline: opts.videoPipeline,
    comfyBaseUrl: target.baseUrl,
    cloud: target.isCloud,
    language: "en",
    conditioningMode: "video",
    uploadedRefs: opts.uploaded,
    promptHash: opts.semantic.promptHash ?? null,
    patches: opts.semantic,
    output: primary,
    createdAt: new Date().toISOString(),
    contractFlags: req.patches.contractFlags ?? {
      touches_face: false,
      touches_voice: false,
    },
  };
  await writeFile(
    path.join(outDir, `${assetId}.lineage.json`),
    JSON.stringify(lineage, null, 2),
  );
  return { assetId, assetPath, lineage };
}

/**
 * Live ComfyUI generation (local :8188 or Comfy Cloud).
 * Falls back to stub when COMFY_MODE=stub or server unreachable (unless COMFY_MODE=live).
 */
export async function runComfyJob(req: ComfyJobRequest): Promise<{
  assetId: string;
  assetPath: string;
  lineage: Record<string, unknown>;
}> {
  const mode = (process.env.COMFY_MODE || "auto").toLowerCase();
  const target = resolveComfyTarget();

  if (mode === "stub") return runStub(req);

  const health = await comfyHealth(target);
  if (!health.ok) {
    if (mode === "live") {
      throw new Error(
        `ComfyUI unreachable (${target.baseUrl}): ${JSON.stringify(health.detail)}`,
      );
    }
    return runStub(req);
  }

  const pipeline = String(req.patches.videoPipeline || "still") as VideoPipeline;
  if (pipeline === "bria_replace") {
    return runBriaReplaceJob(target, req);
  }
  if (pipeline === "minimax_h3_r2v") {
    return runMinimaxVariantJob(target, req);
  }

  const { map, prompt, profileId } = await loadWorkflowPair(
    req.workflowId,
    req.modelProfileId,
  );

  const semantic = { ...req.patches };
  // Never let short wardrobe/BG hints overwrite the full contextual prompt
  // (hints are already folded into positive by buildPromptPack).

  if (req.patches.forceRegen) {
    semantic.seed = (Number(semantic.seed) || 0) + (Date.now() % 10_000);
  }

  const { primaryComfyImage, uploaded } = await prepareAndUploadRefs(
    target,
    req.knob,
    semantic,
  );

  // Never patch denoise onto empty-latent text2img (would wash out the sample)
  const { denoise: _ignoreDenoise, ...patchable } = semantic;
  let patched = applyPatches(prompt, map, patchable);
  let conditioningMode: "ipadapter" | "img2img" | "text_only" = "text_only";

  if (primaryComfyImage) {
    const width = Number(semantic.width || 576);
    const height = Number(semantic.height || 1024);
    const denoise = Number(
      semantic.targetDenoise ?? (req.knob === "hands" ? 0.62 : 0.42),
    );
    const objectInfo = await getObjectInfo(target);
    const ipClass = pickIpAdapterApplyClass(objectInfo);
    const preferIp =
      process.env.COMFY_USE_IPADAPTER !== "0" &&
      Boolean(ipClass) &&
      (req.knob === "attire" || req.knob === "background");

    const conditioned = applyImageConditioning(patched, {
      imageRef: primaryComfyImage,
      denoise,
      width,
      height,
      preferIpAdapter: preferIp,
      ipAdapterApplyClass: ipClass,
      ipAdapterWeight: Number(semantic.ipAdapterWeight ?? 0.75),
    });
    patched = conditioned.prompt;
    conditioningMode = conditioned.mode;
    semantic.conditioningMode = conditioningMode;
    semantic.conditioningImage = primaryComfyImage;
    semantic.denoise = conditioned.denoise ?? denoise;
  }

  const clientId = newClientId();
  let promptId: string;

  const runImg2ImgFallback = async (reason: unknown) => {
    const width = Number(semantic.width || 576);
    const height = Number(semantic.height || 1024);
    const denoise = Number(
      semantic.targetDenoise ?? (req.knob === "hands" ? 0.62 : 0.42),
    );
    const fallback = applyImageConditioning(applyPatches(prompt, map, patchable), {
      imageRef: primaryComfyImage!,
      denoise,
      width,
      height,
      preferIpAdapter: false,
    });
    patched = fallback.prompt;
    conditioningMode = fallback.mode;
    semantic.conditioningMode = conditioningMode;
    semantic.denoise = denoise;
    semantic.ipAdapterFallback =
      reason instanceof Error ? reason.message : String(reason);
    return queuePrompt(target, patched, newClientId());
  };

  try {
    promptId = await queuePrompt(target, patched, clientId);
  } catch (err) {
    // If IPAdapter graph rejected at /prompt, retry with img2img
    if (conditioningMode === "ipadapter" && primaryComfyImage) {
      promptId = await runImg2ImgFallback(err);
    } else {
      throw err;
    }
  }
  notePrompt(req, promptId);

  try {
    req.onProgress?.(0.05, "Comfy queued");
    await waitForJob(target, promptId, waitOpts(req));
  } catch (err) {
    // Cloud may accept the prompt then fail validation asynchronously
    const msg = err instanceof Error ? err.message : String(err);
    if (
      conditioningMode === "ipadapter" &&
      primaryComfyImage &&
      /IPAdapter|prompt_outputs_failed_validation|required_input_missing/i.test(msg)
    ) {
      promptId = await runImg2ImgFallback(err);
      notePrompt(req, promptId);
      req.onProgress?.(0.08, "Comfy retry (img2img)");
      await waitForJob(target, promptId, waitOpts(req));
    } else {
      throw err;
    }
  }
  const outputs = await listJobOutputs(target, promptId);
  if (!outputs.length) {
    throw new Error(`Comfy job ${promptId} completed with no outputs`);
  }

  const primary =
    outputs.find((o) => isVideoFilename(o.filename)) || outputs[0]!;
  const assetId = `comfy_${req.knob}_${nanoid(8)}`;
  const outDir = path.join(PATHS.library, "gen", req.knob);
  await mkdir(outDir, { recursive: true });

  const ext = path.extname(primary.filename) || ".png";
  const stillPath = path.join(outDir, `${assetId}${ext}`);
  await downloadOutput(target, primary, stillPath);

  let assetPath = stillPath;
  const alreadyVideo = isVideoFilename(stillPath);
  const wrapMp4 =
    !alreadyVideo &&
    (req.knob === "hands" ||
      process.env.COMFY_WRAP_MP4 === "1" ||
      Boolean(semantic.wrapMp4));
  if (wrapMp4) {
    const mp4Path = path.join(outDir, `${assetId}.mp4`);
    const outW = Number(semantic.outputWidth || semantic.width || 1080);
    const outH = Number(semantic.outputHeight || semantic.height || 1920);
    try {
      stillToMp4(stillPath, mp4Path, outW, outH);
      assetPath = mp4Path;
    } catch {
      /* keep still if ffmpeg unavailable */
    }
  }

  const lineage = {
    assetId,
    source: "comfyui",
    promptId,
    workflowId: req.workflowId,
    modelProfileId: profileId,
    workflowHash: `sha256:${hashWorkflow(patched)}`,
    cellId: req.cellId,
    knob: req.knob,
    comfyBaseUrl: target.baseUrl,
    cloud: target.isCloud,
    language: "en",
    conditioningMode,
    uploadedRefs: uploaded,
    promptHash: semantic.promptHash ?? null,
    patches: semantic,
    output: primary,
    createdAt: new Date().toISOString(),
    contractFlags: req.patches.contractFlags ?? {
      touches_face: false,
      touches_voice: false,
    },
  };

  await writeFile(
    path.join(outDir, `${assetId}.lineage.json`),
    JSON.stringify(lineage, null, 2),
  );

  return { assetId, assetPath, lineage };
}

export async function getComfyStatus() {
  const { getComfyCapabilities } = await import("./comfyCapabilities.js");
  const caps = await getComfyCapabilities();
  return {
    mode: caps.mode,
    baseUrl: caps.baseUrl,
    isCloud: caps.isCloud,
    hasApiKey: caps.hasApiKey,
    modelProfile: caps.defaultModelProfile,
    health: caps.health,
    pipeline: caps.pipeline,
    readyWorkflows: caps.workflows
      .filter((w) => w.profiles.some((p) => p.ready))
      .map((w) => w.workflowId),
  };
}
