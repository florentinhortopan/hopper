# Celtra hopper — enriched product brief

**Date:** 2026-08-05  
**Status:** Normalized + improved from creative-tech PoC notes and Florentin’s product email  
**Raw trace:** [2026-08-05_source-notes.md](./2026-08-05_source-notes.md)  
**Feeds:** [PRD.md](../PRD.md) · [assumptions.md](../assumptions.md)

---

## One-liner

Pour approved ingredients (talent library, hands, brand messaging) into the top of the hopper; get finished, approved video masters + a content matrix out the bottom — **Celtra distributes** to channels; ATTATTA keeps creative control.

## Problem

The team can invent ads faster than they can manually assemble them. Field-by-field picking of assets and copy does not scale to dozens of variants, and it still needs developer help for renders.

## What we're building

A local-first tool that:

1. Takes a **single brief/prompt** (scenario, tone, offer).
2. Assembles ads from a **stable template** (spokesperson → hands → end card).
3. Uses **approved libraries** for contracted talent and hand performances.
4. Uses **AI where contracts allow** (hands/product freely; spokesperson wardrobe/BG only).
5. Returns a **set of variants** for review/tweak/regen.
6. Packages approvals into a **content matrix** for Celtra.

Creative judgement stays; manual assembly goes.

## Ad anatomy

| Module | Source | AI latitude |
|--------|--------|-------------|
| Spokesperson (e.g. Ted) | Pre-recorded library | Wardrobe + background; **no face/voice/performance synthesis** |
| Hands / product | Library + generative | High — product, performance adapt, BG |
| Copy | LLM + brand rules | High within voice/claim guardrails |

### Story contract

Every variant must land:

- **Setup** — scenario  
- **Punchline** — payoff moment  
- **End card** — clear offer  

Cohesion across modules is mandatory. Valid renders with broken stories are rejects.

## Target workflow

1. Brief it once (prompt).  
2. Tool generates (select/adapt ingredients, write copy, render).  
3. Variants return.  
4. Review and tweak (the real creative loop).  
5. Package content matrix.  
6. Deliver via Celtra.  

## PoC deliverables (near-term)

| Deliverable | Intent |
|-------------|--------|
| Remotion demo | Content matrix → template timeline → campaign-ready videos |
| ComfyUI demo | Generate flexible template clips; param tweaks for theme variations |
| Diagram: content matrix | Slide-ready combinatorial view |
| Diagram: workflow stages | Brief → library/gen → assemble → review → matrix → Celtra |
| Diagram: ComfyUI deps | Task graph for generative slots |
| Diagram: video generation | End-to-end render path |

### PoC explicit non-goals

Empowering full production **asset discovery, iteration review, state tracking, and publishing** is out of PoC (keep as future). **Hosting/servers** out of current build.

## Content library

**Primary contents**

- Ted / spokesperson takes  
- Hand alt videos  
- Human body movement references  

**Metadata**

- AI tagging + sentiment on all video (talent, AI outputs, finals)  
- Used to aid suggestions and discovery for creative iteration  

**Shoot guidance (best guess)**

- Flat, consistent lighting on Ted if face cannot be relit  
- Front angle mandatory; capture extra angles per take when possible  
- Multi-angle increases future scenario coverage without touching the face  

## Guardrails (talent)

**Cannot alter:** face, voice, body performance (strict default).  

**Can alter:** wardrobe, background; select alternate approved takes.  

**Implication:** scenario volume comes from library breadth + hands/copy/wardrobe/BG — not from generating new Ted performances.

## Open product questions (with proposed answers)

| Question | Proposed answer |
|----------|-----------------|
| Limit scenarios if we can’t touch the face? | Yes — plan library coverage deliberately; don’t promise infinite AI scenarios |
| Flat lighting required? | Yes, as shoot standard while face-lock holds |
| Camera coverage? | Front + ≥2 supporting angles per line/take when budget allows |
| Motion reference source? | Start with commercial library (ActorCore-class); gap-fill later |
| Phone brand consistency? | Per-campaign choice; consistent within a batch |
| Social UI chrome? | Swappable template prop; optional per campaign |

## Dependencies

| Item | Role | PoC now? |
|------|------|----------|
| Remotion Enterprise | Template render | Yes (license may be blocking) |
| ComfyUI | Generative variations | Yes |
| Motion library (e.g. ActorCore) | Body refs | Yes (subset) |
| Frame.io | Production review | Later |
| Celtra | Delivery | Matrix-shaped export now; API later |

## Success for this brief

- Modular structure proven beyond manual field picking.  
- Prompt → variants path replaces manual assembly for a sample matrix.  
- No pipeline path modifies Ted’s face or voice.  
- Approved outputs land in a Celtra-ready matrix package.  
- All of the above runnable **locally**.  
