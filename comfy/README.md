# Comfy assets (model-agnostic)

ATTATTA does **not** hardcode a diffusion model in app logic.  
It resolves a **model profile** → a versioned **workflow API JSON** → `ComfyAdapter` patches.

**Live default:** `sd15` (free SD 1.5 fp16) against Comfy Cloud or local ComfyUI.

## Layout

```text
comfy/
  models.registry.json          # profiles: sd15 (default), z_image_turbo, sdxl, flux_schnell
  workflows/
    hands_product_v1/
      manifest.json
      sd15.api.json / sd15.map.json   # shipped — works on Comfy Cloud today
      z_image_turbo.map.json          # TODO api.json
```

## Run live

1. `.env`: `COMFY_BASE_URL=https://cloud.comfy.org`, `COMFY_API_KEY=…`, `COMFY_MODE=live`, `COMFY_MODEL_PROFILE=sd15`  
2. `pnpm dev:api` → `GET /comfy/status` should show `health.ok: true`  
3. `POST /comfy/test-generate` or Library → Generate plate  
4. Outputs land in `data/library/gen/<knob>/` (+ lineage JSON); hands stills wrap to MP4 via ffmpeg  

## Swap models

1. Set `COMFY_MODEL_PROFILE=sd15` (default) or another profile with a matching `.api.json`.  
2. Adapter loads `workflows/<workflowId>/<profileId>.api.json` + `.map.json`, falling back to `COMFY_MODEL_FALLBACK_PROFILE`.  

Operators never pick UNET files. They pick (or inherit) a **profile label**. Creative techs author one API graph per profile they want to support.

## Designer publish → ATTATTA Library

Designers fine-tune in ComfyUI, then push the finished plate into ATTATTA so marketers see it on **Ingredients** (Advanced) and **Magic**.

### Orchestrator

- `POST /webhooks/comfy-publish` — multipart `file` + `kind`, `label`, optional `libraryId`, `campaignId`, `replacesId`, `activate`, `tags`, `promptHint`
- Auth header `X-Attatta-Publish-Key` when `ATTATTA_COMFY_PUBLISH_KEY` is set (open if unset, for local)
- `GET /webhooks/comfy-publish/recent` — poll for UI banners

With `campaignId` + `activate=true` (default), the plate is added to that campaign’s activations (both Advanced and Magic).

### ComfyUI custom node

```text
comfy/custom_nodes/attatta_publish/
```

Install (symlink into your ComfyUI `custom_nodes/`), restart Comfy:

```bash
ln -s "$(pwd)/comfy/custom_nodes/attatta_publish" \
  /path/to/ComfyUI/custom_nodes/attatta_publish
```

Add **ATTATTA Publish Ingredient** as the last node. Connect IMAGE (or set `file_path` to a saved mp4). Set:

| Field | Example |
|-------|---------|
| `attatta_base_url` | `http://127.0.0.1:8787` (or Railway public API) |
| `publish_key` | same as `ATTATTA_COMFY_PUBLISH_KEY` |
| `kind` | `background` / `hands` / … |
| `campaign_id` | campaign uuid (optional — auto-activate) |
| `replaces_id` | existing ingredient id to overwrite media (optional — same label or identical bytes auto-update) |

Without `replaces_id`, publish **reuses** an existing plate when the media SHA-256 matches or the **kind + label** already exists (updates in place instead of stacking duplicates).

Env shortcuts inside Comfy: `ATTATTA_BASE_URL`, `ATTATTA_COMFY_PUBLISH_KEY`.

