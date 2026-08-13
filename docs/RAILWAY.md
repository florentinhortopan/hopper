# Deploy orchestrator on Railway

Vercel hosts the **web UI**. Railway hosts the **API** (Express + Remotion + ffmpeg + `data/`).

## 1. Push this repo to GitHub

Railway deploys from `florentinhortopan/hopper` (or your fork). Commit the `Dockerfile` / `railway.toml` if they aren’t on `main` yet.

## 2. Create the Railway service

1. Open [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** → select `hopper`
3. When prompted / in Settings:
   - **Root Directory:** leave empty (repo root)
   - Builder uses `Dockerfile` via `railway.toml`

Wait for the first build (Chrome + pnpm can take several minutes).

## 3. Add a volume (persistent library / campaigns)

1. Service → **Settings** → **Volumes** → **Add Volume**
2. Mount path: `/app/data`
3. Redeploy so the empty volume is used (otherwise media disappears on restart)

## 4. Environment variables

Service → **Variables** → add at least:

| Variable | Value |
|----------|--------|
| `COMFY_API_KEY` | your Comfy Platform key |
| `COMFY_BASE_URL` | `https://cloud.comfy.org` |
| `COMFY_MODE` | `auto` |
| `COMFY_MODEL_PROFILE` | `sd15` |
| `COMFY_WORKFLOWS_DIR` | `./comfy/workflows` |
| `PUBLIC_BASE` | `https://YOUR-SERVICE.up.railway.app` (set after step 5) |

Optional: `ATTATTA_LLM_API_KEY`, Dropbox/Frame.io tokens (same as local `.env`).

Railway injects `PORT` automatically — don’t hardcode it.

## 5. Public HTTPS URL

1. Service → **Settings** → **Networking** → **Generate Domain**
2. Copy the URL, e.g. `https://hopper-production-xxxx.up.railway.app`
3. Set `PUBLIC_BASE` to that exact URL (no trailing slash)
4. Redeploy once so logs / file URLs use it

Health check hits `GET /libraries` — should return `200` when up.

## 6. Point Vercel at Railway

In the Vercel project **hopper**:

1. **Settings → Environment Variables**
2. Set `NEXT_PUBLIC_API_URL` = `https://YOUR-SERVICE.up.railway.app`  
   (Production + Preview)
3. **Redeploy** the web app (required — `NEXT_PUBLIC_*` is baked at build time)

Login wall still uses `SITE_PASSWORD` on Vercel only.

## 7. Smoke test

1. Open the Vercel URL → enter site password  
2. Campaigns / Library should load from Railway  
3. Railway **Deployments → Logs** should show:  
   `ATTATTA orchestrator on https://…`

## Notes

- Remotion needs ~2GB+ RAM; if renders OOM, bump the Railway plan / memory.
- First seed: either upload plates via Library, or run `pnpm seed` locally and copy `data/` into the volume (advanced). Empty volume = empty library until you import.
- Local dev unchanged: `pnpm dev` still uses `127.0.0.1:8787`.
