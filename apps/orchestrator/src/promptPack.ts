import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_OUTPUT_SIZE_IDS,
  PromptPackSchema,
  cellForGeneration,
  genDimsForSize,
  getIngredientKind,
  isPlateReady,
  resolveOutputSizes,
  type Brief,
  type Campaign,
  type LibraryItem,
  type MatrixCell,
  type OutputSize,
  type PromptPack,
} from "@attatta/shared";
import { REPO_ROOT } from "./config.js";
import { isIngredientActive, railReferencedIds } from "./policy.js";
import { getTokens, listLibrary } from "./store.js";

type ModelDefaults = {
  steps: number;
  cfg: number;
  width: number;
  height: number;
};

async function loadModelDefaults(modelProfileId: string): Promise<ModelDefaults> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(REPO_ROOT, "comfy/models.registry.json"), "utf8"),
    );
    const profile = raw.profiles?.[modelProfileId] ?? raw.profiles?.[raw.defaultProfileId];
    return {
      steps: profile?.defaults?.steps ?? 8,
      cfg: profile?.defaults?.cfg ?? 1,
      width: profile?.defaults?.width ?? 1024,
      height: profile?.defaults?.height ?? 1024,
    };
  } catch {
    return { steps: 8, cfg: 1, width: 1024, height: 1024 };
  }
}

function byId(lib: LibraryItem[], id: string | null | undefined) {
  if (!id) return null;
  return lib.find((i) => i.id === id) ?? null;
}

/** Only active campaign ingredients that appear on the saved rail (or this cell). */
function scopedById(
  campaign: Campaign | null | undefined,
  lib: LibraryItem[],
  id: string | null | undefined,
  extraAllowed?: Set<string>,
): LibraryItem | null {
  if (!id) return null;
  const item = byId(lib, id);
  if (!item) return null;
  if (campaign && !isIngredientActive(campaign, id)) return null;
  if (extraAllowed && !extraAllowed.has(id)) return null;
  return item;
}

function railScopeSet(campaign: Campaign | null | undefined): Set<string> | undefined {
  if (!campaign?.rail) return undefined;
  return new Set(railReferencedIds(campaign.rail));
}

function phrase(item: LibraryItem | null, fallback = ""): string {
  if (!item) return fallback;
  const hint = item.promptHint?.trim() || item.label;
  const tags = item.tags.length ? ` (${item.tags.join(", ")})` : "";
  return `${hint}${tags}`;
}

/** Video variants on by default for Cloud; set COMFY_VARIANT_VIDEO=0 for still fallback. */
export function variantVideoEnabled(): boolean {
  return process.env.COMFY_VARIANT_VIDEO !== "0";
}

export type VideoPipeline = "bria_replace" | "minimax_h3_r2v" | "still";

/** Library / Ingredients plate generate: still vs partner video. */
export type IngredientOutputMode = "image" | "video";

function isVideoMedia(item: LibraryItem | null | undefined): boolean {
  if (!item?.path?.trim()) return false;
  if (item.mediaType === "video") return true;
  return /\.(mp4|webm|mov|m4v|gif)$/i.test(item.path);
}

/**
 * BG-only (no attire/prop/hands) → Bria replace (preserves talent take).
 * Any hands / attire / prop / multi-axis → MiniMax H3 R2V (blend all refs).
 */
export function pickVideoPipeline(cell: MatrixCell): VideoPipeline {
  if (!variantVideoEnabled()) return "still";
  const hasBg = Boolean(cell.backgroundId);
  const hasAttire = Boolean(cell.attireId);
  const hasProp = cell.propIds.length > 0;
  const hasHands = Boolean(cell.handsId?.trim());
  // Pure BG swap only — hands+BG must MiniMax so the gesture plate isn't dropped
  if (hasBg && !hasAttire && !hasProp && !hasHands) return "bria_replace";
  if (hasBg || hasAttire || hasProp || hasHands) return "minimax_h3_r2v";
  return "still";
}

/**
 * Library plate pipelines (NOT matrix variants):
 * - background + Image → still scene diffusion (talent_bg_v1 / SD).
 * - background + Video + talent MP4 → MiniMax R2V (camera/POV from talent take;
 *   prompt asks for environment, not the spokesperson). This is the quality path
 *   that produced good camping BG plates before the still-only regression.
 * - attire / prop / hands + video → MiniMax R2V when talent video exists.
 */
export function pickIngredientVideoPipeline(opts: {
  kind: LibraryItem["kind"];
  outputMode: IngredientOutputMode;
  /** @deprecated unused */
  hasBackgroundStill?: boolean;
  talentIsVideo: boolean;
}): VideoPipeline {
  if (opts.outputMode !== "video" || !variantVideoEnabled()) return "still";
  if (!opts.talentIsVideo) return "still";
  if (
    opts.kind === "background" ||
    opts.kind === "attire" ||
    opts.kind === "prop" ||
    opts.kind === "hands"
  ) {
    return "minimax_h3_r2v";
  }
  return "still";
}

/** Operator prompt already asks for people/crowd — don't contradict with "no people". */
function sceneAllowsPeople(prompt: string): boolean {
  return /\b(people|person|crowd|patrons|customers|diners|bakers|chef|staff|guests|human|humans|waiter|bartender)\b/i.test(
    prompt,
  );
}

/**
 * Which Comfy knob a matrix cell uses for its variant.
 * One workflow per cell; prompt pack folds all axes. Priority:
 * background → attire → prop → hands.
 */
export function pickVariantKnob(
  cell: MatrixCell,
  _campaign: Campaign,
): PromptPack["knob"] {
  if (cell.backgroundId) return "background";
  if (cell.attireId) return "attire";
  if (cell.propIds.length) return "prop";
  return "hands";
}

function pickKnob(cell: MatrixCell, campaign: Campaign): PromptPack["knob"] {
  return pickVariantKnob(cell, campaign);
}

function workflowFor(
  knob: PromptPack["knob"],
  pipeline: VideoPipeline,
): string {
  if (pipeline === "bria_replace") return "talent_bg_video_v1";
  if (pipeline === "minimax_h3_r2v") return "talent_variant_video_v1";
  if (knob === "attire") return "talent_attire_v1";
  if (knob === "background") return "talent_bg_v1";
  return "hands_product_v1";
}

function aspectToRatio(aspect: string): string {
  if (aspect === "9:16" || aspect === "4:5" || aspect === "1:1" || aspect === "16:9") {
    return aspect === "4:5" ? "3:4" : aspect;
  }
  return "9:16";
}

function refRole(
  kind: string,
  patchKey: string | null,
): PromptPack["refs"][number]["role"] {
  if (kind === "talent" || patchKey === "talentRef") return "talent";
  if (kind === "hands" || patchKey === "productRef") return "product";
  if (kind === "attire" || patchKey === "wardrobeRef") return "wardrobe";
  if (kind === "background" || patchKey === "backgroundRef") return "background";
  if (kind === "motion") return "motion";
  if (kind === "prop") return "prop";
  return "other";
}

/**
 * Builds an English prompt pack shaped for the campaign's model profile,
 * including per-variant copy/angle and local media ref paths for Comfy upload.
 */
export async function buildPromptPack(
  campaign: Campaign,
  cell: MatrixCell,
  size?: OutputSize,
): Promise<PromptPack> {
  // Per-row unchecked plates (genOmitIds) drop out of the prompt only
  cell = cellForGeneration(cell);
  const lib = await listLibrary(
    undefined,
    campaign.libraryId || "default",
  );
  // Cell combo ∩ saved rail ∩ active — never the whole library / all actives
  const railScope = railScopeSet(campaign);
  const cellIds = [
    cell.talentTakeId,
    cell.handsId,
    cell.motionToken,
    cell.attireId,
    cell.backgroundId,
    cell.themeId,
    ...cell.propIds,
  ].filter((x): x is string => Boolean(x));
  const cellScope = new Set(
    railScope ? cellIds.filter((id) => railScope.has(id)) : cellIds,
  );
  const talent = scopedById(campaign, lib, cell.talentTakeId, cellScope);
  const hands = scopedById(campaign, lib, cell.handsId, cellScope);
  const motion = scopedById(campaign, lib, cell.motionToken, cellScope);
  const attire = scopedById(campaign, lib, cell.attireId, cellScope);
  const background = scopedById(campaign, lib, cell.backgroundId, cellScope);
  const theme = scopedById(campaign, lib, cell.themeId, cellScope);
  const props = cell.propIds
    .map((id) => scopedById(campaign, lib, id, cellScope))
    .filter((x): x is LibraryItem => Boolean(x));

  const brief: Brief = campaign.brief;
  const knob = pickKnob(cell, campaign);
  const videoPipeline = pickVideoPipeline(cell);
  const workflowId = workflowFor(knob, videoPipeline);
  const format =
    campaign.modelProfileId === "sdxl" || campaign.modelProfileId === "sd15"
      ? "sdxl"
      : "natural";
  const defaults = await loadModelDefaults(campaign.modelProfileId);
  const resolvedSize =
    size ||
    campaign.outputSizes?.[0] ||
    resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS])[0];
  const gen = genDimsForSize(resolvedSize);

  // Cell combo only — never dump the whole library / all actives
  const comboItems = {
    talent,
    hands: hands || null,
    attire: attire || null,
    background: background || null,
    theme: theme || null,
    props,
    motion: motion || null,
  };

  const parts: string[] = [];
  if (videoPipeline === "minimax_h3_r2v") {
    parts.push(
      "Use Video 1 as the exact spokesperson talking-head performance — preserve identity, face, body motion, and timing",
    );
    let img = 1;
    if (attire) {
      parts.push(
        `Image ${img} is wardrobe reference — dress the spokesperson in: ${phrase(attire)}`,
      );
      img += 1;
    }
    if (background) {
      parts.push(
        `Image ${img} is the environment / background — place them in: ${phrase(background)}`,
      );
      img += 1;
    }
    for (const p of props) {
      parts.push(`Image ${img} is a prop / product reference: ${phrase(p)}`);
      img += 1;
    }
    if (hands) {
      parts.push(
        `Image ${img} is hands / gesture / product-in-hands reference — match this hand performance: ${phrase(hands)}`,
      );
      img += 1;
    }
    if (cell.copy.setup) parts.push(`spoken hook energy: ${cell.copy.setup}`);
    if (cell.copy.punchline) parts.push(`punchline beat: ${cell.copy.punchline}`);
    if (brief.offer) parts.push(`offer context: ${brief.offer}`);
    parts.push(
      `photoreal paid-social ${resolvedSize.aspect} video, ${resolvedSize.width}x${resolvedSize.height}, clean composition, no text overlay`,
    );
  } else if (videoPipeline === "bria_replace") {
    parts.push(
      `Replace background of talent talking-head video with: ${phrase(background) || "rail background"}`,
    );
  } else {
    if (brief.prompt.trim()) parts.push(`campaign brief: ${brief.prompt.trim()}`);
    if (brief.offer) parts.push(`offer: ${brief.offer}`);
    if (brief.audience) parts.push(`audience: ${brief.audience}`);
    if (brief.cta) parts.push(`campaign CTA: ${brief.cta}`);
    if (brief.mustSay?.length) parts.push(`must say: ${brief.mustSay.join("; ")}`);
    if (cell.copy.setup) parts.push(`variant setup / hook: ${cell.copy.setup}`);
    if (cell.copy.punchline) parts.push(`variant punchline: ${cell.copy.punchline}`);
    if (talent) parts.push(`spokesperson (identity lock): ${phrase(talent)}`);
    if (hands) parts.push(`hands / product hero: ${phrase(hands)}`);
    if (attire) parts.push(`wardrobe: ${phrase(attire)}`);
    if (background) parts.push(`setting / background: ${phrase(background)}`);
    if (theme) parts.push(`theme: ${phrase(theme)}`);
    for (const p of props) parts.push(`${p.tags[0] || "prop"}: ${phrase(p)}`);
    if (knob === "hands" || knob === "prop") {
      parts.push(
        "close-up product-in-hands plate for paid social punchline beat, no full talking-head face",
      );
    } else if (knob === "attire") {
      parts.push(
        "spokesperson wardrobe plate, preserve face identity from reference, change clothing only",
      );
    } else if (knob === "background") {
      parts.push(
        "spokesperson in new setting, preserve face identity from reference, change environment only",
      );
    }
    parts.push(
      `${resolvedSize.aspect} paid social frame, ${resolvedSize.width}x${resolvedSize.height} delivery, photoreal, clean composition`,
    );
  }

  const positive = parts.filter(Boolean).join(". ").replace(/\.\./g, ".");

  const negBits = [
    ...brief.mustNot,
    comboItems.talent?.negativeHint,
    comboItems.hands?.negativeHint,
    comboItems.attire?.negativeHint,
    comboItems.background?.negativeHint,
    ...props.map((p) => p.negativeHint),
    "deformed hands",
    "extra fingers",
    "blurry face",
    "identity change",
    "face morph",
    "different person",
    "watermark",
    "logo artifacts",
    "text overlay",
  ].filter((x): x is string => Boolean(x && String(x).trim()));

  const negative = negBits.join(", ");

  const refs = [
    talent,
    videoPipeline === "still" ? hands : null,
    videoPipeline === "still" ? motion : null,
    attire,
    background,
    videoPipeline === "still" ? theme : null,
    ...props,
    videoPipeline !== "still" && hands && (knob === "hands" || knob === "prop")
      ? hands
      : null,
  ]
    .filter((x): x is LibraryItem => Boolean(x))
    .map((item) => {
      const def = getIngredientKind(item.kind);
      const patchKey = def.comfy.patchKey;
      return {
        kind: item.kind,
        id: item.id,
        label: item.label,
        path: item.path,
        mediaType: item.mediaType,
        patchKey,
        role: refRole(item.kind, patchKey),
      };
    });

  // Deterministic seed from content (cache-friendly); forceRegen can salt later
  const hashMaterial = {
    workflowId,
    videoPipeline,
    modelProfileId: campaign.modelProfileId,
    knob,
    sizeId: resolvedSize.id,
    genW: gen.width,
    genH: gen.height,
    positive,
    negative,
    talentTakeId: cell.talentTakeId,
    handsId: cell.handsId,
    attireId: cell.attireId,
    backgroundId: cell.backgroundId,
    themeId: cell.themeId,
    propIds: cell.propIds,
    motionToken: cell.motionToken,
    copy: cell.copy,
    brief: {
      prompt: brief.prompt,
      offer: brief.offer,
      audience: brief.audience,
      cta: brief.cta,
      mustSay: brief.mustSay,
      mustNot: brief.mustNot,
    },
  };
  const promptHash = createHash("sha256")
    .update(JSON.stringify(hashMaterial))
    .digest("hex")
    .slice(0, 24);
  const seed = parseInt(promptHash.slice(0, 8), 16) % 1_000_000;

  const patches: Record<string, unknown> = {
    prompt: positive,
    negative_prompt: negative,
    motionToken: cell.motionToken,
    seed,
    steps: defaults.steps,
    cfg: defaults.cfg,
    width: gen.width,
    height: gen.height,
    outputWidth: resolvedSize.width,
    outputHeight: resolvedSize.height,
    sizeId: resolvedSize.id,
    aspect: resolvedSize.aspect,
    language: "en",
    promptHash,
    videoPipeline,
    // Local library-relative paths — adapter resolves + uploads
    talentRef: talent?.path ?? null,
    productRef: hands?.path ?? props[0]?.path ?? null,
    wardrobeRef: attire?.path ?? null,
    backgroundRef: background?.path ?? null,
    wardrobeHint: attire ? phrase(attire) : undefined,
    backgroundHint: background ? phrase(background) : undefined,
    propHints: props.length ? props.map((p) => phrase(p)) : undefined,
    // Ordered still/video refs for MiniMax Image 1..N (attire → BG → props → hands)
    variantRefPaths: [
      attire?.path,
      background?.path,
      ...props.map((p) => p.path),
      hands?.path,
    ].filter((x): x is string => Boolean(x && String(x).trim())),
    targetDenoise: knob === "hands" || knob === "prop" ? 0.62 : 0.42,
    conditioningMode: videoPipeline === "still" ? "auto" : "video",
    ratio: aspectToRatio(resolvedSize.aspect),
    resolution: "768P",
    duration: 5,
  };

  if (talent?.locks) {
    patches.contractFlags = {
      face_locked: talent.locks.face_locked,
      voice_locked: talent.locks.voice_locked,
      performance_locked: talent.locks.performance_locked,
      touches_face: knob === "attire" || knob === "background",
      touches_voice: false,
    };
  }

  return PromptPackSchema.parse({
    language: "en",
    modelProfileId: campaign.modelProfileId,
    format,
    workflowId,
    knob,
    positive,
    negative,
    promptHash,
    patches,
    refs,
    context: {
      cellId: cell.cellId,
      sizeId: resolvedSize.id,
      briefPrompt: brief.prompt,
      offer: brief.offer || "",
      audience: brief.audience || "",
      cta: brief.cta || "",
      mustSay: brief.mustSay || [],
      copySetup: cell.copy.setup,
      copyPunchline: cell.copy.punchline,
      copyEndcard: cell.copy.endcard,
      copyCta: cell.copy.cta,
    },
  });
}

export type IngredientPromptPack = {
  modelProfileId: string;
  workflowId: string;
  knob: "hands" | "attire" | "background" | "prop";
  outputMode: IngredientOutputMode;
  videoPipeline: VideoPipeline;
  positive: string;
  negative: string;
  promptHash: string;
  patches: Record<string, unknown>;
  talent: LibraryItem | null;
  sourceTalentId: string | null;
};

function resolveTalentId(
  item: LibraryItem,
  campaign: Campaign | null,
  lib: LibraryItem[],
  explicit?: string | null,
): string | null {
  const candidates = [
    explicit,
    campaign?.ingredientSet?.contractTalentId,
    campaign?.rail?.hero?.talentTakeId,
    item.sourceTalentId,
  ].filter((x): x is string => Boolean(x && String(x).trim()));

  for (const id of candidates) {
    const hit = byId(lib, id);
    if (hit?.kind !== "talent") continue;
    if (campaign && !isIngredientActive(campaign, hit.id)) continue;
    return hit.id;
  }
  // Prefer an active talent already on the saved rail
  for (const id of campaign?.rail ? railReferencedIds(campaign.rail) : []) {
    const hit = byId(lib, id);
    if (hit?.kind === "talent" && isIngredientActive(campaign!, hit.id)) {
      return hit.id;
    }
  }
  const activeTalent = (campaign?.ingredientSet?.activeIds || [])
    .map((id) => byId(lib, id))
    .find((x) => x?.kind === "talent");
  if (activeTalent) return activeTalent.id;
  // No campaign / empty active set: last-resort ready talent
  if (!campaign || !(campaign.ingredientSet?.activeIds?.length)) {
    return lib.find((x) => x.kind === "talent" && x.status === "ready")?.id ?? null;
  }
  return null;
}

function knobForIngredient(kind: LibraryItem["kind"]): IngredientPromptPack["knob"] {
  if (kind === "attire") return "attire";
  if (kind === "background") return "background";
  if (kind === "prop") return "prop";
  return "hands";
}

/**
 * Campaign-aware prompt pack for generating / re-generating one library ingredient plate.
 * Folds brief, rail-scoped companions (active + rail-saved only), tokens, size, talent lock.
 */
export async function buildIngredientPromptPack(opts: {
  item: LibraryItem;
  campaign?: Campaign | null;
  modelProfileId?: string | null;
  sourceTalentId?: string | null;
  /** Salt seed when replacing an existing ready plate */
  forceRegen?: boolean;
  /** Default video — partner R2V / Bria when talent video is available. */
  outputMode?: IngredientOutputMode | null;
}): Promise<IngredientPromptPack> {
  const { item } = opts;
  const campaign = opts.campaign ?? null;
  const lib = await listLibrary(
    undefined,
    campaign?.libraryId || "default",
  );
  const knob = knobForIngredient(item.kind);
  const outputMode: IngredientOutputMode =
    opts.outputMode === "image" ? "image" : "video";

  const modelProfileId =
    opts.modelProfileId ||
    campaign?.modelProfileId ||
    process.env.COMFY_MODEL_PROFILE ||
    "sd15";

  const isBackground = item.kind === "background";
  /** Still BG plates stay talent-free; video BG needs talent MP4 as camera/POV ref. */
  const talentId = resolveTalentId(item, campaign, lib, opts.sourceTalentId);
  // Companions = active + saved-rail refs only (never every activeIds / library dump)
  const scope = new Set([...(railScopeSet(campaign) ?? []), item.id]);
  if (talentId) scope.add(talentId);

  let talent = scopedById(campaign, lib, talentId, scope);
  // Library BG video: fall back to any ready talent take for POV if campaign scope is empty
  if (isBackground && outputMode === "video" && !isVideoMedia(talent)) {
    talent =
      lib.find((i) => i.kind === "talent" && isVideoMedia(i) && isPlateReady(i)) ??
      null;
  }

  const sceneStill = isBackground && outputMode === "image";
  const hero = campaign?.rail?.hero;
  const hands = sceneStill
    ? null
    : scopedById(campaign, lib, hero?.handsId, scope) ||
      (item.kind === "hands" ? item : null);
  const attire = sceneStill
    ? null
    : scopedById(campaign, lib, hero?.attireId, scope) ||
      (item.kind === "attire" ? item : null);
  const background = sceneStill
    ? null
    : scopedById(campaign, lib, hero?.backgroundId, scope);
  const theme = sceneStill
    ? null
    : scopedById(campaign, lib, hero?.themeId, scope);
  const motion = sceneStill
    ? null
    : scopedById(campaign, lib, hero?.motionToken, scope);
  const props = sceneStill
    ? []
    : (hero?.propIds || [])
        .map((id) => scopedById(campaign, lib, id, scope))
        .filter((x): x is LibraryItem => Boolean(x));
  if (!sceneStill && item.kind === "prop" && !props.some((p) => p.id === item.id)) {
    props.unshift(item);
  }

  const brief: Brief | null = campaign?.brief ?? null;
  const size =
    campaign?.outputSizes?.[0] ||
    resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS])[0];
  const gen = genDimsForSize(size);

  // Preview pipeline early so we don't apply z_image cfg=1 to an SD1.5 still graph
  const videoPipelinePreview = pickIngredientVideoPipeline({
    kind: item.kind,
    outputMode,
    talentIsVideo: isVideoMedia(talent),
  });
  const defaultsProfile =
    videoPipelinePreview === "still" ? "sd15" : modelProfileId;
  const defaults = await loadModelDefaults(defaultsProfile);

  const operatorPrompt = item.promptHint?.trim() || "";
  const parts: string[] = [];
  const sceneLead =
    operatorPrompt ||
    `${item.kind} environment plate: ${item.label}${
      item.tags.length ? ` (${item.tags.join(", ")})` : ""
    }`;

  if (sceneStill) {
    // Still scene plate — prompt + frame (matrix later composites talent)
    parts.push(sceneLead);
    const allowPeople = sceneAllowsPeople(sceneLead);
    if (allowPeople) {
      parts.push(
        "cinematic establishing / environment plate for paid social, natural ambient life ok in mid/background, no on-screen text, no logos, no UI chrome",
      );
    } else {
      parts.push(
        "empty environment / establishing shot, no foreground people, no spokesperson, no talking head, no on-screen text",
      );
    }
    parts.push(
      "photoreal, modern cinema look, rich lighting, sharp detail, 35mm depth of field, high dynamic range — not vintage or low-res",
    );
    parts.push(
      `${size.aspect} frame, ${gen.width}x${gen.height} gen / ${size.width}x${size.height} delivery, clean composition`,
    );
    if (campaign?.name) parts.push(`campaign mood: ${campaign.name}`);
    if (brief?.prompt?.trim()) {
      parts.push(`brand world (setting only): ${brief.prompt.trim().slice(0, 220)}`);
    }
  } else if (isBackground && outputMode === "video") {
    // MiniMax POV plate — talent video is camera reference only
    parts.push(`ENVIRONMENT VIDEO PLATE: ${sceneLead}`);
    if (campaign?.name) parts.push(`campaign: ${campaign.name}`);
    if (brief?.prompt?.trim()) {
      parts.push(`brand world: ${brief.prompt.trim().slice(0, 180)}`);
    }
  } else {
    if (operatorPrompt) {
      parts.push(`OPERATOR PLATE PROMPT (primary): ${operatorPrompt}`);
    } else {
      parts.push(
        `generate ingredient plate (${item.kind}): ${item.label}${
          item.tags.length ? ` (${item.tags.join(", ")})` : ""
        }`,
      );
    }

    if (campaign?.name) parts.push(`campaign: ${campaign.name}`);
    if (brief?.prompt?.trim()) parts.push(`campaign brief: ${brief.prompt.trim()}`);
    if (brief?.offer) parts.push(`offer: ${brief.offer}`);
    if (brief?.audience) parts.push(`audience: ${brief.audience}`);
    if (brief?.cta) parts.push(`campaign CTA: ${brief.cta}`);
    if (brief?.mustSay?.length) parts.push(`must say: ${brief.mustSay.join("; ")}`);

    if (talent) parts.push(`spokesperson (identity lock): ${phrase(talent)}`);
    if (item.kind !== "hands" && hands && hands.id !== item.id) {
      parts.push(`hands / product hero: ${phrase(hands)}`);
    }
    if (item.kind !== "attire" && attire && attire.id !== item.id) {
      parts.push(`wardrobe: ${phrase(attire)}`);
    }
    if (item.kind !== "background" && background && background.id !== item.id) {
      parts.push(`setting / background: ${phrase(background)}`);
    }
    if (theme) parts.push(`theme: ${phrase(theme)}`);
    if (motion) parts.push(`motion energy: ${phrase(motion)}`);
    if (item.kind !== "prop") {
      for (const p of props) {
        if (p.id === item.id) continue;
        parts.push(`${p.tags[0] || "prop"}: ${phrase(p)}`);
      }
    }

    if (item.tags.length && operatorPrompt) {
      parts.push(`tags: ${item.tags.join(", ")}`);
    }

    const copySamples = (campaign?.rail?.allowedCopy || []).slice(0, 2);
    for (const copy of copySamples) {
      if (copy.setup) parts.push(`sample hook: ${copy.setup}`);
      if (copy.punchline) parts.push(`sample punchline: ${copy.punchline}`);
    }
  }

  // Subject path on disk — only treat uploaded stills as conditioning refs.
  const subjectPath = item.path || null;
  const subjectStillRef =
    subjectPath && item.mediaType === "image" ? subjectPath : null;
  const videoPipeline = videoPipelinePreview;
  const workflowId =
    videoPipeline !== "still"
      ? workflowFor(knob, videoPipeline)
      : getIngredientKind(item.kind).comfy.workflowId ??
        (knob === "attire"
          ? "talent_attire_v1"
          : knob === "background"
            ? "talent_bg_v1"
            : "hands_product_v1");

  if (
    outputMode === "video" &&
    variantVideoEnabled() &&
    !isVideoMedia(talent)
  ) {
    throw new Error(
      isBackground
        ? "Background Video needs a talent take with MP4 (camera / POV reference). Upload talent video, or generate Background as Image."
        : "Video plate generation needs a talent take with video media (upload a talking-head MP4, or switch Generate to Image)",
    );
  }

  if (videoPipeline === "minimax_h3_r2v" && isBackground) {
    const allowPeople = sceneAllowsPeople(sceneLead);
    parts.push(
      "Use Video 1 ONLY as seated eye-level camera / POV / micro-motion reference from a talking-head take — match lens height, framing distance, and subtle handheld energy",
    );
    parts.push(
      allowPeople
        ? "Do NOT show the Video 1 spokesperson. Fill the frame with the restaurant/environment; ambient staff or customers may appear mid/background only"
        : "Do NOT show the Video 1 spokesperson or any clear face in the foreground — empty seated POV into the environment",
    );
    parts.push(`Vibrant photoreal cinematic environment: ${sceneLead}`);
    parts.push(
      "Output a short environment B-roll plate for the ingredient library (not a talking-head)",
    );
  } else if (videoPipeline === "minimax_h3_r2v") {
    parts.push(
      "Use Video 1 as the exact spokesperson talking-head performance — preserve identity, face, body motion, and timing",
    );
    let img = 1;
    if (knob === "attire" && subjectStillRef) {
      parts.push(
        `Image ${img} is wardrobe reference — dress the spokesperson in: ${phrase(item)}`,
      );
      img += 1;
    } else if (knob === "attire") {
      parts.push(`Change wardrobe only: ${phrase(item)}`);
    }
    if ((knob === "hands" || knob === "prop") && subjectStillRef) {
      parts.push(`Image ${img} is a prop / product reference: ${phrase(item)}`);
    } else if (knob === "hands" || knob === "prop") {
      parts.push(
        `close-up product-in-hands plate for paid social punchline beat: ${phrase(item)}`,
      );
    }
    parts.push("Output a short talking-head video plate for the ingredient library");
  } else if (!sceneStill && (knob === "hands" || knob === "prop")) {
    parts.push(
      "close-up product-in-hands plate for paid social punchline beat, no full talking-head face",
    );
  } else if (!sceneStill && knob === "attire") {
    parts.push(
      "spokesperson wardrobe plate, preserve face identity from reference, change clothing only",
    );
  }

  if (!sceneStill) {
    parts.push(
      `${size.aspect} paid social frame, ${size.width}x${size.height} delivery, photoreal, clean composition`,
    );
    parts.push("English, photoreal plate for ATTATTA ingredient library");
  }

  const positive = parts.filter(Boolean).join(". ").replace(/\.\./g, ".");

  const scenePeopleOk =
    isBackground && sceneAllowsPeople(operatorPrompt || item.label);
  const negBits = sceneStill
    ? [
        item.negativeHint,
        ...(scenePeopleOk
          ? ["talking head close-up", "portrait selfie", "spokesperson facing camera"]
          : ["person", "people", "human", "face", "portrait", "talking head", "spokesperson"]),
        "text overlay",
        "watermark",
        "logo",
        "blurry",
        "low resolution",
        "jpeg artifacts",
        "cartoon",
        "anime",
        "plastic skin",
      ]
    : isBackground && videoPipeline === "minimax_h3_r2v"
      ? [
          item.negativeHint,
          "spokesperson face",
          "talking head close-up",
          "identity of Video 1 person",
          "same person as reference video",
          "portrait selfie",
          "text overlay",
          "watermark",
          "logo",
          "low resolution",
        ]
    : [
        ...(brief?.mustNot || []),
        item.negativeHint,
        talent?.negativeHint,
        hands?.negativeHint,
        attire?.negativeHint,
        background?.negativeHint,
        ...props.map((p) => p.negativeHint),
        "deformed hands",
        "extra fingers",
        "blurry face",
        "identity change",
        "face morph",
        "different person",
        "watermark",
        "logo artifacts",
        "text overlay",
      ];
  const negative = negBits
    .filter((x): x is string => Boolean(x && String(x).trim()))
    .join(", ");

  const hashMaterial = {
    workflowId,
    modelProfileId,
    knob,
    outputMode,
    videoPipeline,
    sceneStill,
    ingredientId: item.id,
    ingredientKind: item.kind,
    promptHint: item.promptHint,
    sizeId: size.id,
    talentId: talent?.id ?? talentId,
    campaignId: campaign?.id ?? null,
    hero: hero
      ? {
          talentTakeId: hero.talentTakeId,
          handsId: hero.handsId,
          attireId: hero.attireId,
          backgroundId: hero.backgroundId,
          themeId: hero.themeId,
          propIds: hero.propIds,
          motionToken: hero.motionToken,
        }
      : null,
    brief: brief
      ? {
          prompt: brief.prompt,
          offer: brief.offer,
          audience: brief.audience,
          cta: brief.cta,
          mustSay: brief.mustSay,
          mustNot: brief.mustNot,
        }
      : null,
    positive,
    negative,
  };
  let promptHash = createHash("sha256")
    .update(JSON.stringify(hashMaterial))
    .digest("hex")
    .slice(0, 24);
  if (opts.forceRegen) {
    promptHash = createHash("sha256")
      .update(`${promptHash}:${Date.now()}`)
      .digest("hex")
      .slice(0, 24);
  }
  const seed = parseInt(promptHash.slice(0, 8), 16) % 1_000_000;

  const wardrobeRef =
    item.kind === "attire" ? subjectStillRef : attire?.path ?? null;
  const backgroundRef =
    item.kind === "background" ? subjectStillRef : background?.path ?? null;
  const productRef =
    item.kind === "hands" || item.kind === "prop"
      ? subjectStillRef
      : hands?.path ?? null;

  // BG stills still run SD1.5 on Cloud — give them more steps than the 16 default.
  const steps =
    sceneStill && videoPipeline === "still"
      ? Math.max(defaults.steps ?? 16, 28)
      : defaults.steps;

  const patches: Record<string, unknown> = {
    prompt: positive,
    negative_prompt: negative,
    language: "en",
    seed,
    steps,
    cfg: defaults.cfg,
    width: gen.width,
    height: gen.height,
    outputWidth: size.width,
    outputHeight: size.height,
    sizeId: size.id,
    aspect: size.aspect,
    promptHash,
    forceRegen: Boolean(opts.forceRegen),
    outputMode,
    videoPipeline,
    talentRef: talent?.path ?? null,
    productRef,
    wardrobeRef,
    backgroundRef,
    wardrobeHint:
      attire ? phrase(attire) : item.kind === "attire" ? phrase(item) : undefined,
    backgroundHint: background
      ? phrase(background)
      : item.kind === "background"
        ? phrase(item)
        : undefined,
    propHints:
      item.kind === "prop"
        ? [phrase(item)]
        : props.length
          ? props.map((p) => phrase(p))
          : undefined,
    variantRefPaths: [
      item.kind === "attire" ? subjectStillRef : null,
      item.kind === "background" ? subjectStillRef : null,
      item.kind === "prop" || item.kind === "hands" ? subjectStillRef : null,
    ].filter((x): x is string => Boolean(x && String(x).trim())),
    targetDenoise: knob === "hands" || knob === "prop" ? 0.62 : 0.42,
    conditioningMode: videoPipeline === "still" ? "auto" : "video",
    // Fake loop only when operator asked for video but we fell back to still
    wrapMp4: outputMode === "video" && videoPipeline === "still",
    ratio: aspectToRatio(size.aspect),
    resolution: "768P",
    duration: 5,
    contractFlags: {
      face_locked: talent?.locks?.face_locked ?? talent?.contract?.face_locked ?? true,
      voice_locked: talent?.locks?.voice_locked ?? talent?.contract?.voice_locked ?? true,
      performance_locked:
        talent?.locks?.performance_locked ??
        talent?.contract?.performance_locked ??
        true,
      touches_face: knob === "attire" || knob === "background",
      touches_voice: false,
    },
  };

  return {
    modelProfileId,
    workflowId,
    knob,
    outputMode,
    videoPipeline,
    positive,
    negative,
    promptHash,
    patches,
    talent,
    sourceTalentId: talentId,
  };
}
