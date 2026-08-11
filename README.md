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
3. **Brief → Tokens → Matrix** — Build from activations; Preview model prompt; generate variants.  
4. **Preview** → queue Remotion preview / **Queue** → Final render.  
5. **Review** → Keep at least one cell with an output.  
6. **Package** → download Celtra zip (`matrix.json` + mp4s).

## Monorepo

| Path | Role |
|------|------|
| `apps/web` | Next.js operator UI |
| `apps/orchestrator` | Local API + Remotion jobs + Celtra zip |
| `packages/shared` | Zod schemas |
| `packages/remotion-template` | `paid-social-9x16-v1` composition |
| `comfy/` | Model registry (Z-Image-Turbo default) — Slice B |
| `data/` | Library, campaigns, packages |

## Env

Copy [`.env.example`](.env.example). Secrets go in `.env` (gitignored). Web uses `apps/web/.env.local` for `NEXT_PUBLIC_API_URL`.
