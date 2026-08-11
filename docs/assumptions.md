# ATTATTA — Assumptions (v0.1.5)

Companion to [PRD.md](./PRD.md).  
**Locked** = product truth until explicitly revised.  
**Revisable** = default that may change.  
**Best guess** = inferred from briefs/diagrams/research; confirm when possible.

Sources:

- [briefs/2026-08-05_celtra-hopper-brief.md](./briefs/2026-08-05_celtra-hopper-brief.md)  
- [briefs/2026-08-05_source-notes.md](./briefs/2026-08-05_source-notes.md)  
- [briefs/2026-08-05_architecture-diagrams.md](./briefs/2026-08-05_architecture-diagrams.md)  
- [WORKFLOW-UX-INTEGRATION.md](./WORKFLOW-UX-INTEGRATION.md)  
- [COMFYUI-INTEGRATION.md](./COMFYUI-INTEGRATION.md)  
- [CELTRA.md](./CELTRA.md)  

---

## Locked defaults

| ID | Assumption |
|----|------------|
| L1 | Working product name **ATTATTA**; nickname **Celtra hopper**. |
| L2 | Ads are modular: **spokesperson + hands + copy**, assembled in a **campaign template**. |
| L3 | Story beats are **setup → punchline → end card**; cohesion is the quality bar. |
| L4 | Spokesperson **face, voice, and (likely) performance are locked** — no modify/replace/synthesize. |
| L5 | Allowed on spokesperson: **wardrobe** and **background** changes; variation also via **library take selection**. |
| L6 | **Hands** are the open generative surface (product, performance adjust, BG). |
| L7 | ATTATTA owns **creative control** (brief → variants → review → masters); Celtra owns **distribution / trafficking** only. |
| L7a | Handoff artifact is a **Celtra-ready package** (approved MP4s + matrix metadata); Celtra must not re-author story/talent/hands. |
| L7b | ATTATTA does **not** replace Celtra’s CMP (HTML5 studio, localization toolkit, ad-tag serving, media buying). |
| L8 | MVP output is **vertical paid social (9:16)**; multi-size is a design assumption for later. |
| L9 | **Local-first** build now — no hosting/servers/auth scope in this phase. |
| L10 | Template assembly engine is **Remotion** (Enterprise license treated as hard dependency). |
| L11 | Generative variation workflows run through **ComfyUI**. |
| L12 | Tagging happens at **library ingest** and again **post-approval on finals**. |
| L13 | Library core: **Ted / spokesperson**, **hand alts**, **body movement references**. |
| L14 | Creative judgement stays in **review/tweak/regen**; tool removes manual assembly. |
| L15 | Experience is the **9-stage journey**: Template → Prompt → Library → Dynamic Preview → GenAI → Iterations → Review → Tagging → Distribution. |
| L16 | **Design tokens** are a first-class input to variant generation. |
| L17 | **Dynamic preview** (rough cut) is distinct from final GenAI/encode. |
| L18 | Comfy **node canvas is not the operator UI**; marketers/designers use a simplified cockpit; techs author workflows in Comfy. |
| L19 | Diffusion backends are **model-profile agnostic**; default profile is **`z_image_turbo`**; `sdxl` and `flux_schnell` are swappable alternates via registry + per-profile workflow graphs. |

---

## Revisable choices

| ID | Default | Why it may change |
|----|---------|-------------------|
| R1 | Prompt-led brief (not only forms) | Team may want hybrid form for offers/legal |
| R2 | Batch / matrix size **8–20** cells per run | Budget, ComfyUI time, Celtra needs |
| R3 | Review export = **approved only** | PoC may ship all renders with status flags |
| R4 | Frame.io for production review; **local manifest for PoC** | Process maturity |
| R5 | Motion refs from **ActorCore-class** library | May shift to proprietary mocap |
| R6 | Multi-aspect from one concept **after** 9:16 MVP | Display/other placements timing |
| R7 | Cohesion QC via LLM heuristic | May need human-only at first |
| R8 | Filename `{campaignSlug}_{matrixCellId}_{aspect}.mp4` | Celtra/DAM conventions |
| R9 | Additional channels beyond Meta are activated **via Celtra**, not ATTATTA-native publish | Journey deck logos = Celtra’s surface |
| R10 | Azure as hosted runtime is **post-PoC** | Shown on iterations stage in journey deck |
| R11 | Celtra may **resize/repackage** approved masters for more placements | Confirm whether ATTATTA must also supply 1:1 / 4:5 |
| R12 | Celtra ingest for PoC is **manual upload + matrix file** | API/feed automation later after CSM confirm |

---

## Best guesses (confirm or override)

| ID | Guess | Rationale |
|----|-------|-----------|
| G1 | **Scenario space is constrained** by face-lock; we scale via more library takes + wardrobe/BG + hands/copy, not infinite AI performances. | Creative-tech question on face-untouchable limits |
| G2 | Ted shoots should be **flat, consistent lighting** and preferably **multi-angle** (front mandatory). | Needed if we cannot relight/rebuild the face |
| G3 | Body motion refs start from a **commercial motion library** (ActorCore cited); proprietary shoot later if gaps appear. | Listed dependency |
| G4 | **Phone props are campaign-variable** (not one forever-brand), but a batch should stay internally consistent. | Brief asked brand-match vs change |
| G5 | **Social UI chrome is swappable** (template prop / design token), defaulting to a neutral IG-like frame when needed. | Brief + design-tokens stage |
| G6 | Opening template clips that ComfyUI generates are primarily **hands/theme plates**, not new Ted performances. | Aligns with contract + PoC demo B |
| G7 | Celtra handoff v1 is **files + CSV/JSON matrix**, not API. | Local PoC; delivery step still “into Celtra” |
| G8 | Performance marketers consume volume; **creatives own library approval + review gate**. | Matches hopper metaphor + prior product intent |
| G9 | “Performance locked” means no AI re-performance; cutting between approved takes is OK. | Practical assembly need |
| G10 | Sentiment/tags are **assistive for discovery**, not auto-picking without operator override in PoC. | Avoid black-box ingredient selection early |
| G11 | Journey “Distribution” means **ATTATTA package → Celtra → platforms**, not ATTATTA posting natively. | Celtra research + journey deck |
| G12 | OpenAI logo on GenAI stage = **LLM slot**, not the video generator; video/compositing flexibility is ComfyUI (+ Remotion). | Tool logos on `image.jpg` |
| G13 | Celtra Export API is useful later for **pulling** launched outputs/labels back; PoC only needs **push/hand-off in**. | Public Celtra docs emphasize export |
| G14 | “Content matrix” in product email ≈ Celtra feed/content-dimension table for activation — ATTATTA generates it from approved cells. | Hopper brief + Celtra feeds model |

---

## Explicit non-assumptions

We are **not** assuming:

- Hosted production deployment in this phase  
- Exact Celtra schema field list (needs a sample matrix)  
- Remotion Enterprise already purchased (dependency called out)  
- Permission to touch face “a little” — treat as **strict** until legal says otherwise  
- Single phone OEM forever  
- Frame.io required for PoC demos  
- Native publish to TikTok/Reddit in MVP  

---

## How to revise

1. Drop source material in [`briefs/`](./briefs/).  
2. Reference IDs (`L4`, `G4`, `R3`, …).  
3. Update this file and the affected PRD section together.  
