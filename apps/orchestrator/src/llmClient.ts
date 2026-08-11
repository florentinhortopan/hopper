import { readFile } from "node:fs/promises";
import {
  INGREDIENT_KINDS,
  LibraryKindSchema,
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
