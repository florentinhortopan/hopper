# Magic campaign flow

Popup path: **Import → Prepare checklist → Variant plan → Generate → Celtra Package**. Full StepNav remains as **Advanced**.

- **New Magic campaign** (home) always creates a **new** campaign.
- **Open Magic** on any campaign card, or **Magic flow** in StepNav, runs Magic on **that** campaign (standard campaigns get `mode: "magic"` when you enter).
- Modal header always shows **campaign name + id** so you know which campaign you’re on.

## Package layout

Zip (or folder) may include:

| File | Purpose |
|------|---------|
| Media (mp4/png/…) | Library ingredients (classified on import) |
| `attatta.workflow.json` / `*.workflow.json` | ATTATTA workflow template |
| `api.json` / `*.api.json` / Comfy API or canvas (`nodes`/`links`) graphs | Listed as **workflow** (not an ingredient kind). Sanity-checked. Raw graphs are **not executed** node-for-node. **BriaVideoReplaceBackground** graphs map to `talent_bg_video_v1` so BG-only combos use Bria; attire+BG still MiniMax |
| `workflow.url` | Single HTTPS URL to a workflow JSON |
| `manifest.json` / `attatta.manifest.json` | Optional `workflowUrl`, `brief`, template fields |
| `brief.json` | Prefill brief |

## Combos: Hopper select → Magic generate

1. **Prepare** builds a **full cartesian** sparse matrix from active ingredients (e.g. `none|attire` × each background when both kinds are active).
2. **Hopper** owns combo checkboxes (`selectedForGen`). Chat prompts you to pick combinations when ingredients/matrix land.
3. **Magic** generation matrix lists **selected** combos only and updates when Hopper toggles.
4. **Generate** queues only `needsGen && selectedForGen` cells (per Settings sizes).

Odd pairings stay available unchecked; sensible pairings (baker×restaurant, swimsuit×beach) are operator-selected. Rows with **attire original** (null attire + background) use Bria BG replace and keep the talent take as filmed.

Pipelines (unchanged picker):

- BG-only cell → Bria (`talent_bg_video_v1`)
- Attire / prop / hands on the cell → MiniMax blend (`talent_variant_video_v1`)

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

Raw ComfyUI graphs are **not** executed node-for-node. Bria BG-replace graphs map to `talent_bg_video_v1`; other graphs fall back to AI/preset for workflow + copy.

## If no workflow in the package

`POST /campaigns/:id/magic/prepare` synthesizes `comfyTemplate` + copy + prompt hints from the brief (LLM when `ATTATTA_LLM_API_KEY` is set; otherwise `magic_att_v1` heuristics). Response includes:
- `gapsFilled` — readiness checklist (brief, workflow, talent, hands, copy, tokens, connectors, variants)
- `variants` — selected sparse matrix cells (Generate list; Hopper `selectedForGen`)

## API

- `POST /campaigns/magic` — `{ name?, libraryId?, campaignId? }` → `{ campaign, created, promoted }`
  - with `campaignId`: attach Magic to that campaign
  - without: create a new magic campaign
- `GET /campaigns/:id/magic/plan` — snapshot checklist + variants (no LLM)
- `POST /campaigns/:id/magic/prepare` — `{ brief, importId?, workflowUrl?, workflowJson? }`
- `POST /campaigns/:id/magic/generate` — enqueue Comfy variants
- `POST /campaigns/:id/magic/workflow` — `{ url }` or `{ json }`
- `POST /campaigns/:id/package` — Celtra zip (unchanged)

## UI flow

1. **Import & categorize** — upload zip (same classify as Library). Review kind/label per file.
2. **Prepare checklist** — progressive checking UI; each row links to Advanced (Brief / Settings / Ingredients / Tokens / Matrix). Package activations only (not full library). Missing kinds highlighted as AI/workflow fill. Return via **Magic flow** on StepNav.
3. **Variant plan** — sparse matrix from **uploaded** activations only; Generate.
4. **Generate** — Comfy plates → Keep/Kill → Celtra package.
