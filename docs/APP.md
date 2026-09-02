# ATTATTA App — Slice A runbook

**Status:** Slice A + library/campaign hygiene  
**Related:** [PRD.md](./PRD.md) · [UX-UI.md](./UX-UI.md) · [WORKFLOW-UX-INTEGRATION.md](./WORKFLOW-UX-INTEGRATION.md) · [LIVE-WORKSPACE.md](./LIVE-WORKSPACE.md)

## What ships

- Local Next.js cockpit + orchestrator API  
- **Live Workspace** (`/campaigns/:id/live`) — 3-column Magic | Hopper | Celtra preview with SSE event bus (see [LIVE-WORKSPACE.md](./LIVE-WORKSPACE.md))  
- Brief, design tokens, ingredient rail, sparse matrix  
- Remotion preview/final for `paid-social-9x16-v1` (setup → punchline → end card)  
- Review board (Keep / Kill / re-render)  
- Celtra package zip (`matrix.json` + approved mp4s)  
- **Comfy → Remotion pipeline**: matrix preview/build runs prompt pack → Comfy still (+ MP4 wrap) → Remotion assemble; see [COMFY.md](./COMFY.md) + `/comfy`  

- **Library admin** (`/library`): global DAM — talent, hands, motion, attire, background, prop, theme; **prompt-only drafts** (no upload required); Generate plate via Comfy stub  
- **Campaign settings**: Meta size stack — default **9:16 + 4:5**; recommended pack also **1:1**; **16:9** optional (in-stream). Matrix/queue list cell×size; preview flips sizes  

- **Campaign ingredients** step: activate/deactivate library items per campaign; talent **contract** gates (attire/BG/props/hands); optional require-ready-media  
- **Decoupled lifecycle**: ingredient create/gen (diffusion) ≠ final assemble (Remotion)  
- **Activations → matrix**: Rail step dissolved; internal rail is derived from activated ingredients (2+ of a kind fans). Copy is a library plate kind. Prompt pack preview lives on Matrix.  
- **Prompt pack**: English model-ready packs for `sd15` / `z_image_turbo` / `sdxl` / `flux_schnell`  
- **Campaign hygiene**: rename, archive/unarchive, delete  

## Comfy live gen

- Full surface: [COMFY.md](./COMFY.md) · UI `/comfy` · `GET /comfy/capabilities`  
- `COMFY_MODE=live|auto|stub` — `auto` uses Comfy when reachable, else stub  
- Default free profile: **`sd15`** (`v1-5-pruned-emaonly-fp16` on Comfy Cloud)  
- Matrix **Generate + preview/build** = Comfy per cell×size then Remotion  
- Still plates → short MP4 via ffmpeg; talent talking-head still from library MP4  

## Still deferred

- Z-Image-Turbo / FLUX API graphs authored per profile  
- Face-protect IPAdapter maps for attire/BG  
- Native CogVideo / LTX video workflows (stills + Remotion for now)  
- LLM brief/copy/cohesion · Frame.io / Celtra API  

## Run

```bash
pnpm install
pnpm seed
pnpm dev
```

- Web: http://localhost:3000 · Library: http://localhost:3000/library  
- API: http://127.0.0.1:8787/health  

## Remotion note

Finals assemble **library talent MP4** + **Comfy-generated hands/product plate** (or library fallback) + copy/tokens. Empty plate src still shows a labeled fallback.

## Acceptance

Operator can manage ingredients, keep multiple campaign briefs, and produce **≥1 approved** 9:16 MP4 + `matrix.json` zip without opening ComfyUI.
