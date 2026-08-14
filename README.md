# ATTATTA

Local **Celtra hopper**: assemble modular paid-social video variants from approved ingredients, review them, and export a Celtra-ready package.

Assemble-first Remotion hopper + library/campaign management. **Live Comfy** defaults to free **SD 1.5** on Comfy Cloud (`COMFY_MODE=live`).

## Docs

- [docs/PRODUCT-PRD.md](docs/PRODUCT-PRD.md) — concise product PRD  
- [docs/UX-PRD.md](docs/UX-PRD.md) — UX PRD (flows, roadmap, improvements)  
- [docs/APP.md](docs/APP.md) — app runbook (what ships)  
- [docs/PRD.md](docs/PRD.md) — long-form product detail  
- [docs/UX-UI.md](docs/UX-UI.md) — screen-by-screen operator UX  
- [docs/CELTRA.md](docs/CELTRA.md) — Celtra = distribution only  

## Requirements

- Node 20+
- pnpm 10+
- ffmpeg (for `pnpm seed` placeholder clips)
- Remotion (scaffolded). **Company use may require a [Remotion license](https://www.remotion.pro/license).**

## Quick start

```bash
pnpm install
pnpm seed          # library clips + demo_spring campaign
pnpm dev           # API :8787 + web :3000
```

Open [http://localhost:3000](http://localhost:3000).

### Happy path

1. **Library** — create global ingredients (upload, prompt-only draft, or **copy** lines).  
2. Open a campaign → **Ingredients** — activate plates (2+ of a kind fans that axis; copy plates fan messaging).  
3. **Brief → Tokens → Matrix** — Build from activations; Preview model prompt; generate Comfy variants.
4. **Settings** assembly recipe (scene list + duration) → **Variant review** → **Review** → Assemble (Remotion uses the recipe) → Keep → **Package**.
5. **Package** → download Celtra zip (`matrix.json` + mp4s).

## Monorepo

| Path | Role |
|------|------|
| `apps/web` | Next.js operator UI |
| `apps/orchestrator` | Local API + Remotion jobs + Celtra zip |
| `packages/shared` | Zod schemas |
| `packages/remotion-template` | `paid-social-9x16-v1` composition |
| `comfy/` | Model registry (Z-Image-Turbo default) — Slice B |
| `data/` | Library, campaigns, packages |

## Env / API keys

Copy [`.env.example`](.env.example) → **`.env`** at the repo root (gitignored). The orchestrator loads that file on boot. The Next app also reads **`apps/web/.env.local`** for web-only vars.

### Required for live generation

| Variable | Where | What |
|----------|--------|------|
| `COMFY_API_KEY` | root `.env` | [Comfy Platform](https://platform.comfy.org) API key (`X-API-Key` for Comfy Cloud). Without it, Comfy falls back to stub / local-only depending on `COMFY_MODE`. |

Typical Comfy Cloud setup in `.env`:

```bash
COMFY_API_KEY=comfyui-...
COMFY_BASE_URL=https://cloud.comfy.org
COMFY_MODE=auto          # live if reachable, else stub
COMFY_MODEL_PROFILE=sd15 # free SD 1.5 default
```

You can point `COMFY_BASE_URL` at a local ComfyUI (`http://127.0.0.1:8188`) instead; the key is still used when the server expects it.

### Web UI (local / Vercel)

| Variable | Where | What |
|----------|--------|------|
| `NEXT_PUBLIC_API_URL` | `apps/web/.env.local` (and Vercel) | Orchestrator base URL. Default `http://127.0.0.1:8787`. |
| `SITE_PASSWORD` | `apps/web/.env.local` (and Vercel) | Shared password for the login wall. **Leave empty locally** to skip the gate. Set the same value in Vercel for a deployed UI. |

### Optional — library import / categorize

Not needed for matrix assemble or Remotion. Only if you use batch import features:

| Variable | What |
|----------|------|
| `ATTATTA_LLM_API_KEY` | Vision LLM for auto-categorizing import media (OpenAI-compatible). |
| `ATTATTA_LLM_BASE_URL` | Default `https://api.openai.com/v1`. |
| `ATTATTA_LLM_VISION_MODEL` | Default `gpt-4o-mini`. |
| `DROPBOX_ACCESS_TOKEN` | Pull folders from Dropbox into import staging. |
| `FRAMEIO_TOKEN` | Pull media from Frame.io. |
| `ATTATTA_IMPORT_URL_ALLOWLIST` | Comma-separated host allowlist for HTTPS zip / remote-folder import (SSRF guard). |

Without the LLM key, import still works — kinds fall back to filename heuristics and human review.

### Minimum local loop (no keys)

```bash
pnpm install && pnpm seed && pnpm dev
```

UI + Remotion assemble work; Comfy variant gen stays stub/`auto` until `COMFY_API_KEY` is set.

## Deploy (Vercel web)

Project **Root Directory** must be `apps/web`. Always deploy from the **monorepo root** (so workspace packages upload):

```bash
cd /path/to/ATTATTA
vercel deploy --prod
```

Do **not** run `vercel` from `apps/web` alone — install hangs on `workspace:*` because `packages/*` never get uploaded.