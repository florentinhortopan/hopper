# ATTATTA — Product PRD (concise)

**Version:** 0.2  
**Date:** 2026-08-10  
**Status:** Current product truth (reconciled with shipped Slice A/B)  
**Related:** [APP.md](./APP.md) · [UX-PRD.md](./UX-PRD.md) · [assumptions.md](./assumptions.md) · [CELTRA.md](./CELTRA.md) · detailed [PRD.md](./PRD.md)

---

## 1. One-liner

**ATTATTA** is a local **Celtra hopper**: brief once → assemble modular paid-social video variants from approved ingredients → review → export a Celtra-ready package. Celtra is distribution only; ATTATTA owns creative control.

---

## 2. Problem & thesis

| Problem | Thesis |
|---------|--------|
| Teams need many paid-social variants from one idea. Manual pick/edit/render/repackage sits between brief and volume. | Remove assembly work, not creative judgement. Approved libraries + selective GenAI under talent locks → sparse matrix → human review → masters + matrix metadata for Celtra. |

**Not this product:** marketplace, booking, chat, payments, multi-tenant SaaS, Celtra CMP replacement, Meta auto-publish, freeform “new talent” synthesis.

---

## 3. Users & jobs

| Role | Job | Outcome |
|------|-----|---------|
| **Operator** (performance marketer / creative tech) | Pour brief → steer knobs → batch → export | Reviewable variants without a developer per batch |
| **Reviewer** (creative / brand) | Keep / kill / note; enforce talent contract | Only cohesive, brand-safe variants ship |
| **Creative tech** (advanced) | Author Comfy workflows offline | Operators never touch node graphs |

Local PoC: Operator and Reviewer may be the same person. No auth.

---

## 4. Product model (locked)

Every ad = three parts; story = three beats.

```
Spokesperson (locked face/voice/performance)
    + Hands (primary generative surface)
    + Copy (offer messaging)
        → Setup → Punchline → End card
```

| Part | Flexibility |
|------|-------------|
| Spokesperson | Library take select; wardrobe/BG AI only under contract |
| Hands | Product / hold / plate generation (Comfy) |
| Copy | Within brief rules; LLM assist deferred |

**Quality bar:** cohesion. A valid combo that tells no story fails review.

**Boundary:** ATTATTA → finished MP4s + `matrix.json`. Celtra → trafficking / channel activation. Celtra must not re-author story, talent, or hands.

---

## 5. Scope

### In scope (ships / PoC)

- Campaign lifecycle: create, rename, archive, delete  
- Brief (prompt + structured fields)  
- Design token packs (end-card chrome)  
- Global library DAM (talent, hands, motion, attire, BG, prop, theme)  
- Campaign ingredients + talent contract gates  
- Ingredient rail (hero stack + open knobs)  
- Sparse matrix (default cap ~20)  
- Comfy plate gen (`live` / `auto` / `stub`; default cloud profile `sd15`)  
- Remotion assemble (`paid-social-9x16-v1`) + Meta size stack (9:16, 4:5, 1:1, 16:9)  
- Job queue, Keep/Kill review, Celtra zip export  

### Out of scope (this phase)

- Auth, hosting, multi-user SaaS  
- Replacing Celtra studio / ad-tag serving  
- Auto-publish to Meta or Celtra API  
- Face/voice/performance synthesis  
- Full timeline NLE  
- Frame.io, LLM cohesion judge, native CogVideo/LTX (deferred)

### Acceptance

Operator can produce **≥1 approved** vertical MP4 + `matrix.json` zip **without opening ComfyUI**.

---

## 6. Happy path (operator)

1. **Library** — upload or prompt-draft ingredients; generate plates  
2. **Campaign → Ingredients** — activate set; honor talent contract  
3. **Brief → Tokens → Ingredients → Matrix** — activate plates (2+ fans an axis; copy plates fan lines), build sparse cells  
4. **Variant review / Review** — Inspect Comfy plates → Assemble hi-res Remotion once → Keep/Kill  
5. **Package** — Zip approved masters (`outputPath`) for Celtra  

---

## 7. Functional requirements (must)

| ID | Requirement |
|----|-------------|
| FR-1 | Campaign CRUD with step funnel (brief → … → package) |
| FR-2 | Library items by kind with media or prompt-only draft |
| FR-3 | Talent contract blocks disallowed attire/BG/props/hands |
| FR-4 | Rail exposes only activated ingredients; matrix is sparse |
| FR-5 | Generation stages are observable (queue progress / errors) |
| FR-6 | Hi-res Remotion assemble per selected size (`outputPath`) |
| FR-7 | Review decisions persist (approved / rejected / pending + notes) |
| FR-8 | Package includes **approved-only** masters + matrix metadata |
| FR-9 | Comfy is headless to operators; workflows versioned for techs |

---

## 8. System sketch

```text
┌─────────────┐     REST      ┌──────────────────┐
│  Next.js UI │ ────────────► │  Orchestrator    │
│  :3000      │               │  Express :8787   │
└─────────────┘               │  store (JSON fs) │
                              └────────┬─────────┘
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
              Comfy adapter      Remotion render     Celtra zip
              (plates/video)     (assemble beats)    (matrix+mp4)
                    │
                    ▼
              data/library · data/campaigns · data/packages
```

**Stack:** pnpm monorepo · Next 15 · Express · Remotion 4 · Zod · Comfy Cloud/local · ffmpeg · local JSON (no DB/auth).

---

## 9. Success metrics (PoC)

| Metric | Target |
|--------|--------|
| Time brief → first reviewable variant | Minutes, not hours |
| Operator opens ComfyUI | Never (happy path) |
| Approved package usable in Celtra handoff | Manual drop succeeds |
| Review load per batch | ≤ ~20 cells (sparse by default) |
| Talent contract violations in export | Zero |

---

## 10. Roadmap (product)

| Phase | Focus | Outcome |
|-------|-------|---------|
| **Now — Slice A/B** | Local hopper + live Comfy + multi-size Remotion + zip | Acceptance bar met |
| **Next** | Review Swap/Rewrite/Re-roll · LLM brief/copy assist · stronger model profiles (Z-Image/FLUX) · face-protect attire/BG maps | Faster iterate loop |
| **Later** | Celtra API / confirmed ingest schema · Frame.io · hosted runtime · tagging/discovery DAM | Team workflow |
| **Not planned** | Native media buying · Celtra replacement · freeform talent regen |

---

## 11. Open questions

1. Confirm Celtra ingest schema (file names, aspect fields, matrix columns).  
2. Does ATTATTA own all Meta sizes, or does Celtra resize masters?  
3. Remotion Enterprise license for org use.  
4. Lighting / take standards for face-locked talent shoots.  

---

## 12. Doc map

| Doc | Use |
|-----|-----|
| This file | Concise product PRD |
| [UX-PRD.md](./UX-PRD.md) | UX flows, IA, roadmap, improvements |
| [APP.md](./APP.md) | What ships / runbook |
| [PRD.md](./PRD.md) | Long-form product detail (v0.1) |
| [COMFY.md](./COMFY.md) | Live Comfy surface |
| [CELTRA.md](./CELTRA.md) | Distribution boundary |
