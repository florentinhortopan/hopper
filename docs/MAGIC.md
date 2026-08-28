# Magic campaign flow

Popup path: **Import → Prepare checklist → Variant plan → Generate → Celtra Package**. Full StepNav remains as **Advanced**, with **← Magic flow** to return.

Magic reuses **one** non-archived `mode: "magic"` campaign (latest updated) so Advanced edits stay in sync. Use “Start new Magic campaign” only when you intentionally want a fresh id.

## Package layout

Zip (or folder) may include:

| File | Purpose |
|------|---------|
| Media (mp4/png/…) | Library ingredients (classified on import) |
| `attatta.workflow.json` / `*.workflow.json` | ATTATTA workflow template |
| `workflow.url` | Single HTTPS URL to a workflow JSON |
| `manifest.json` / `attatta.manifest.json` | Optional `workflowUrl`, `brief`, template fields |
| `brief.json` | Prefill brief |

## Workflow JSON (ATTATTA-native)

```json
{
  "version": 1,
  "baseWorkflowId": "talent_variant_video_v1",
  "campaignGuidelines": "Photoreal talent lock; hands beat is generative.",
  "steps": [
    {
      "id": "hands",
      "label": "Hands plate",
      "patchKey": "prompt",
      "prompt": "Close-up product-in-hands, natural lighting",
      "ingredientId": null
    }
  ],
  "celtraTemplateProfileId": "guarantee_tranche3_social_video_v1",
  "outputSizeIds": ["v_9x16_1080", "v_4x5_1080", "sq_1x1_1080"],
  "brief": {
    "prompt": "Internet Backup peace of mind",
    "offer": "Backed by the AT&T Guarantee",
    "cta": "Learn More"
  }
}
```

Raw ComfyUI `api.json` graphs are **not** executed in Magic MVP — prepare falls back to AI/preset for workflow + copy.

## If no workflow in the package

`POST /campaigns/:id/magic/prepare` synthesizes `comfyTemplate` + copy + prompt hints from the brief (LLM when `ATTATTA_LLM_API_KEY` is set; otherwise `magic_att_v1` heuristics). Response includes:
- `gapsFilled` — readiness checklist (brief, workflow, talent, hands, copy, tokens, connectors, variants)
- `variants` — one row per sparse matrix cell (Generate list)

## API

- `POST /campaigns/magic` — `{ name?, libraryId?, forceNew?, campaignId? }` → `{ campaign, created }` (reuses latest magic by default)
- `GET /campaigns/:id/magic/plan` — snapshot checklist + variants (no LLM)
- `POST /campaigns/:id/magic/prepare` — `{ brief, importId?, workflowUrl?, workflowJson? }`
- `POST /campaigns/:id/magic/generate` — enqueue Comfy variants
- `POST /campaigns/:id/magic/workflow` — `{ url }` or `{ json }`
- `POST /campaigns/:id/package` — Celtra zip (unchanged)

## UI flow

1. **Import & categorize** — upload zip (same classify as Library). Review kind/label per file.
2. **Prepare checklist** — progressive checking UI; each row links to Advanced (Brief / Settings / Ingredients / Tokens / Matrix). Return via **← Magic flow**.
3. **Variant plan** — sparse matrix rows; Generate.
4. **Generate** — Comfy plates → Keep/Kill → Celtra package.
