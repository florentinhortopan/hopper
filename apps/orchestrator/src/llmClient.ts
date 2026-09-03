import { readFile } from "node:fs/promises";
import {
  INGREDIENT_KINDS,
  LibraryKindSchema,
  MAGIC_COMFY_TEMPLATE,
  heuristicCopyFromBrief,
  normalizeComfyTemplate,
  type Brief,
  type ComfyTemplate,
  type Copy,
  type LibraryKind,
} from "@attatta/shared";

export type ClassifyResult = {
  kind: LibraryKind;
  label: string;
  tags: string[];
  promptHint: string;
  confidence: number;
  rationale: string;
};

function llmConfigured() {
  return Boolean(process.env.ATTATTA_LLM_API_KEY?.trim());
}

export function getLlmStatus() {
  return {
    configured: llmConfigured(),
    baseUrl: process.env.ATTATTA_LLM_BASE_URL || "https://api.openai.com/v1",
    model: process.env.ATTATTA_LLM_VISION_MODEL || "gpt-4o-mini",
  };
}

export type LiveRouteResult = {
  intent:
    | "prepare"
    | "generate"
    | "package"
    | "keep"
    | "kill"
    | "brief"
    | "note"
    | "unknown";
  column: "magic" | "hopper" | "celtra";
  cellId?: string;
  text?: string;
  source: "llm" | "heuristic" | "slash";
  rationale: string;
};

/** Shared live-chat router for workspace / future Teams·Slack adapters. */
export function heuristicRouteLiveChat(raw: string): LiveRouteResult {
  const text = raw.trim();
  if (!text) {
    return {
      intent: "unknown",
      column: "hopper",
      source: "heuristic",
      rationale: "Empty message",
    };
  }
  if (text.startsWith("/")) {
    const [cmdRaw, ...rest] = text.slice(1).split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    const arg = rest.join(" ").trim();
    if (cmd === "prepare" || cmd === "recheck") {
      return {
        intent: "prepare",
        column: "magic",
        source: "slash",
        rationale: "Slash prepare",
      };
    }
    if (cmd === "generate" || cmd === "gen") {
      return {
        intent: "generate",
        column: "magic",
        source: "slash",
        rationale: "Slash generate",
      };
    }
    if (cmd === "package" || cmd === "pack") {
      return {
        intent: "package",
        column: "celtra",
        source: "slash",
        rationale: "Slash package",
      };
    }
    if ((cmd === "keep" || cmd === "kill") && arg) {
      return {
        intent: cmd,
        column: "hopper",
        cellId: arg,
        source: "slash",
        rationale: `Slash ${cmd}`,
      };
    }
    if (cmd === "brief" && arg) {
      return {
        intent: "brief",
        column: "magic",
        text: arg,
        source: "slash",
        rationale: "Slash brief",
      };
    }
    if (cmd === "magic" || cmd === "hopper" || cmd === "celtra") {
      return {
        intent: "note",
        column: cmd,
        text: arg || text,
        source: "slash",
        rationale: `Slash column ${cmd}`,
      };
    }
    if (cmd === "note") {
      return {
        intent: "note",
        column: "hopper",
        text: arg || text,
        source: "slash",
        rationale: "Slash note",
      };
    }
    return {
      intent: "unknown",
      column: "hopper",
      text,
      source: "slash",
      rationale: "Unknown slash command",
    };
  }
  const lower = text.toLowerCase();
  if (/\b(prepare|re-?check|import)\b/.test(lower)) {
    return {
      intent: "prepare",
      column: "magic",
      source: "heuristic",
      rationale: "Keyword prepare",
    };
  }
  if (/\b(generate|gen\b|run comfy|fill sizes)\b/.test(lower)) {
    return {
      intent: "generate",
      column: "magic",
      source: "heuristic",
      rationale: "Keyword generate",
    };
  }
  if (/\b(package|celtra|export zip|download pack)\b/.test(lower)) {
    return {
      intent: "package",
      column: "celtra",
      source: "heuristic",
      rationale: "Keyword package",
    };
  }
  if (/\b(brief|offer|audience|cta)\b/.test(lower)) {
    return {
      intent: "brief",
      column: "magic",
      text,
      source: "heuristic",
      rationale: "Keyword brief",
    };
  }
  if (/\b(keep|kill|review|approve|reject)\b/.test(lower)) {
    return {
      intent: "note",
      column: "hopper",
      text,
      source: "heuristic",
      rationale: "Keyword review → Hopper note",
    };
  }
  return {
    intent: "note",
    column: "hopper",
    text,
    source: "heuristic",
    rationale: "Default workspace note",
  };
}

/** LLM-assisted routing; falls back to heuristics when unavailable. */
export async function routeLiveChatMessage(
  raw: string,
): Promise<LiveRouteResult> {
  const text = raw.trim();
  if (!text || text.startsWith("/")) {
    return heuristicRouteLiveChat(text);
  }
  const heur = heuristicRouteLiveChat(text);
  if (!llmConfigured()) return heur;

  const parsed = await chatJson({
    system:
      "You route ATTATTA live-workspace chat to Magic, Hopper, or Celtra. JSON only.",
    user: `Message: ${text}

Return JSON:
{"intent":"prepare|generate|package|keep|kill|brief|note","column":"magic|hopper|celtra","cellId":"optional","text":"optional note/brief body","rationale":"one short sentence"}

Rules:
- prepare/recheck/import → prepare + magic
- generate/comfy/fill sizes → generate + magic
- package/celtra zip → package + celtra
- keep/kill need cellId when obvious from the message
- brief/offer copy → brief + magic
- otherwise note on the best column`,
    temperature: 0.1,
  });

  if (!parsed) return heur;
  const intent = String(parsed.intent || heur.intent);
  const columnRaw = String(parsed.column || heur.column);
  const column =
    columnRaw === "magic" || columnRaw === "hopper" || columnRaw === "celtra"
      ? columnRaw
      : heur.column;
  const allowed = new Set([
    "prepare",
    "generate",
    "package",
    "keep",
    "kill",
    "brief",
    "note",
    "unknown",
  ]);
  if (!allowed.has(intent)) return heur;
  return {
    intent: intent as LiveRouteResult["intent"],
    column,
    cellId: parsed.cellId ? String(parsed.cellId) : undefined,
    text: parsed.text ? String(parsed.text) : text,
    source: "llm",
    rationale: String(parsed.rationale || "LLM route").slice(0, 200),
  };
}

const KIND_CATALOG = INGREDIENT_KINDS.map(
  (k) => `- ${k.id}: ${k.description} (examples: ${k.examples.join(", ")})`,
).join("\n");

function heuristicKind(filename: string): { kind: LibraryKind; confidence: number } {
  const n = filename.toLowerCase();
  if (/talent|spokesperson|talking.?head|bust/.test(n))
    return { kind: "talent", confidence: 0.45 };
  if (/hand|gesture|phone.?tap|swipe|product.?hold/.test(n))
    return { kind: "hands", confidence: 0.45 };
  if (/attire|wardrobe|hoodie|jacket|shirt|outfit/.test(n))
    return { kind: "attire", confidence: 0.45 };
  if (/bg|background|scene|location|env|pizza|camp/.test(n))
    return { kind: "background", confidence: 0.45 };
  if (/prop|hat|ribbon|product/.test(n)) return { kind: "prop", confidence: 0.4 };
  if (/motion|camera.?move/.test(n)) return { kind: "motion", confidence: 0.4 };
  return { kind: "prop", confidence: 0 };
}

function labelFromFilename(filename: string) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Classify a media file using vision LLM when configured; else filename heuristics. */
export async function classifyIngredientMedia(opts: {
  filename: string;
  /** Absolute paths to 1–3 still frames (or the image itself). */
  framePaths: string[];
}): Promise<ClassifyResult> {
  const heur = heuristicKind(opts.filename);
  const label = labelFromFilename(opts.filename) || opts.filename;

  if (!llmConfigured() || !opts.framePaths.length) {
    return {
      kind: heur.kind,
      label,
      tags: [],
      promptHint: label,
      confidence: heur.confidence,
      rationale: llmConfigured()
        ? "No frames extracted — filename heuristic only"
        : "LLM not configured (ATTATTA_LLM_API_KEY) — filename heuristic only",
    };
  }

  const baseUrl = (
    process.env.ATTATTA_LLM_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = process.env.ATTATTA_LLM_VISION_MODEL || "gpt-4o-mini";
  const apiKey = process.env.ATTATTA_LLM_API_KEY!;

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `You categorize production media into ATTATTA ingredient kinds for paid social ads.

Kinds:
${KIND_CATALOG}

Filename: ${opts.filename}
Filename hint kind: ${heur.kind}

Return ONLY JSON:
{"kind":"talent|hands|attire|background|prop|motion|theme","label":"short human label","tags":["…"],"promptHint":"English phrase for image models","confidence":0.0-1.0,"rationale":"one sentence"}`,
    },
  ];

  for (const fp of opts.framePaths.slice(0, 3)) {
    try {
      const buf = await readFile(fp);
      const b64 = buf.toString("base64");
      const mime = fp.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      content.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${b64}` },
      });
    } catch {
      /* skip missing frame */
    }
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a media librarian for an advertising DAM. Respond with JSON only.",
          },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const kindParsed = LibraryKindSchema.safeParse(parsed.kind);
    const kind = kindParsed.success ? kindParsed.data : heur.kind;
    // Prefer LLM unless it contradicts a strong filename heuristic with low confidence
    const confidence = Math.min(
      1,
      Math.max(0, Number(parsed.confidence) || 0.5),
    );
    return {
      kind: confidence < 0.35 && heur.confidence >= 0.45 ? heur.kind : kind,
      label: String(parsed.label || label).slice(0, 120),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map(String).slice(0, 12)
        : [],
      promptHint: String(parsed.promptHint || label).slice(0, 400),
      confidence,
      rationale: String(parsed.rationale || "").slice(0, 300),
    };
  } catch (err) {
    return {
      kind: heur.kind,
      label,
      tags: [],
      promptHint: label,
      confidence: heur.confidence,
      rationale: `LLM failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function chatJson(opts: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<Record<string, unknown> | null> {
  if (!llmConfigured()) return null;
  const baseUrl = (
    process.env.ATTATTA_LLM_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.ATTATTA_LLM_TEXT_MODEL ||
    process.env.ATTATTA_LLM_VISION_MODEL ||
    "gpt-4o-mini";
  const apiKey = process.env.ATTATTA_LLM_API_KEY!;
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Synthesize campaign Comfy template guidelines + steps from brief. */
export async function synthesizeComfyTemplateFromBrief(
  brief: Brief,
): Promise<{ template: ComfyTemplate; source: "ai" | "preset"; rationale: string }> {
  const parsed = await chatJson({
    system:
      "You write ComfyUI prompt guidelines for paid-social video ads. JSON only.",
    user: `Brief:
prompt: ${brief.prompt}
audience: ${brief.audience}
offer: ${brief.offer}
cta: ${brief.cta}
mustSay: ${(brief.mustSay || []).join("; ")}
mustNot: ${(brief.mustNot || []).join("; ")}

Return JSON:
{"campaignGuidelines":"2-4 sentences","steps":[{"id":"string","label":"string","patchKey":"prompt","prompt":"string"}],"rationale":"one sentence"}
Prefer 2-3 steps. patchKey usually "prompt". One step may use patchKey "duration" with prompt "4".`,
  });

  if (!parsed) {
    return {
      template: normalizeComfyTemplate(MAGIC_COMFY_TEMPLATE),
      source: "preset",
      rationale: "LLM unavailable — magic_att_v1 preset template",
    };
  }

  const stepsRaw = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps = stepsRaw.slice(0, 6).map((s, i) => {
    const row = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      id: String(row.id || `step_${i + 1}`).slice(0, 40),
      label: String(row.label || `Step ${i + 1}`).slice(0, 80),
      patchKey: String(row.patchKey || "prompt").slice(0, 40),
      prompt: String(row.prompt || "").slice(0, 600),
      ingredientId: null as string | null,
    };
  });

  return {
    template: normalizeComfyTemplate({
      baseWorkflowId: "talent_variant_video_v1",
      campaignGuidelines: String(
        parsed.campaignGuidelines || MAGIC_COMFY_TEMPLATE.campaignGuidelines,
      ).slice(0, 1200),
      steps: steps.length ? steps : MAGIC_COMFY_TEMPLATE.steps,
    }),
    source: "ai",
    rationale: String(parsed.rationale || "Synthesized from brief").slice(0, 300),
  };
}

/** Draft 2–3 copy plates from brief. */
export async function draftCopyFromBrief(
  brief: Brief,
): Promise<{ copies: Copy[]; source: "ai" | "preset"; rationale: string }> {
  const parsed = await chatJson({
    system: "You write short paid-social ad copy. JSON only.",
    user: `Brief:
prompt: ${brief.prompt}
audience: ${brief.audience}
offer: ${brief.offer}
cta: ${brief.cta}
mustSay: ${(brief.mustSay || []).join("; ")}

Return JSON:
{"variants":[{"setup":"max 35 chars","punchline":"max 35 chars","endcard":"max 77 chars","cta":"short"}],"rationale":"one sentence"}
Provide 2 or 3 variants. Respect mustSay when present.`,
  });

  if (!parsed || !Array.isArray(parsed.variants) || !parsed.variants.length) {
    return {
      copies: heuristicCopyFromBrief(brief),
      source: "preset",
      rationale: "LLM unavailable — heuristic copy from brief",
    };
  }

  const copies: Copy[] = parsed.variants.slice(0, 3).map((v) => {
    const row = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return {
      setup: String(row.setup || brief.prompt).slice(0, 80),
      punchline: String(row.punchline || brief.offer || brief.prompt).slice(0, 80),
      endcard: String(row.endcard || brief.offer || brief.prompt).slice(0, 77),
      cta: String(row.cta || brief.cta || "Learn more").slice(0, 40),
    };
  });

  return {
    copies,
    source: "ai",
    rationale: String(parsed.rationale || "Drafted from brief").slice(0, 300),
  };
}

/** Fill empty prompt hints for library items. */
export async function draftPromptHints(
  brief: Brief,
  items: Array<{ id: string; kind: string; label: string; promptHint: string }>,
): Promise<{
  hints: Record<string, string>;
  source: "ai" | "preset";
  rationale: string;
}> {
  const needing = items.filter((i) => !i.promptHint?.trim());
  if (!needing.length) {
    return { hints: {}, source: "preset", rationale: "All hints already set" };
  }

  const parsed = await chatJson({
    system: "You write English image/video model prompt hints. JSON only.",
    user: `Campaign brief: ${brief.prompt} / offer: ${brief.offer}
Ingredients needing hints:
${needing.map((i) => `- ${i.id} (${i.kind}): ${i.label}`).join("\n")}

Return JSON:
{"hints":{"<id>":"short English visual phrase"},"rationale":"one sentence"}`,
  });

  if (!parsed || typeof parsed.hints !== "object" || !parsed.hints) {
    const hints: Record<string, string> = {};
    for (const i of needing) {
      hints[i.id] = `${i.kind}: ${i.label} for ${brief.offer || brief.prompt}`.slice(
        0,
        200,
      );
    }
    return {
      hints,
      source: "preset",
      rationale: "LLM unavailable — label-based hints",
    };
  }

  const hints: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.hints as Record<string, unknown>)) {
    hints[k] = String(v).slice(0, 400);
  }
  return {
    hints,
    source: "ai",
    rationale: String(parsed.rationale || "Hints from brief").slice(0, 300),
  };
}
