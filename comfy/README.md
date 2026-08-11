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
