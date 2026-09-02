# ATTATTA ↔ Celtra — Boundary & content matrix

**Updated:** 2026-09-02  
**Related:** [PRD.md](./PRD.md) · [LIVE-WORKSPACE.md](./LIVE-WORKSPACE.md) · golden sample lives locally at `celtra-matrix/` (gitignored — do not commit client matrices)

---

## 1. Split of ownership

```text
ATTATTA  →  plates + busy content-matrix XLSX  →  Celtra template (opaque)
                one-way handoff (zip)
```

| Layer | Owns |
|-------|------|
| **ATTATTA** | Brief, libraries, Comfy plates, review, **Celtra-shaped spreadsheet + assets** |
| **Celtra** | Video template (timeline/animation), queue lines from matrix, channel trafficking |

ATTATTA does **not** recreate Celtra Studio. Remotion assemble is **optional preview**, not the Package gate.

---

## 2. How Celtra ingest actually works (from GT3 sample + Aug 2026 walkthrough)

1. Creative fills a **wide Excel content matrix** (tagging, naming, copy, media file names).
2. Celtra **parses each data row** into a **project queue line** bound to a template whose **field names match column headers**.
3. Designers historically: SharePoint → download → upload into Celtra. Excel ingest works when the matrix is locked/approved.
4. Templates lock **total length + frame count + sizes**. Changing sequence often needs a new Celtra file.

### Golden workbook

Local path (not in git): `celtra-matrix/Guarantee Tranche 3 - Content Matrix.xlsx`

| Sheet | Role |
|-------|------|
| **Social Video** | **Celtra ingest** — ATTATTA Package target |
| Social Static - Killed - | Out of scope |
| Client Info | Human brief summary — not ingest |

Place client matrices under `celtra-matrix/` (gitignored). Headers for profile `guarantee_tranche3_social_video_v1` were frozen from Guarantee Tranche 3 Social Video.

**Social Video** layout:

- Row 1 — group labels (`FRAME 1`, `FRAME 2`, `FRAME 3…`, `END CARD`, `Naming`, …)
- Row 2 — exact headers A–AL (preserve spelling, including `F1 ImageLink` vs `F2 Image Link`, trailing spaces on `Celtra order ` / `Asset Name `)
- Rows 3+ — one row ≈ one Celtra order (`Celtra order` + `Version`)

**Frame media in this sample are still images (`.png`)**, not MOVs. Celtra sequences them. A future MOV/hands matrix needs a **second profile** — do not invent video column names yet.

### Media cell conventions

| Column | Export rule |
|--------|-------------|
| `F{n} Image File Name` | Basename only; file lives in zip `assets/` |
| `F{n} Image Thumbnail` / `Logo` / `Globe` | **Leave blank** (sample shows broken `#VALUE!` formulas) |
| `F{n} ImageLink` / `Image Link` | Stem without extension |
| Headlines | Enforce max lengths from header text (35 / 30 / 77) |
| `F3 *` | Optional (longer versions only) |
| `Asset Name ` | Ends with `_SIZE_LENGTH` tokens for size explode |
| `BG Color` / `CTA Color` | Hex **without** `#` |

Profile id in code: `guarantee_tranche3_social_video_v1` ([`packages/shared/src/celtraProfiles.ts`](../packages/shared/src/celtraProfiles.ts)).

---

## 3. Package contract (current)

**Zip filename (download):**

```text
ATTATTA_<Campaign>_Celtra_vNN_<YYYYMMDD-HHmm>_<N>rows.zip
```

Example: `ATTATTA_Bacherozzo_Celtra_v03_20260828-1703_2rows.zip`  
`vNN` increments per campaign from existing files in `data/packages/`. Served at `GET /packages/<filename>.zip`.

**Zip contains:**

- `content_matrix.xlsx` — Social Video sheet, GT3 headers
- `content_matrix.csv` — same headers (paste-friendly)
- `assets/*` — plate files named as File Name cells
- `matrix.json` — internal debug lineage (not Celtra ingest)
- `README.txt` — warnings / profile note

**Gate:** approved review + plate media (`genPath` preferred, else preview/master). **Remotion `outputPath` not required.**

Scene tags map: `setup`→F1, `punchline`→F2, `endcard`→F3. Each approved cell becomes one Celtra order row with its plate in the tagged frame.

**Sizes:** Live preview shows **one line per variant** with Settings size columns. Keep/Kill is **per size** (zip emits **one Celtra order row per kept size plate**). Shared cross-aspect genPaths are treated as missing until a native plate exists for that aspect.

---

## 4. What Celtra still owns

- Template design / animation / timing locks  
- Multi-channel packaging and trafficking  
- Client revision loops after first ingest  

One-way handoff only for MVP (no SharePoint mount, no Celtra API import yet).

---

## 5. Open items

1. Confirm Excel ingest vs paste workflow with Celtra ops for AT&T.  
2. Obtain a **MOV/video-column** matrix sample for hands/Ted path → new profile.  
3. Optional: emit Client Info companion sheet.  
4. Celtra API investigation (William) — later.

---

## 6. Language

| Prefer | Avoid |
|--------|--------|
| Content matrix = Celtra ingest spreadsheet | “matrix.json is what Celtra eats” |
| ATTATTA feeds Celtra queue lines | ATTATTA replaces Celtra templates |
| Plates + sheet package | Remotion masters required for Package |
