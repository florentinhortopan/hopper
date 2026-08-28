# Magic campaign flow

Two-step popup path: **Import → Generate**, then Celtra Package. Full StepNav remains as **Advanced**.

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

Raw ComfyUI `api.json` graphs are **not** executed in Magic MVP — checklist falls back to AI/preset.

## If no workflow in the package

`POST /campaigns/:id/magic/prepare` synthesizes `comfyTemplate` + copy + prompt hints from the brief (LLM when `ATTATTA_LLM_API_KEY` is set; otherwise `magic_att_v1` heuristics). Checklist rows show source: `imported` | `url` | `ai` | `preset`.

## API

- `POST /campaigns/magic` — create `mode: "magic"` campaign
- `POST /campaigns/:id/magic/prepare` — `{ brief, importId?, workflowUrl?, workflowJson? }`
- `POST /campaigns/:id/magic/generate` — enqueue Comfy variants
- `POST /campaigns/:id/magic/workflow` — `{ url }` or `{ json }`
- `POST /campaigns/:id/package` — Celtra zip (unchanged)

## UI

Home → **Magic campaign** opens the popup. Campaign list badges Magic campaigns. StepNav shows **Magic · Advanced** when `mode === "magic"`.
