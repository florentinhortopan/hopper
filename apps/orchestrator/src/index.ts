import "./loadEnv.js"; // side-effect: loads repo .env before other imports use process.env
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import cors from "cors";
import express from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { z } from "zod";
import { sendMediaFile } from "./mediaServe.js";
import {
  BriefSchema,
  CampaignIngredientSetSchema,
  CampaignSchema,
  AssemblyRecipeSchema,
  ComfyTemplateSchema,
  CopySchema,
  INGREDIENT_KINDS,
  IngredientRailSchema,
  LibraryItemPatchSchema,
  LibraryKindSchema,
  MatrixSchema,
  DEFAULT_LIBRARY_ID,
  DEFAULT_OUTPUT_SIZE_IDS,
  ImportSourceSchema,
  OUTPUT_SIZE_CATALOG,
  OutputSizeSchema,
  ReviewEntrySchema,
  SceneSlotSchema,
  DesignTokensSchema,
  ensureSceneTag,
  importTokensFromText,
  normalizeAssemblyRecipe,
  normalizeComfyTemplate,
  resolveMatrixCell,
  resolveOutputSizes,
  sanitizeTokenPackId,
  estimatePlateGenSeconds,
  richerMatrixCell,
  toLiveMatrixCell,
  variantSignature,
  type Campaign,
  type Job,
  type LibraryKind,
  type MatrixCell,
  type ReviewEntry,
  type RetiredMatrixCell,
} from "@attatta/shared";
import { PORT, PUBLIC_BASE, PATHS, REPO_ROOT } from "./config.js";
import { DEFAULT_BRAND_TOKEN_ID } from "./defaultTokens.js";
import {
  ensureMagicCampaign,
  generateMagicCampaign,
  magicPlanSnapshot,
  prepareMagicCampaign,
} from "./magicRun.js";
import {
  applyMagicWorkflowToCampaign,
  fetchMagicWorkflowUrl,
  parseMagicWorkflowJson,
} from "./magicWorkflow.js";
import {
  enqueueBatch,
  enqueueCellJob,
  enqueueMissingSizeVariantBatch,
  enqueueVariantBatch,
  plannedAssets,
  syncCampaignSizeAssets,
} from "./jobs.js";
import {
  attachJobControl,
  cancelCampaignJobs,
  cancelJob,
  finishJobControl,
  isCancelledError,
  setJobComfyPromptId,
} from "./jobControl.js";
import { buildCeltraPackage } from "./packageExport.js";
import { getComfyStatus, runComfyJob } from "./comfyAdapter.js";
import { getComfyCapabilities } from "./comfyCapabilities.js";
import {
  createLibraryIngredient,
  deleteLibraryItem,
  generateIngredientAsset,
  getLibraryItem,
  patchLibraryItem,
  reclaimStaleGenerating,
  repairLibraryKindIndexes,
  replaceLibraryMedia,
} from "./library.js";
import {
  createLibraryPack,
  duplicateLibraryPack,
  getLibraryPack,
  listLibraryPacks,
  updateLibraryPack,
} from "./libraryPacks.js";
import {
  classifyImportSession,
  commitImportSession,
  createImportSession,
  loadImportSession,
  patchImportRows,
  resyncImportSession,
} from "./libraryImport.js";
import {
  browseDropbox,
  browseFrameio,
  browseFrameioProjects,
  connectorStatus,
} from "./importConnectors.js";
import { getLlmStatus } from "./llmClient.js";
import {
  assertComfyPublishAuth,
  listRecentComfyPublishes,
  publishComfyIngredient,
} from "./comfyPublish.js";
import {
  deriveRailFromActivations,
  evaluateCampaignPolicy,
  pruneRailToActive,
  resolveTalentContract,
} from "./policy.js";
import { buildPromptPack } from "./promptPack.js";
import {
  CampaignStoreError,
  deleteCampaign,
  ensureDataDirs,
  getCampaign,
  getJob,
  getReviews,
  listCampaigns,
  listJobs,
  listLibrary,
  listTokenPacks,
  saveCampaign,
  saveReviews,
  saveTokens,
  upsertJob,
} from "./store.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, repoRoot: REPO_ROOT, publicBase: PUBLIC_BASE });
});

app.get("/comfy/status", async (_req, res) => {
  res.json(await getComfyStatus());
});

app.get("/comfy/capabilities", async (_req, res) => {
  try {
    res.json(await getComfyCapabilities());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/comfy/test-generate", async (req, res) => {
  try {
    const prompt = String(
      req.body?.prompt ||
        "hands presenting a smartphone, soft daylight desk, photoreal, vertical 9:16",
    );
    const result = await runComfyJob({
      workflowId: String(req.body?.workflowId || "hands_product_v1"),
      modelProfileId: String(
        req.body?.modelProfileId || process.env.COMFY_MODEL_PROFILE || "sd15",
      ),
      cellId: "test",
      knob: (req.body?.knob as "hands") || "hands",
      patches: {
        prompt,
        negative_prompt: String(
          req.body?.negative || "blurry, deformed hands, watermark",
        ),
        seed: Number(req.body?.seed ?? Date.now() % 1_000_000),
        steps: Number(req.body?.steps ?? 16),
        width: 576,
        height: 1024,
      },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/ingredient-kinds", (_req, res) => {
  res.json(INGREDIENT_KINDS);
});

app.get("/output-sizes", (_req, res) => {
  res.json(OUTPUT_SIZE_CATALOG);
});

app.get("/models", async (_req, res) => {
  try {
    const raw = JSON.parse(
      await readFile(path.join(REPO_ROOT, "comfy/models.registry.json"), "utf8"),
    );
    res.json(raw);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/library", async (req, res) => {
  const libraryId = String(req.query.libraryId || DEFAULT_LIBRARY_ID);
  try {
    await repairLibraryKindIndexes(libraryId);
  } catch {
    /* non-fatal — still return library */
  }
  const parsed = LibraryKindSchema.safeParse(req.query.kind);
  const includeArchived =
    req.query.includeArchived === "1" || req.query.includeArchived === "true";
  res.json(
    await listLibrary(
      parsed.success ? parsed.data : undefined,
      libraryId,
      { includeArchived },
    ),
  );
});

app.get("/libraries", async (_req, res) => {
  try {
    res.json(await listLibraryPacks());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/libraries", async (req, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        id: z.string().optional(),
        version: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json(await createLibraryPack(body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/libraries/:id", async (req, res) => {
  const pack = await getLibraryPack(req.params.id);
  if (!pack) {
    res.status(404).json({ error: "Library pack not found" });
    return;
  }
  res.json(pack);
});

app.patch("/libraries/:id", async (req, res) => {
  try {
    const body = z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    res.json(await updateLibraryPack(req.params.id, body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/libraries/:id/duplicate", async (req, res) => {
  try {
    const body = z
      .object({ name: z.string().optional(), version: z.string().optional() })
      .parse(req.body || {});
    res.status(201).json(await duplicateLibraryPack(req.params.id, body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const uploadMany = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 200 },
});

app.post(
  "/libraries/:id/imports",
  uploadMany.fields([
    { name: "zip", maxCount: 1 },
    { name: "files", maxCount: 200 },
  ]),
  async (req, res) => {
    try {
      const libraryId = req.params.id;
      if (!(await getLibraryPack(libraryId))) {
        res.status(404).json({ error: "Library pack not found" });
        return;
      }
      const autoClassify = String(req.body?.autoClassify ?? "true") !== "false";
      const files = req.files as
        | { zip?: Express.Multer.File[]; files?: Express.Multer.File[] }
        | undefined;

      let source: z.infer<typeof ImportSourceSchema>;
      let zipBuffer: Buffer | undefined;
      let zipFilename: string | undefined;
      let uploadedFilesDir: string | undefined;

      if (files?.zip?.[0]) {
        source = { type: "zip" };
        zipBuffer = files.zip[0].buffer;
        zipFilename = files.zip[0].originalname;
      } else if (files?.files?.length) {
        source = { type: "files" };
        uploadedFilesDir = await mkdtemp(path.join(tmpdir(), "attatta-import-"));
        for (const f of files.files) {
          const dest = path.join(uploadedFilesDir, f.originalname);
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, f.buffer);
        }
      } else if (req.body?.folderPath) {
        source = {
          type: "folder",
          folderPath: String(req.body.folderPath),
        };
      } else if (req.body?.dropboxPath) {
        source = {
          type: "dropbox",
          dropboxPath: String(req.body.dropboxPath),
        };
      } else if (req.body?.frameioFolderId) {
        source = {
          type: "frameio",
          frameioFolderId: String(req.body.frameioFolderId),
          frameioProjectId: req.body.frameioProjectId
            ? String(req.body.frameioProjectId)
            : undefined,
        };
      } else if (req.body?.remoteUrl) {
        source = { type: "https", remoteUrl: String(req.body.remoteUrl) };
      } else if (req.body?.source) {
        source = ImportSourceSchema.parse(
          typeof req.body.source === "string"
            ? JSON.parse(req.body.source)
            : req.body.source,
        );
      } else {
        res.status(400).json({
          error:
            "Provide zip, files[], folderPath, dropboxPath, frameioFolderId, or remoteUrl",
        });
        return;
      }

      const { session, job } = await createImportSession({
        libraryId,
        source,
        autoClassify,
        zipBuffer,
        zipFilename,
        uploadedFilesDir,
      });
      res.status(202).json({ session, job });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

app.get("/imports/connectors/status", (_req, res) => {
  res.json({ ...connectorStatus(), llm: getLlmStatus() });
});

app.get("/imports/connectors/dropbox/browse", async (req, res) => {
  try {
    res.json(await browseDropbox(String(req.query.path || "")));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/imports/connectors/frameio/browse", async (req, res) => {
  try {
    const accountId = req.query.accountId
      ? String(req.query.accountId)
      : undefined;
    if (!accountId) {
      res.json(await browseFrameio());
      return;
    }
    res.json(await browseFrameioProjects(accountId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/imports/:importId", async (req, res) => {
  const session = await loadImportSession(req.params.importId);
  if (!session) {
    res.status(404).json({ error: "Import not found" });
    return;
  }
  res.json(session);
});

app.post("/imports/:importId/classify", async (req, res) => {
  try {
    const session = await classifyImportSession(req.params.importId);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/imports/:importId/resync", async (req, res) => {
  try {
    const { session, job } = await resyncImportSession(req.params.importId);
    res.status(202).json({ session, job });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/imports/:importId/rows", async (req, res) => {
  try {
    const rows = z
      .array(
        z.object({
          id: z.string(),
          suggestedKind: LibraryKindSchema.optional(),
          label: z.string().optional(),
          tags: z.array(z.string()).optional(),
          promptHint: z.string().optional(),
          status: z.enum(["pending", "accepted", "rejected"]).optional(),
        }),
      )
      .parse(req.body?.rows ?? req.body);
    res.json(await patchImportRows(req.params.importId, rows));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/imports/:importId/commit", async (req, res) => {
  try {
    res.json(await commitImportSession(req.params.importId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/library", upload.single("file"), async (req, res) => {
  try {
    const libraryId = String(req.body?.libraryId || DEFAULT_LIBRARY_ID);
    const kindParsed = LibraryKindSchema.safeParse(String(req.body?.kind || ""));
    const label = String(req.body?.label || "").trim();
    const tags = String(req.body?.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!label || !kindParsed.success) {
      res.status(400).json({ error: "kind + label required" });
      return;
    }
    const kind: LibraryKind = kindParsed.data;
    let locks;
    if (req.body?.locks) {
      try {
        locks = JSON.parse(String(req.body.locks));
      } catch {
        /* ignore */
      }
    }
    let contract;
    if (req.body?.contract) {
      try {
        contract = JSON.parse(String(req.body.contract));
      } catch {
        /* ignore */
      }
    }
    let copy;
    if (req.body?.copy) {
      try {
        const raw =
          typeof req.body.copy === "string"
            ? JSON.parse(String(req.body.copy))
            : req.body.copy;
        copy = CopySchema.parse(raw);
      } catch {
        /* ignore */
      }
    }
    res.status(201).json(
      await createLibraryIngredient({
        kind,
        label,
        tags,
        promptHint: String(req.body?.promptHint || ""),
        negativeHint: String(req.body?.negativeHint || ""),
        locks,
        contract,
        copy,
        sourceTalentId: req.body?.sourceTalentId
          ? String(req.body.sourceTalentId)
          : null,
        filename: req.file?.originalname,
        buffer: req.file?.buffer,
        intensity: Number(req.body?.intensity ?? 0.5),
        allowNoMedia: true,
        libraryId,
      }),
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/library/:id/generate", async (req, res) => {
  try {
    const rawMode = req.body?.outputMode ?? req.query?.outputMode;
    const outputMode =
      rawMode === "image" || rawMode === "video" ? rawMode : "video";
    const campaignId = (req.body?.campaignId ?? req.query?.campaignId ?? null) as
      | string
      | null;
    const existing = await getLibraryItem(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Ingredient not found" });
      return;
    }
    if (
      existing.kind === "talent" ||
      existing.kind === "motion" ||
      existing.kind === "copy"
    ) {
      res.status(400).json({
        error: `Cannot generate ${existing.kind} via diffusion — use upload or edit fields (copy lines).`,
      });
      return;
    }
    if (existing.status === "generating") {
      res.status(409).json({
        error: "Plate is already generating — wait for it to finish or fail.",
        item: existing,
      });
      return;
    }

    const etaSeconds = estimatePlateGenSeconds(existing.kind, outputMode);
    await patchLibraryItem(existing.id, { status: "generating" });
    const item = (await getLibraryItem(existing.id))!;

    const job: Job = {
      id: nanoid(10),
      campaignId: campaignId || "_library",
      cellId: null,
      copyId: null,
      sizeId: null,
      width: null,
      height: null,
      stage: "ingredient_gen",
      status: "queued",
      progress: 0,
      message: `${existing.kind} ${outputMode} · ~${Math.round(etaSeconds / 60)}m`,
      resultPath: null,
      etaSeconds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertJob(job);
    const signal = attachJobControl(job.id);

    // Return immediately — attire/video MiniMax can run several minutes.
    res.status(202).json({
      item,
      job,
      etaSeconds,
      outputMode,
    });

    void (async () => {
      try {
        if (signal.aborted) throw Object.assign(new Error("Job cancelled"), { name: "JobCancelledError" });
        upsertJob({
          ...job,
          status: "running",
          progress: 0.05,
          message: `Starting ${outputMode} ${existing.kind}`,
          updatedAt: new Date().toISOString(),
        });
        const ready = await generateIngredientAsset({
          ingredientId: req.params.id,
          modelProfileId: req.body?.modelProfileId
            ? String(req.body.modelProfileId)
            : null,
          sourceTalentId: req.body?.sourceTalentId ?? null,
          campaignId,
          outputMode,
          alreadyGenerating: true,
          signal,
          onPromptId: (promptId) => setJobComfyPromptId(job.id, promptId),
          onProgress: (progress, message) => {
            upsertJob({
              ...getJob(job.id)!,
              status: "running",
              progress,
              message,
              updatedAt: new Date().toISOString(),
            });
          },
        });
        upsertJob({
          ...getJob(job.id)!,
          status: "done",
          progress: 1,
          message: `Ready (${outputMode})`,
          resultPath: ready.path || null,
          updatedAt: new Date().toISOString(),
        });
        finishJobControl(job.id);
      } catch (err) {
        const cancelled =
          isCancelledError(err) ||
          signal.aborted ||
          getJob(job.id)?.status === "cancelled";
        if (cancelled) {
          if (getJob(job.id)?.status !== "cancelled") {
            upsertJob({
              ...(getJob(job.id) || job),
              status: "cancelled",
              progress: 1,
              message: "Cancelled — tokens saved where possible",
              updatedAt: new Date().toISOString(),
            });
          }
          finishJobControl(job.id);
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        upsertJob({
          ...(getJob(job.id) || job),
          status: "failed",
          progress: 1,
          message: msg,
          updatedAt: new Date().toISOString(),
        });
        finishJobControl(job.id);
      }
    })();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Upload / replace media plate on an existing ingredient */
app.post("/library/:id/media", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "file required" });
      return;
    }
    const item = await replaceLibraryMedia(
      req.params.id,
      req.file.originalname,
      req.file.buffer,
    );
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Designer handoff from ComfyUI (custom Publish node or webhook).
 * Multipart: file + kind, label, libraryId?, campaignId?, replacesId?, activate?, tags?, promptHint?
 * Auth: X-Attatta-Publish-Key when ATTATTA_COMFY_PUBLISH_KEY is set.
 */
app.post("/webhooks/comfy-publish", upload.single("file"), async (req, res) => {
  try {
    assertComfyPublishAuth(
      req.header("x-attatta-publish-key") ||
        (typeof req.body?.publishKey === "string" ? req.body.publishKey : null),
    );
    if (!req.file) {
      res.status(400).json({ error: "file required" });
      return;
    }
    const tags = String(req.body?.tags || "")
      .split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
    const activateRaw = req.body?.activate;
    const activate =
      activateRaw === undefined ||
      activateRaw === "" ||
      activateRaw === "1" ||
      activateRaw === "true" ||
      activateRaw === true;
    const event = await publishComfyIngredient({
      kind: String(req.body?.kind || ""),
      label: String(req.body?.label || "").trim(),
      libraryId: req.body?.libraryId ? String(req.body.libraryId) : null,
      campaignId: req.body?.campaignId ? String(req.body.campaignId) : null,
      replacesId: req.body?.replacesId ? String(req.body.replacesId) : null,
      activate,
      tags,
      promptHint: req.body?.promptHint ? String(req.body.promptHint) : undefined,
      filename: req.file.originalname || "comfy-publish.bin",
      buffer: req.file.buffer,
    });
    res.status(201).json(event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /Invalid or missing X-Attatta-Publish-Key/i.test(msg)
      ? 401
      : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/webhooks/comfy-publish/recent", async (req, res) => {
  try {
    res.json(
      listRecentComfyPublishes({
        since: req.query.since ? String(req.query.since) : null,
        libraryId: req.query.libraryId ? String(req.query.libraryId) : null,
        campaignId: req.query.campaignId ? String(req.query.campaignId) : null,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      }),
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/library/:id", async (req, res) => {
  try {
    const patch = LibraryItemPatchSchema.parse(req.body);
    const item = await patchLibraryItem(req.params.id, patch);
    // Confirm folder index matches declared kind after recategorize
    if (patch.kind) await repairLibraryKindIndexes();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/library/:id", async (req, res) => {
  try {
    await deleteLibraryItem(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/library/media/:itemId", async (req, res) => {
  const libraryId = req.query.libraryId
    ? String(req.query.libraryId)
    : undefined;
  const items = libraryId
    ? await listLibrary(undefined, libraryId)
    : await listLibrary();
  let item = items.find((i) => i.id === req.params.itemId);
  if (!item && !libraryId) {
    // Search all packs when no libraryId (UI thumbs may omit it)
    const packs = await listLibraryPacks();
    for (const pack of packs) {
      if (pack.id === DEFAULT_LIBRARY_ID) continue;
      item = (await listLibrary(undefined, pack.id)).find(
        (i) => i.id === req.params.itemId,
      );
      if (item) break;
    }
  }
  if (!item || !item.path || item.mediaType === "json" || item.mediaType === "none") {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  const { libraryAbsolutePath } = await import("./store.js");
  const filePath = libraryAbsolutePath(item);
  try {
    await sendMediaFile(req, res, filePath);
  } catch {
    res.status(404).json({ error: "File missing — run pnpm seed" });
  }
});

app.get("/tokens", async (_req, res) => {
  res.json(await listTokenPacks());
});

app.post("/tokens/import", async (req, res) => {
  try {
    const body = z
      .object({
        format: z.enum(["json", "css"]),
        text: z.string().min(1),
        id: z.string().optional(),
        label: z.string().optional(),
      })
      .parse(req.body);
    const pack = importTokensFromText(body.format, body.text, {
      id: body.id,
      label: body.label,
    });
    res.json(pack);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/tokens", async (req, res) => {
  try {
    const overwrite = Boolean(req.body?.overwrite);
    const { overwrite: _ow, ...rest } = req.body ?? {};
    const pack = DesignTokensSchema.parse(rest);
    const id = sanitizeTokenPackId(pack.id);
    const existing = await listTokenPacks();
    if (!overwrite && existing.some((p) => p.id === id)) {
      res.status(409).json({ error: `Token pack already exists: ${id}` });
      return;
    }
    res.status(overwrite ? 200 : 201).json(await saveTokens({ ...pack, id }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/tokens/:id", async (req, res) => {
  try {
    const id = sanitizeTokenPackId(req.params.id);
    const pack = DesignTokensSchema.parse({ ...req.body, id });
    res.json(await saveTokens(pack));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns", async (req, res) => {
  const includeArchived = req.query.includeArchived === "1";
  res.json(await listCampaigns({ includeArchived }));
});

app.post("/campaigns", async (req, res) => {
  const name = String(req.body?.name || "Untitled campaign");
  const now = new Date().toISOString();
  const tokens = await listTokenPacks();
  const tokenId = tokens[0]?.id || DEFAULT_BRAND_TOKEN_ID;
  const createLibraryId = String(req.body?.libraryId || DEFAULT_LIBRARY_ID);
  const lib = await listLibrary(undefined, createLibraryId);
  const talent = lib.find((i) => i.kind === "talent");
  const hands = lib.filter((i) => i.kind === "hands");
  const motion = lib.find((i) => i.kind === "motion");
  const attire = lib.find((i) => i.kind === "attire");
  const background = lib.find((i) => i.kind === "background");

  const draft: Campaign = CampaignSchema.parse({
    id: nanoid(8),
    name,
    templateId: "paid_social_9x16_v1",
    modelProfileId: process.env.COMFY_MODEL_PROFILE || "sd15",
    brief: {
      prompt: "",
      audience: "",
      offer: "",
      cta: "",
      mustSay: [],
      mustNot: [],
    },
    designTokenPackId: tokenId,
    rail: {
      hero: {
        talentTakeId: talent?.id || "",
        handsId: hands[0]?.id || "",
        motionToken: motion?.id || "",
        attireId: attire?.id ?? null,
        backgroundId: background?.id ?? null,
        themeId: null,
        propIds: [],
      },
      openKnobs: [],
      allowedHandsIds: [],
      allowedAttireIds: [],
      allowedBackgroundIds: [],
      allowedPropIds: [],
      allowedCopy: [
        {
          setup: "Setup line",
          punchline: "Punchline",
          endcard: "Offer",
          cta: "Learn more",
        },
      ],
    },
    matrix: { cells: [], cap: 20 },
    ingredientSet: {
      activeIds: lib.map((i) => i.id),
      hiddenIds: [],
      requireReadyMedia: true,
      contractTalentId: talent?.id ?? null,
    },
    outputSizes: resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS]),
    libraryId: createLibraryId,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  draft.rail = deriveRailFromActivations(draft, lib, draft.rail);
  const campaign = draft;

  res.status(201).json(await saveCampaign(campaign));
});

app.post("/campaigns/magic", async (req, res) => {
  try {
    const name = String(req.body?.name || "Magic campaign");
    const libraryId = req.body?.libraryId
      ? String(req.body.libraryId)
      : undefined;
    const forceNew = Boolean(req.body?.forceNew);
    const campaignId = req.body?.campaignId
      ? String(req.body.campaignId)
      : undefined;
    const { campaign, created, promoted } = await ensureMagicCampaign({
      name,
      libraryId,
      forceNew,
      campaignId,
    });
    res.status(created ? 201 : 200).json({ campaign, created, promoted });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns/:id/magic/plan", async (req, res) => {
  try {
    const result = await magicPlanSnapshot(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/campaigns/:id/magic/prepare", async (req, res) => {
  try {
    const body = z
      .object({
        brief: BriefSchema.optional(),
        importId: z.string().optional(),
        workflowUrl: z.string().optional(),
        workflowJson: z.string().optional(),
      })
      .parse(req.body ?? {});
    const result = await prepareMagicCampaign(req.params.id, body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/campaigns/:id/magic/generate", async (req, res) => {
  try {
    const result = await generateMagicCampaign(req.params.id);
    res.status(202).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/campaigns/:id/magic/workflow", async (req, res) => {
  try {
    let campaign = await getCampaign(req.params.id);
    const body = z
      .object({
        url: z.string().optional(),
        json: z.string().optional(),
      })
      .parse(req.body ?? {});
    const warnings: string[] = [];
    if (body.json?.trim()) {
      const { pkg, warnings: w } = parseMagicWorkflowJson(body.json, "pasted");
      warnings.push(...w);
      if (!pkg) {
        res.status(400).json({ error: "Invalid workflow JSON", warnings });
        return;
      }
      campaign = applyMagicWorkflowToCampaign(campaign, pkg, "imported");
    } else if (body.url?.trim()) {
      const { pkg, warnings: w } = await fetchMagicWorkflowUrl(body.url);
      warnings.push(...w);
      if (!pkg) {
        res.status(400).json({ error: "Could not load workflow URL", warnings });
        return;
      }
      campaign = applyMagicWorkflowToCampaign(campaign, pkg, "url");
    } else {
      res.status(400).json({ error: "Provide url or json" });
      return;
    }
    res.json({ campaign: await saveCampaign(campaign), warnings });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns/:id", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    // Keep sizeAssets aligned so Matrix sees every aspect (e.g. newly added 16:9)
    const before = JSON.stringify(
      campaign.matrix.cells.map((c) => c.sizeAssets?.map((a) => a.sizeId)),
    );
    syncCampaignSizeAssets(campaign);
    const after = JSON.stringify(
      campaign.matrix.cells.map((c) => c.sizeAssets?.map((a) => a.sizeId)),
    );
    if (before !== after) {
      res.json(await saveCampaign(campaign));
      return;
    }
    res.json(campaign);
  } catch (err) {
    if (err instanceof CampaignStoreError) {
      const status = err.code === "not_found" ? 404 : 422;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    res.status(404).json({ error: "Campaign not found" });
  }
});

app.patch("/campaigns/:id", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        archived: z.boolean().optional(),
        modelProfileId: z.string().optional(),
        libraryId: z.string().optional(),
        assemblyRecipe: AssemblyRecipeSchema.optional(),
        celtraTemplateProfileId: z.string().optional(),
        comfyTemplate: ComfyTemplateSchema.optional(),
      })
      .parse(req.body);
    if (body.name !== undefined) campaign.name = body.name;
    if (body.archived !== undefined) campaign.archived = body.archived;
    if (body.modelProfileId !== undefined) campaign.modelProfileId = body.modelProfileId;
    if (body.libraryId !== undefined) {
      if (!(await getLibraryPack(body.libraryId))) {
        res.status(400).json({ error: `Unknown library pack: ${body.libraryId}` });
        return;
      }
      campaign.libraryId = body.libraryId;
    }
    if (body.assemblyRecipe !== undefined) {
      campaign.assemblyRecipe = normalizeAssemblyRecipe(body.assemblyRecipe);
    }
    if (body.celtraTemplateProfileId !== undefined) {
      campaign.celtraTemplateProfileId = body.celtraTemplateProfileId;
    }
    if (body.comfyTemplate !== undefined) {
      campaign.comfyTemplate = normalizeComfyTemplate(body.comfyTemplate);
    }
    res.json(await saveCampaign(campaign));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns/:id/sizes", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    res.json({
      catalog: OUTPUT_SIZE_CATALOG,
      selected: campaign.outputSizes,
      modelProfileId: campaign.modelProfileId,
      plan: plannedAssets(campaign),
    });
  } catch {
    res.status(404).json({ error: "Campaign not found" });
  }
});

app.put("/campaigns/:id/sizes", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const body = z
      .object({
        sizeIds: z.array(z.string()).min(1).optional(),
        sizes: z.array(OutputSizeSchema).min(1).optional(),
      })
      .parse(req.body);
    if (body.sizes?.length) {
      campaign.outputSizes = body.sizes;
    } else if (body.sizeIds?.length) {
      campaign.outputSizes = resolveOutputSizes(body.sizeIds);
    } else {
      res.status(400).json({ error: "sizeIds or sizes required" });
      return;
    }
    // Sync size slots; do not copy genPath across aspects — Fill missing sizes runs Comfy
    syncCampaignSizeAssets(campaign);
    res.json(await saveCampaign(campaign));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns/:id/asset-plan", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    res.json(plannedAssets(campaign));
  } catch {
    res.status(404).json({ error: "Campaign not found" });
  }
});

app.get("/campaigns/:id/ingredients", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const libraryId = campaign.libraryId || DEFAULT_LIBRARY_ID;
    const includeHidden =
      req.query.includeArchived === "1" ||
      req.query.includeArchived === "true" ||
      req.query.includeHidden === "1" ||
      req.query.includeHidden === "true";
    const lib = await listLibrary(undefined, libraryId, {
      includeArchived: includeHidden,
    });
    const talentId =
      campaign.ingredientSet?.contractTalentId || campaign.rail.hero.talentTakeId;
    const talent = lib.find((i) => i.id === talentId);
    const active = new Set(campaign.ingredientSet?.activeIds ?? []);
    const hidden = new Set(campaign.ingredientSet?.hiddenIds ?? []);
    const legacyAll = active.size === 0;
    const items = lib
      .filter((item) => includeHidden || !hidden.has(item.id))
      .map((item) => {
        const isHidden = hidden.has(item.id);
        return {
          ...item,
          hidden: isHidden,
          active: !isHidden && (legacyAll || active.has(item.id)),
        };
      });
    res.json({
      ingredientSet: campaign.ingredientSet,
      libraryId,
      contract: resolveTalentContract(talent),
      contractTalentId: talentId,
      items,
    });
  } catch {
    res.status(404).json({ error: "Campaign not found" });
  }
});

app.put("/campaigns/:id/ingredients", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const parsed = CampaignIngredientSetSchema.parse(req.body);
    const hidden = new Set(parsed.hiddenIds ?? []);
    campaign.ingredientSet = {
      ...parsed,
      activeIds: (parsed.activeIds ?? []).filter((id) => !hidden.has(id)),
      hiddenIds: [...hidden],
    };
    const lib = await listLibrary(undefined, campaign.libraryId || DEFAULT_LIBRARY_ID);
    // Rail is derived from activations (Rail step dissolved)
    campaign.rail = deriveRailFromActivations(campaign, lib, campaign.rail);
    res.json(await saveCampaign(campaign));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns/:id/policy", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const lib = await listLibrary(undefined, campaign.libraryId || DEFAULT_LIBRARY_ID);
    const violations = evaluateCampaignPolicy(campaign, campaign.rail, lib);
    res.json({ ok: violations.length === 0, violations });
  } catch {
    res.status(404).json({ error: "Campaign not found" });
  }
});

app.delete("/campaigns/:id", async (req, res) => {
  try {
    await getCampaign(req.params.id);
    await deleteCampaign(req.params.id);
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "Campaign not found" });
  }
});
app.put("/campaigns/:id/brief", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  campaign.brief = BriefSchema.parse(req.body);
  res.json(await saveCampaign(campaign));
});

app.put("/campaigns/:id/tokens", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  campaign.designTokenPackId = String(req.body.designTokenPackId);
  res.json(await saveCampaign(campaign));
});

app.put("/campaigns/:id/rail", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  const lib = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );
  const bodyRail = IngredientRailSchema.parse(req.body);
  // Ingredients owns activation — never re-activate plates from a stale rail payload
  campaign.rail = pruneRailToActive(campaign, bodyRail, lib);
  const violations = evaluateCampaignPolicy(campaign, campaign.rail, lib);
  if (violations.length) {
    res.status(400).json({ error: "Policy blocked rail save", violations });
    return;
  }
  res.json(await saveCampaign(campaign));
});

app.put("/campaigns/:id/matrix", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  campaign.matrix = MatrixSchema.parse(req.body);
  if (campaign.matrix.cells.length > campaign.matrix.cap) {
    res.status(400).json({ error: `Matrix exceeds cap of ${campaign.matrix.cap}` });
    return;
  }
  res.json(await saveCampaign(campaign));
});

/** Per-row plate toggles + prompt overrides — does not rebuild the matrix. */
app.patch("/campaigns/:id/cells/:cellId", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const body = z
      .object({
        genOmitIds: z.array(z.string()).optional(),
        /** null / empty clears override (auto prompt resumes). */
        promptOverride: z.string().nullable().optional(),
        negativeOverride: z.string().nullable().optional(),
        sceneSlots: z.array(SceneSlotSchema).optional(),
        sceneTag: z.string().nullable().optional(),
      })
      .parse(req.body);
    const resolved = resolveMatrixCell(campaign, req.params.cellId);
    if (!resolved) {
      res.status(404).json({ error: "Cell not found" });
      return;
    }
    const cell = resolved.cell;
    if (body.genOmitIds !== undefined) {
      cell.genOmitIds = [...new Set(body.genOmitIds.filter(Boolean))];
    }
    if (body.promptOverride !== undefined) {
      const t = (body.promptOverride ?? "").trim();
      cell.promptOverride = t ? t : null;
    }
    if (body.negativeOverride !== undefined) {
      const t = (body.negativeOverride ?? "").trim();
      cell.negativeOverride = t ? t : null;
    }
    if (body.sceneTag !== undefined) {
      cell.sceneTag = body.sceneTag?.trim() || null;
      if (cell.sceneTag) {
        cell.sceneTag = ensureSceneTag(
          { ...cell, sceneTag: cell.sceneTag },
          campaign.assemblyRecipe,
        );
      }
    } else if (body.sceneSlots !== undefined) {
      // Legacy: migrate gen slot → sceneTag
      cell.sceneSlots = body.sceneSlots;
      cell.sceneTag = ensureSceneTag(cell, campaign.assemblyRecipe);
    }
    res.json(await saveCampaign(campaign));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/campaigns/:id/matrix/build-sparse", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  const libForRail = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );
  campaign.rail = deriveRailFromActivations(campaign, libForRail, campaign.rail);
  const rail = campaign.rail;
  const { hero, openKnobs } = rail;
  const defaultCopy = {
    setup: "Setup",
    punchline: "Punch",
    endcard: "Offer",
    cta: "Learn more",
  };

  // Open knob → fan allowlist; closed → hero pin only (length 1)
  // Hands optional: empty string = talent-only assemble (punchline reuses talent/BG plate)
  const handsIds: string[] = openKnobs.includes("hands")
    ? rail.allowedHandsIds.length > 0
      ? [...rail.allowedHandsIds]
      : [hero.handsId].filter(Boolean)
    : [hero.handsId].filter(Boolean);
  if (handsIds.length === 0) handsIds.push("");

  // Copy plates append at Remotion assemble — bake a default line into each visual cell.
  const defaultCellCopy =
    rail.allowedCopy.length > 0 ? rail.allowedCopy[0]! : defaultCopy;

  const attireIds: (string | null)[] = openKnobs.includes("attire")
    ? rail.allowedAttireIds.length > 0
      ? rail.allowedAttireIds
      : [hero.attireId].filter(Boolean)
    : [hero.attireId];
  const backgroundIds: (string | null)[] = openKnobs.includes("background")
    ? rail.allowedBackgroundIds.length > 0
      ? rail.allowedBackgroundIds
      : [hero.backgroundId].filter(Boolean)
    : [hero.backgroundId];
  const propAxis: (string | null)[] = openKnobs.includes("prop")
    ? rail.allowedPropIds.length > 0
      ? rail.allowedPropIds
      : hero.propIds.length
        ? hero.propIds.slice(0, 1)
        : [null]
    : [null]; // closed: keep hero.propIds on each cell (not fanned)

  if (attireIds.length === 0) attireIds.push(null);
  if (backgroundIds.length === 0) backgroundIds.push(null);
  if (propAxis.length === 0) propAxis.push(null);

  const sizes = campaign.outputSizes?.length
    ? campaign.outputSizes
    : resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS]);

  const prevCells = campaign.matrix.cells ?? [];
  const prevRetired = campaign.matrix.retired ?? [];
  /** Richest prior match per signature (live or archive) — re-activate restores media. */
  const prevBySig = new Map<string, MatrixCell | RetiredMatrixCell>();
  for (const c of prevRetired) {
    const sig = variantSignature(c);
    const cur = prevBySig.get(sig);
    prevBySig.set(sig, cur ? richerMatrixCell(cur, c) : c);
  }
  for (const c of prevCells) {
    const sig = variantSignature(c);
    const cur = prevBySig.get(sig);
    prevBySig.set(sig, cur ? richerMatrixCell(cur, c) : c);
  }
  const usedPrev = new Set<string>();

  const cells: MatrixCell[] = [];
  let i = 1;
  outer: for (const handsId of handsIds) {
    for (const attireId of attireIds) {
      for (const backgroundId of backgroundIds) {
        for (const propId of propAxis) {
          const propIds =
            openKnobs.includes("prop") && propId
              ? [propId]
              : [...(hero.propIds ?? [])];
          // Hands-only (talent + gesture plate) also needs MiniMax blend — not assemble-only
          const needsGen = Boolean(
            attireId ||
              backgroundId ||
              propIds.length > 0 ||
              Boolean(handsId && String(handsId).trim()),
          );
          const draft: MatrixCell = {
            cellId: `${campaign.id}_${String(i).padStart(3, "0")}`,
            talentTakeId: hero.talentTakeId,
            handsId: handsId || "",
            motionToken: hero.motionToken || "",
            attireId,
            backgroundId,
            themeId: hero.themeId,
            propIds,
            genOmitIds: [],
            promptOverride: null,
            negativeOverride: null,
            copy: defaultCellCopy,
            designTokenPackId: campaign.designTokenPackId,
            needsGen,
            previewOk: false,
            outputPath: null,
            previewPath: null,
            sizeAssets: sizes.map((s) => ({
              sizeId: s.id,
              width: s.width,
              height: s.height,
              aspect: s.aspect,
              previewPath: null,
              outputPath: null,
              genPath: null,
              promptHash: null,
              status: "pending" as const,
              error: null,
            })),
            sceneTag: ensureSceneTag(
              { sceneTag: null, sceneSlots: [] },
              campaign.assemblyRecipe,
            ),
            sceneSlots: [],
            status: "draft" as const,
            error: null,
          };
          const sig = variantSignature(draft);
          const prev = prevBySig.get(sig);
          if (prev) {
            usedPrev.add(sig);
            const live = toLiveMatrixCell(prev);
            // Same visual combo — keep Comfy / Remotion media + stable cellId
            draft.cellId = live.cellId;
            draft.genOmitIds = [...(live.genOmitIds ?? [])];
            draft.promptOverride = live.promptOverride ?? null;
            draft.negativeOverride = live.negativeOverride ?? null;
            draft.sceneTag = ensureSceneTag(live, campaign.assemblyRecipe);
            draft.sizeAssets = sizes.map((s) => {
              // Never inherit genPath from a different aspect
              const old = live.sizeAssets?.find((a) => a.sizeId === s.id);
              return {
                sizeId: s.id,
                width: s.width,
                height: s.height,
                aspect: s.aspect,
                previewPath: old?.previewPath ?? null,
                outputPath: old?.outputPath ?? null,
                genPath: old?.genPath ?? null,
                promptHash: old?.promptHash ?? null,
                status: old?.status ?? ("pending" as const),
                error: old?.error ?? null,
              };
            });
            draft.previewPath = live.previewPath;
            draft.outputPath = live.outputPath;
            draft.previewOk = live.previewOk;
            draft.status = live.status;
            draft.error = live.error;
            draft.copy = live.copy ?? draft.copy;
            draft.needsGen = needsGen;
          }
          cells.push(draft);
          i += 1;
          if (cells.length >= campaign.matrix.cap) break outer;
        }
      }
    }
  }

  const violations = evaluateCampaignPolicy(campaign, campaign.rail, libForRail);
  if (violations.length) {
    res.status(400).json({ error: "Policy blocked matrix build", violations });
    return;
  }

  const retiredAt = new Date().toISOString();
  const newlyRetired: RetiredMatrixCell[] = prevCells
    .filter((c) => !usedPrev.has(variantSignature(c)))
    .map((c) => ({
      ...c,
      retiredAt,
      reason: "rebuild",
      archiveId: nanoid(10),
    }));
  // Keep prior archive entries that weren't revived into the live matrix
  const keptArchive: RetiredMatrixCell[] = prevRetired
    .filter((c) => !usedPrev.has(variantSignature(c)))
    .map((c) =>
      c.archiveId?.trim()
        ? c
        : { ...c, archiveId: nanoid(10) },
    );
  const RETIRED_CAP = 40;
  const retired = [...newlyRetired, ...keptArchive].slice(0, RETIRED_CAP);

  campaign.matrix = { ...campaign.matrix, cells, retired };
  res.json(await saveCampaign(campaign));
});

/** Comfy variant stills for matrix cells (attire / BG / prop combos). */
app.post("/campaigns/:id/generate-plates", async (req, res) => {
  try {
    const cellIds = req.body?.cellIds as string[] | undefined;
    const jobs = await enqueueVariantBatch(req.params.id, cellIds, {
      forceRegen: Boolean(req.body?.forceRegen),
    });
    res.status(202).json({ jobs });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Alias — matrix cells are the variant list. */
app.post("/campaigns/:id/generate-variants", async (req, res) => {
  try {
    const cellIds = req.body?.cellIds as string[] | undefined;
    const jobs = await enqueueVariantBatch(req.params.id, cellIds, {
      forceRegen: Boolean(req.body?.forceRegen),
    });
    res.status(202).json({ jobs });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Comfy per missing aspect (new sizes), then Remotion assemble those slots.
 * Does not re-gen sizes that already have their own genPath.
 */
app.post("/campaigns/:id/generate-missing-sizes", async (req, res) => {
  try {
    const cellIds = req.body?.cellIds as string[] | undefined;
    const sizeIds = req.body?.sizeIds as string[] | undefined;
    const jobs = await enqueueMissingSizeVariantBatch(req.params.id, cellIds, {
      forceRegen: Boolean(req.body?.forceRegen),
      sizeIds,
    });
    res.status(202).json({ jobs });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** @deprecated Alias of /render — single hi-res Remotion assemble (no half-res preview). */
app.post("/campaigns/:id/preview", async (req, res) => {
  try {
    const cellIds = req.body?.cellIds as string[] | undefined;
    const copyIds = req.body?.copyIds as string[] | undefined;
    const sizeIds = req.body?.sizeIds as string[] | undefined;
    const skipComfy = req.body?.skipComfy !== false;
    const jobs = await enqueueBatch(req.params.id, "render", cellIds, {
      skipComfy,
      forceRegen: Boolean(req.body?.forceRegen),
      copyIds,
      sizeIds,
      onlyMissing: Boolean(req.body?.onlyMissing),
    });
    res.status(202).json({ jobs });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/campaigns/:id/render", async (req, res) => {
  try {
    const cellIds = req.body?.cellIds as string[] | undefined;
    const copyIds = req.body?.copyIds as string[] | undefined;
    const sizeIds = req.body?.sizeIds as string[] | undefined;
    const skipComfy = req.body?.skipComfy !== false;
    const jobs = await enqueueBatch(req.params.id, "render", cellIds, {
      skipComfy,
      forceRegen: Boolean(req.body?.forceRegen),
      copyIds,
      sizeIds,
      onlyMissing: Boolean(req.body?.onlyMissing),
    });
    res.status(202).json({ jobs });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** @deprecated Alias of cell render — hi-res assemble only. */
app.post("/campaigns/:id/cells/:cellId/preview", async (req, res) => {
  const job = await enqueueCellJob(req.params.id, req.params.cellId, "render");
  res.status(202).json(job);
});

app.post("/campaigns/:id/cells/:cellId/render", async (req, res) => {
  const job = await enqueueCellJob(req.params.id, req.params.cellId, "render");
  res.status(202).json(job);
});

app.get("/campaigns/:id/cells/:cellId/prompt-pack", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const cell = campaign.matrix.cells.find((c) => c.cellId === req.params.cellId);
    if (!cell) {
      res.status(404).json({ error: "Cell not found" });
      return;
    }
    const sizeId = typeof req.query.sizeId === "string" ? req.query.sizeId : undefined;
    const size = sizeId
      ? campaign.outputSizes?.find((s) => s.id === sizeId)
      : campaign.outputSizes?.[0];
    res.json(await buildPromptPack(campaign, cell, size));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Run Comfy for one cell×size and persist genPath (no Remotion). */
app.post("/campaigns/:id/comfy-generate", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const cellId = String(req.body?.cellId || "");
    const cell = campaign.matrix.cells.find((c) => c.cellId === cellId);
    if (!cell) {
      res.status(404).json({ error: "Cell not found" });
      return;
    }
    const size =
      campaign.outputSizes?.find((s) => s.id === req.body?.sizeId) ||
      campaign.outputSizes?.[0] ||
      resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS])[0];
    const force = Boolean(req.body?.force);
    const pack = await buildPromptPack(campaign, cell, size);
    const { lookupPlateCache, putPlateCache } = await import("./plateCache.js");
    if (!force) {
      const hit = await lookupPlateCache(pack.promptHash);
      if (hit) {
        if (!cell.sizeAssets?.length) cell.sizeAssets = [];
        let asset = cell.sizeAssets.find((a) => a.sizeId === size.id);
        if (!asset) {
          asset = {
            sizeId: size.id,
            width: size.width,
            height: size.height,
            aspect: size.aspect,
            previewPath: null,
            outputPath: null,
            genPath: null,
            promptHash: null,
            status: "pending",
            error: null,
          };
          cell.sizeAssets.push(asset);
        }
        asset.genPath = hit.assetPath;
        asset.promptHash = pack.promptHash;
        asset.status = "generating";
        asset.error = null;
        await saveCampaign(campaign);
        res.json({
          assetId: path.basename(hit.assetPath),
          assetPath: hit.assetPath,
          lineage: { reused: true, reason: "plate_cache", promptHash: pack.promptHash },
          promptPack: pack,
          sizeId: size.id,
        });
        return;
      }
    }
    process.env.COMFY_WRAP_MP4 = "1";
    const result = await runComfyJob({
      workflowId: pack.workflowId,
      modelProfileId: campaign.modelProfileId,
      cellId: `${cellId}:${size.id}`,
      knob: pack.knob,
      patches: {
        ...pack.patches,
        wrapMp4: true,
        forceRegen: force,
        ...(req.body?.patches || {}),
      },
    });
    if (!cell.sizeAssets?.length) {
      cell.sizeAssets = [];
    }
    let asset = cell.sizeAssets.find((a) => a.sizeId === size.id);
    if (!asset) {
      asset = {
        sizeId: size.id,
        width: size.width,
        height: size.height,
        aspect: size.aspect,
        previewPath: null,
        outputPath: null,
        genPath: null,
        promptHash: null,
        status: "pending",
        error: null,
      };
      cell.sizeAssets.push(asset);
    }
    asset.genPath = result.assetPath;
    asset.promptHash = pack.promptHash;
    asset.status = "generating";
    asset.error = null;
    await saveCampaign(campaign);
    await putPlateCache({
      promptHash: pack.promptHash,
      assetPath: result.assetPath,
      workflowId: pack.workflowId,
      modelProfileId: campaign.modelProfileId,
      knob: pack.knob,
      sizeId: size.id,
      createdAt: new Date().toISOString(),
      cellId,
    });
    res.json({ ...result, promptPack: pack, sizeId: size.id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** @deprecated — use POST /campaigns/:id/comfy-generate */
app.post("/campaigns/:id/comfy-stub", async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id);
    const cellId = String(req.body?.cellId || "");
    const cell = campaign.matrix.cells.find((c) => c.cellId === cellId);
    const pack = cell ? await buildPromptPack(campaign, cell) : null;
    const result = await runComfyJob({
      workflowId: pack?.workflowId || "hands_product_v1",
      modelProfileId: campaign.modelProfileId,
      cellId: cellId || "manual",
      knob: pack?.knob || "hands",
      patches: { ...(pack?.patches || {}), ...(req.body?.patches || {}), wrapMp4: true },
    });
    res.json({ ...result, promptPack: pack });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns/:id/reviews", async (req, res) => {
  res.json(await getReviews(req.params.id));
});

app.put("/campaigns/:id/reviews", async (req, res) => {
  const entries = (req.body as unknown[]).map((r) => ReviewEntrySchema.parse(r));
  await saveReviews(req.params.id, entries as ReviewEntry[]);
  res.json(entries);
});

app.post("/campaigns/:id/reviews/:cellId", async (req, res) => {
  const reviews = await getReviews(req.params.id);
  const next: ReviewEntry = ReviewEntrySchema.parse({
    cellId: req.params.cellId,
    decision: req.body.decision ?? "pending",
    reasonTags: req.body.reasonTags ?? [],
    notes: req.body.notes ?? "",
    updatedAt: new Date().toISOString(),
  });
  const idx = reviews.findIndex((r) => r.cellId === next.cellId);
  if (idx >= 0) reviews[idx] = next;
  else reviews.push(next);
  await saveReviews(req.params.id, reviews);
  const { emitCampaignEvent } = await import("./campaignEvents.js");
  emitCampaignEvent({
    campaignId: req.params.id,
    column: "hopper",
    type: "review_decision",
    summary: `Review ${next.cellId} → ${next.decision}`,
    payload: {
      cellId: next.cellId,
      decision: next.decision,
      notes: next.notes,
    },
  });
  res.json(next);
});

app.get("/campaigns/:id/events", async (req, res) => {
  try {
    await getCampaign(req.params.id);
    const { listCampaignEvents } = await import("./campaignEvents.js");
    const result = listCampaignEvents(req.params.id, {
      before: (req.query.before as string) || null,
      after: (req.query.after as string) || null,
      limit: req.query.limit ? Number(req.query.limit) : 40,
    });
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/campaigns/:id/events/stream", async (req, res) => {
  try {
    await getCampaign(req.params.id);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const { listCampaignEvents, subscribeCampaignEvents } = await import(
    "./campaignEvents.js"
  );
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();

  const lastId = String(req.headers["last-event-id"] || req.query.after || "");
  if (lastId) {
    const missed = listCampaignEvents(req.params.id, {
      after: lastId,
      limit: 100,
    });
    // list returns newest-first; send oldest-first for replay
    for (const ev of [...missed.events].reverse()) {
      res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  }

  const unsub = subscribeCampaignEvents(req.params.id, (ev) => {
    res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
  });
  const ping = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);
  req.on("close", () => {
    clearInterval(ping);
    unsub();
  });
});

app.get("/campaigns/:id/celtra-preview", async (req, res) => {
  try {
    const { buildCeltraPreview } = await import("./packageExport.js");
    const preview = await buildCeltraPreview(req.params.id);
    res.json(preview);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/campaigns/:id/live/note", async (req, res) => {
  try {
    await getCampaign(req.params.id);
    const { emitCampaignEvent } = await import("./campaignEvents.js");
    const column = req.body.column === "celtra" || req.body.column === "hopper"
      ? req.body.column
      : "magic";
    const text = String(req.body.text || "").trim();
    if (!text) {
      res.status(400).json({ error: "text required" });
      return;
    }
    const isCmd = text.startsWith("/");
    const event = emitCampaignEvent({
      campaignId: req.params.id,
      column,
      type: isCmd ? "user_command" : "user_note",
      summary: text.slice(0, 200),
      payload: { text, column },
    });
    res.json(event);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/campaigns/:id/live/open", async (req, res) => {
  try {
    await getCampaign(req.params.id);
    const { emitCampaignEvent } = await import("./campaignEvents.js");
    const event = emitCampaignEvent({
      campaignId: req.params.id,
      column: "hopper",
      type: "workspace_opened",
      summary: "Live workspace opened",
      payload: {},
    });
    res.json(event);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/live/llm-status", async (_req, res) => {
  const { getLlmStatus } = await import("./llmClient.js");
  res.json(getLlmStatus());
});

app.post("/campaigns/:id/package", async (req, res) => {
  try {
    const result = await buildCeltraPackage(req.params.id);
    res.json({
      zipPath: result.zipPath,
      fileName: result.fileName,
      rowCount: result.rowCount,
      downloadUrl: result.downloadPath,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Named Celtra/package downloads — URL ends with `.zip` so browsers keep the extension
 * even when the UI is on a different origin than the API.
 */
app.get("/packages/:fileName", async (req, res) => {
  try {
    const fileName = path.basename(
      decodeURIComponent(String(req.params.fileName || "")),
    );
    if (
      !fileName ||
      fileName.includes("..") ||
      !/^[A-Za-z0-9._-]+\.zip$/i.test(fileName)
    ) {
      res.status(400).json({ error: "Expected a safe .zip package basename" });
      return;
    }
    const filePath = path.join(PATHS.packages, fileName);
    if (!filePath.startsWith(`${PATHS.packages}${path.sep}`)) {
      res.status(403).json({ error: "Path not allowed" });
      return;
    }
    await sendMediaFile(req, res, filePath, {
      forceDownload: true,
      downloadName: fileName,
    });
  } catch {
    res.status(404).json({ error: "Package not found" });
  }
});

app.get("/jobs", (req, res) => {
  res.json(listJobs(req.query.campaignId as string | undefined));
});

app.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

/** Stop one live job (Comfy interrupt + Remotion cancel when possible). */
app.post("/jobs/:id/cancel", async (req, res) => {
  try {
    const job = await cancelJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Stop all queued/running jobs for a campaign (use `_library` for library gens). */
app.post("/campaigns/:id/jobs/cancel", async (req, res) => {
  try {
    const jobs = await cancelCampaignJobs(req.params.id);
    res.json({ jobs, cancelled: jobs.length });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/files", async (req, res) => {
  const rawPath = String(req.query.path || "");
  if (!rawPath || !path.isAbsolute(rawPath)) {
    res.status(400).json({ error: "Absolute path required" });
    return;
  }
  const { resolveDataMediaPath } = await import("./mediaPaths.js");
  const filePath = resolveDataMediaPath(rawPath);
  // only allow under data/
  const underData =
    filePath === PATHS.data || filePath.startsWith(`${PATHS.data}${path.sep}`);
  if (!underData) {
    res.status(403).json({ error: "Path not allowed" });
    return;
  }
  try {
    await sendMediaFile(req, res, filePath);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

await ensureDataDirs();
app.listen(PORT, "0.0.0.0", () => {
  void reclaimStaleGenerating().then((n) => {
    if (n) console.log(`Reclaimed ${n} stale generating plate(s) → failed`);
  });
  console.log(`ATTATTA orchestrator on ${PUBLIC_BASE}`);
  console.log(`Data: ${PATHS.data}`);
});
