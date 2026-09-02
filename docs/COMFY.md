# ComfyUI integration — capabilities & limits

**Related:** [LIVE-WORKSPACE.md](./LIVE-WORKSPACE.md) (live cockpit; Comfy publish events appear in Magic column)

ATTATTA’s generative path has two layers:

1. **Library plates** — upload or `POST /library/:id/generate` with `outputMode: "image" | "video"` (default **video**). Video uses the same Bria / MiniMax router as matrix when talent video is present; image is SD still. Plates are typically generated at the campaign **primary** size.
2. **Matrix / missing-size variants** — each matrix cell + **each selected Settings size** that needs a plate gets its own Comfy job at native gen dims (not a dumb crop of another aspect). Missing-size batch (`enqueueMissingSizeVariantBatch`) rebuilds prompts per size so talent/background are **recomposed** for 9:16 / 4:5 / 1:1 / 16:9.

**Where prompts live (runtime, not static files):**

- Built in `apps/orchestrator/src/promptPack.ts` (`buildPromptPack` for matrix cells, `buildIngredientPromptPack` for library plates).
- Aspect-aware framing + negatives: `apps/orchestrator/src/aspectFraming.ts` (headroom, safe zones, “recompose don’t crop”).
- Ingredient copy from `LibraryItem.promptHint` / `negativeHint`; campaign brief / comfy template / brand-look tokens fold in.
- Cache key: `promptHash` on size assets (includes size dims + prompt text).

**Design tokens** (Tokens step) dress Remotion end cards. Variant Comfy prompts also get a soft `Brand look:` clause from the campaign pack (`comfyStyleHints`, or auto-derived from colors/fonts). Import packs as ATTATTA JSON or CSS variables — not live Figma.

## Operator pipeline

```text
Ingredients / Library
  → Upload talent video (+ optional hands)
  → Activate BG / attire / prop plates on the rail

Rail → Matrix “Build from rail”
  → Sparse cells = variant list (Cartesian of open knobs)

Matrix “Generate variants”
  → POST /campaigns/:id/generate-variants
  → One Comfy VIDEO job per needsGen cell × size (native aspect framing)
  → Writes sizeAssets[].genPath (real MP4)

Matrix “generate variants” / Review “Assemble”

- **Comfy** = plates only (`genPath`). Recipe is never sent to Comfy.
- **Remotion** = single hi-res assemble using campaign **assembly recipe** (Settings)
  for scene list + duration on every size.
- **Variant review** = one **scene tag** per variant (which recipe beat the Comfy plate fills).
  Tags can also be set on **Matrix** (per row or batch); Variant review can override.
  Other beats use talent / hands / end card defaults on Assemble.

  → Remotion: `sceneMedia[]` from row slots + library / genPath
    · attire/background knob still writes cell genPath (plate)
    · slot `gen` → that plate plays in the chosen scene
    · `assemblyRecipe` → scene beats / total duration
```

## Video router (matrix)

| Cell contents | Pipeline | Workflow |
| --- | --- | --- |
| Background only (no attire/prop/hands) | Bria video replace | `talent_bg_video_v1` |
| Hands and/or attire and/or prop (± BG) | MiniMax H3 R2V | `talent_variant_video_v1` |
| `COMFY_VARIANT_VIDEO=0` | Legacy SD1.5 still + ffmpeg loop | `talent_bg_v1` / attire / hands |

**Bria:** talent talking-head **video** + BG image **or** BG video (exactly one). Preserves performance.

**MiniMax H3:** talent **video** as Video 1 + ingredient stills as Image 1..N + cell-scoped text prompt (wardrobe / setting / props). Partner API — spends Cloud credits.

## Prompt pack context

**Cell variant** (`buildPromptPack`): active ∩ rail-saved ∩ **this cell’s** ingredient ids only. Video-oriented positives for MiniMax (`Video 1` / `Image N` tags). Inspect: `GET /campaigns/:id/cells/:cellId/prompt-pack?sizeId=`.

## Env

| Var | Role |
| --- | --- |
| `COMFY_BASE_URL` | `https://cloud.comfy.org` or `http://127.0.0.1:8188` |
| `COMFY_API_KEY` | Cloud / org key (`X-API-Key`) |
| `COMFY_MODE` | `live` \| `auto` \| `stub` |
| `COMFY_VARIANT_VIDEO` | Default on. Set `0` for still fallback |
| `COMFY_MODEL_PROFILE` | Default profile for still graphs (`sd15`) |
| `COMFY_WRAP_MP4` | Force still→MP4 wrap (still path only) |
| `COMFY_WORKFLOWS_DIR` | Override workflows root |

## ATTATTA HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/comfy/status` | Short health + ready workflow ids |
| GET | `/comfy/capabilities` | Full design surface |
| POST | `/campaigns/:id/generate-variants` | **Matrix variant Comfy video** |
| POST | `/campaigns/:id/generate-plates` | Alias of generate-variants |
| POST | `/campaigns/:id/preview` | Remotion preview (`skipComfy` default true) |
| POST | `/library/:id/generate` | Library plate; body `outputMode`: `image` \| `video` (default video) |

## Workflows on disk

```text
comfy/workflows/
  talent_bg_video_v1/       cloud — Bria replace
  talent_variant_video_v1/  cloud — MiniMax H3 R2V
  talent_bg_v1/             sd15 still (fallback)
  talent_attire_v1/         sd15 still (fallback)
  hands_product_v1/         sd15 still (fallback)
```

## Hard limitations

1. Video partner nodes require Comfy Cloud + credits (Bria ~/sec, MiniMax per clip).
2. Talent media must be a real video file for Bria / MiniMax paths.
3. One Comfy video per cell **or library plate** @ primary size; Remotion scales to other deliveries — never N× Comfy per size.
4. Stub mode copies placeholders — never treat stub lineage as real gen.

## UI

- `/campaigns/:id/matrix` — Build from rail → Generate variants → Assemble
- `/campaigns/:id/ingredients` — Talent + ingredient activation
- `/library` — DAM

## Comfy Cloud MCP (Cursor agents)

Hosted MCP at `https://cloud.comfy.org/mcp`. Use for discovery / smoke tests. **Product pipeline stays on the orchestrator.**
