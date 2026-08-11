# ATTATTA — UI/UX Plan

**Status:** Opinionated v1  
**Audience:** marketers + designers (primary); creative technologists (advanced)  
**Related:** [WORKFLOW-UX-INTEGRATION.md](./WORKFLOW-UX-INTEGRATION.md) · [COMFYUI-INTEGRATION.md](./COMFYUI-INTEGRATION.md) · [PRD.md](./PRD.md)  
**Reference:** [briefs/2026-08-05_comfyui-canvas-example.png](./briefs/2026-08-05_comfyui-canvas-example.png) (ComfyUI node canvas)

---

## 1. Verdict on ComfyUI’s infinite node canvas

### What it is

ComfyUI is a **parametric node graph** on an infinite canvas: each node is a step (model, prompt, sampler, save…); wires define data flow; Run executes the graph. Extremely powerful for composing generative pipelines and exposing every parameter (seed, steps, UNET, CLIP, size…).

### Is it a good idea — for ATTATTA?

| Role | Use the Comfy canvas? | Why |
|------|----------------------|-----|
| **Creative technologist** (author workflows) | **Yes** | Build/version `hands_product_v1`, attire/BG graphs, tune models |
| **Performance marketer / designer** (daily hopper) | **No** | Wrong abstraction: contracts, story beats, sparse tests — not UNET wires |
| **Review / Celtra handoff** | **No** | Decisions are Keep/Kill/Swap knob, not rewiring graphs |

**Decision (locked):** Comfy’s canvas is an **authoring backend tool**, not the product UI. ATTATTA’s operator experience must be **radically simpler**: brief → tokens → rail → matrix → preview → review → package. Under the hood, knobs patch allowlisted Comfy inputs via `ComfyAdapter`.

Exposing the infinite canvas as the main UX would:

- Break the “no developer in the loop” goal  
- Hide talent locks inside opaque graphs  
- Encourage unconstrained generation (face/scenario drift)  
- Explode review volume (every wire tweak ≠ a marketing test)

---

## 2. UX principle: two altitudes

```text
Altitude A — Operator UI (ATTATTA)
  Simple, constrained, story-first
  Knobs: take, hands, attire, BG, motion, copy, token pack
           │
           │ patches + workflowId
           ▼
Altitude B — ComfyUI (headless or tech-only canvas)
  Versioned API workflows, full parametric power
           │
           ▼
        Library plates → Remotion → Review
```

**Never** ask a marketer to choose `unet_name` or drag `Save Image` nodes.  
**Do** let a creative tech open Comfy to improve a workflow blueprint, then ship a new `workflowId` to operators.

---

## 3. Information architecture (operator app)

### Global chrome

- **Left nav (narrow):** Campaigns · Library · Tokens · Templates · Packages · (Admin)  
- **Top bar:** Campaign name · Batch status · Cost/time estimate · Help  
- **No node graph anywhere in default nav**

### Primary screens (in order of the happy path)

| # | Screen | One job | Primary control |
|---|--------|---------|-----------------|
| 1 | **Campaign home** | Pick/create campaign + template | Template cards |
| 2 | **Brief** | Capture intent once | Large prompt + chips (offer, CTA, must-not) |
| 3 | **Design tokens** | Lock brand chrome for the batch | One pack selector + live end-card preview |
| 4 | **Ingredient rail** | Pin what may be used | Talent / Hands / Motion columns + locks |
| 5 | **Matrix** | Plan sparse tests | Grid of cells; open-knob fan only |
| 6 | **Preview bay** | Judge story cheaply | Vertical player + beat markers + knob side panel |
| 7 | **Render queue** | Wait with trust | Progress list (Comfy + Remotion stages) |
| 8 | **Review board** | Decide at volume | Thumb grid + Keep/Kill/Swap/Rewrite |
| 9 | **Package** | Hand off to Celtra | Zip + matrix table download |

Secondary (not in main funnel):

| Screen | Who | Job |
|--------|-----|-----|
| **Library browser** | Both | Browse tagged Ted/hands/motion; request shoot |
| **Workflow lab** | Creative tech only | List versioned Comfy workflows; “Open in ComfyUI”; publish map |
| **Admin** | Tech | `COMFY_BASE_URL`, paths, feature flags |

---

## 4. Screen-by-screen UX writing

### 4.1 Campaign home

- Cards: template thumbnail (9:16 wireframe of setup/punch/end), name, last batch status.  
- CTA: **New batch**.  
- Empty state: “Pick a template. You won’t edit a timeline — you’ll test knobs.”

### 4.2 Brief

**Layout:** 60% prompt / 40% structured chips.

- Prompt placeholder: “Scenario, tone, offer — one idea.”  
- Auto-extracted chips (editable): Audience · Offer · CTA · Must say · Must not.  
- Gaps callout (blocking): e.g. “No CTA” / “No usable Ted take in library for this scenario.”  
- Footer: **Continue to tokens** (not “Generate 50 ads”).

**Anti-pattern:** multi-page form that feels like Celtra toolkit setup.

### 4.3 Design tokens

**UX decision (locked earlier):** tokens are a **constraint pack**, not a variation engine.

- Show **one selected pack** (name, swatches, type specimen, end-card mock).  
- Optional: “Also test pack B” → creates a *second batch*, not a cartesian with hands.  
- Live preview: end card only (fast).  
- Copy: “Tokens dress every variant. They don’t multiply the matrix.”

### 4.4 Ingredient rail

**Three columns:**

1. **Talent (Ted)** — takes/angles; badges `Face locked` `Voice locked` `Performance locked`  
2. **Hands** — library alts + “Generate new…” (Comfy under the hood)  
3. **Motion** — token enums (e.g. `gesture_medium_v1`), not free mocap UI  

**Pin hero stack** strip at top: Take · Hands · Motion · (Attire) · (BG).  
**Open for this batch** toggles: max 2 knobs highlighted green.  
Suggestions from tags (assistive; operator confirms).

**Attire / BG:** collapsed advanced row — “Re-dress / re-site (AI, face protected)” — not the default fan.

### 4.5 Matrix

- Spreadsheet of cells; each cell = one future video.  
- Columns reflect open knobs only (e.g. Hands × Copy) with hero stack constant.  
- Cap banner at 20: “Large batches are hard to review — trim or split.”  
- Estimate: “~12 min Comfy · ~4 min Remotion · est. cost $X”.  
- Actions: Drop cell · Duplicate · Pin must-test.  
- Primary CTA: **Preview selected** (not Final render).

**No wire diagram. No node list.**

### 4.6 Preview bay

- Center: vertical player, markers **Setup | Punchline | End**.  
- Right: knob inspector (readouts + change one).  
- Bottom: cohesion prompt — “Does the story hold?” Yes → mark `preview_ok` / No → fix knobs.  
- Keyboard: `J/K` next cell, `E` edit copy, `H` swap hands.

### 4.7 Render queue

- Rows: cell id · stage chip (`Comfy: hands` · `Remotion final` · `QC`) · progress · error.  
- Expand row: shows **human labels** (“Generating hands plate”) — not node ids.  
- Tech disclosure link: “View Comfy prompt_id” (collapsed).  
- Cancel / retry per cell.

### 4.8 Review board (hero screen)

- Masonry/grid of 9:16 thumbs.  
- Filters: Unreviewed · QC flag · Approved · Rejected.  
- Click → drawer: player + knobs + lineage (workflowId, seed — not full graph).  
- Actions (always visible):  
  - **Keep**  
  - **Kill** (+ reason chips: brand / cohesion / quality / claim)  
  - **Swap** (picker for *one* knob)  
  - **Rewrite copy**  
  - **Re-roll gen** (new seed, same workflow)  
- Compare mode: 2-up, same hero stack.  
- Progress: “6/9 decided”.

### 4.9 Package

- Summary: N approved · token pack · template.  
- Table preview of matrix rows.  
- **Download Celtra package**.  
- Short note: “Celtra distributes these masters — it shouldn’t rebuild the story.”

---

## 5. How Comfy parameters surface (without the canvas)

Operators never see the graph. They see **semantic controls** mapped to patches:

| Operator control | Maps to (example) |
|------------------|-------------------|
| Hands style chips | prompt text / LoRA / workflow branch |
| Product ref upload | `/upload/image` → LoadImage node |
| “More motion” | motionToken enum → mapped conditioning |
| Re-roll | new `seed` on mapped sampler node |
| Attire preset | wardrobe ref + face-protect workflow |
| BG preset | BG prompt/ref + face-protect workflow |

**Advanced panel** (role-gated): show raw patch JSON + workflowId for debugging. Still not the canvas.

### Workflow Lab (creative tech only)

- List: `hands_product_v1` · status · last published · allowed patches · **compatible model profiles**.  
- Actions: **Open in ComfyUI** (deeplink to local/cloud canvas) · **Export API JSON** · **Publish to operators**.  
- Publish requires: per-profile API-format file + `.map.json` + `touches_face: false` checklist.  
- Default profile for the workspace/batch: **Z-Image-Turbo** (`z_image_turbo`); techs can publish `sdxl` / `flux_schnell` graphs beside it for swap.  
- This is the *only* blessed place the infinite canvas appears in the product story.

### Model profile (admin / batch)

- Simple select: **Z-Image-Turbo** (default) · SDXL · FLUX Schnell.  
- Copy: “Changes the engine behind Generate — not your matrix knobs.”  
- No file pickers for checkpoints in operator UI.

---

## 6. Visual / interaction guidelines (operator UI)

Aligned with a serious creative tool, not a node IDE:

- **One composition per screen** — avoid dashboard soup on Brief / Preview / Review.  
- **Vertical video is the hero** on Preview + Review; chrome stays secondary.  
- **Locks are visible** (badges), not buried in settings.  
- **Motion:** subtle — batch progress, review card accept animation; no graph physics.  
- **Density:** Review can be denser; Brief and Tokens stay calm.  
- **Don’t** mimic Comfy’s dark node chrome as the brand of ATTATTA (Comfy stays in Lab / external window).

---

## 7. UX flowchart (simplified altitude)

```mermaid
flowchart TB
  subgraph operator [OperatorAltitude_Simplified]
    brief[Brief] --> tokens[TokenPack]
    tokens --> rail[IngredientRail]
    rail --> matrix[SparseMatrix]
    matrix --> preview[PreviewBay]
    preview --> review[ReviewBoard]
    review --> pack[CeltraPackage]
  end

  subgraph hidden [Hidden_or_TechOnly]
    adapter[ComfyAdapter_Patches]
    comfyCanvas[ComfyNodeCanvas_LabOnly]
    remotion[RemotionAssemble]
  end

  matrix -->|needs_gen| adapter
  review -->|reroll_or_swap_gen| adapter
  adapter --> remotion
  preview --> remotion
  remotion --> review
  comfyCanvas dashed -->|publish_workflowId| adapter
```

---

## 8. What we will not build in v1 UI

- Embedding Comfy’s infinite canvas as the main workspace  
- Freeform node editing for marketers  
- “Prompt all token × ingredient combinations” wizard  
- Timeline NLE  
- Celtra-like multi-market toolkit builder  

---

## 9. PoC UI scope (practical)

**Minimum lovable local UI:**

1. Brief (textarea + JSON side panel OK)  
2. Rail picker (folder-backed)  
3. Matrix table (edit CSV in UI or grid)  
4. Preview / final triggers  
5. Review board over output folder  
6. Package zip button  

**Defer:** polished Campaign home, Workflow Lab UI (CLI publish is fine), Frame.io.

**Comfy:** run headless via adapter; creative tech uses native Comfy app (as in your screenshot) to author graphs.

---

## 10. Answer in one line

Comfy’s parametric canvas is an excellent **engine workshop**; ATTATTA’s product UX should be a **constrained campaign cockpit** — knobs, preview, review — with the node graph kept offstage except for workflow authors.
