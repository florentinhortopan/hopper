# Architecture diagrams — interpretation

**Date:** 2026-08-05  
**Sources (images in this folder):**

| File | Role |
|------|------|
| [image-2.png](./image-2.png) | Visual product journey strip (numbered stages → finished vertical ads) |
| [image.jpg](./image.jpg) | Same journey with stage copy + tool logos |
| [unnamed.jpg](./unnamed.jpg) | Text legend for the nine experience stages |
| [unnamed.png](./unnamed.png) | Celtra-oriented tech/data flow |

**Feeds:** [PRD.md](../PRD.md) · [assumptions.md](../assumptions.md)

---

## How to read the set

Two complementary views of one product:

1. **Experience journey** (`image-2.png`, `image.jpg`, `unnamed.jpg`) — what the team does from template to distribution.
2. **Data / packaging flow** (`unnamed.png`) — how variants become a **Celtra-ready content matrix**.

Journey = UX north star (including Frame.io, tagging, platforms).  
Celtra flowchart = **handoff contract** for this tool.  
**Updated boundary:** ATTATTA owns creative control through review; **Celtra is distribution/trafficking only** (see [../CELTRA.md](../CELTRA.md)).

---

## A. Product experience journey (9 stages)

Canonical stage list from `unnamed.jpg` / `image.jpg`:

| # | Stage | Meaning |
|---|--------|---------|
| 1 | **Campaign Template** | Workflows are scoped to campaign templates (modular vertical ad). |
| 2 | **Prompt** | The provided idea grounds ad generation. |
| 3 | **Asset Library** | Library of talent and assets with suggestions (talent + hands called out). |
| 4 | **Dynamic Preview** | Rough cut of the ad available **immediately**. |
| 5 | **GenAI Rendering** | AI compositing and asset generation (OpenAI + ComfyUI in deck). |
| 6 | **Iterations** | Refine by reprompting and generating new ads (Azure shown as runtime in deck). |
| 7 | **Review Platform** | Client/creative review and feedback (Frame.io). |
| 8 | **Automated Tagging** | Post-approval metadata tagging of ad content (AI tagging model). `unnamed.jpg` also frames deliverable scheduling/organization. |
| 9 | **Distribution** | Export to **DCO** and/or platforms (IG, TikTok, Reddit shown). |

`image-2.png` compresses this to eight visible nodes and draws an explicit **feedback loop from GenAI Rendering → Prompt**, then Frame.io → Tagging → Distribution, ending on stacks of finished 9:16 ads (spokesperson + phone).

### Journey implications

- Template-scoped, not freeform editor.
- **Preview ≠ final render** — need a fast rough-cut path.
- Library is suggestion-assisted (talent + hands).
- Iteration is first-class (reprompt / regenerate).
- Review sits before tagging-for-delivery and distribution.
- Distribution ambition is broader than “files on disk” (DCO + social); **this tool’s package step is still the content matrix**.

---

## B. Tech / data flow (Celtra hopper)

From `unnamed.png`:

```text
Creative Prompt
    → Asset & Copy Generation
    → Variant Generation  ←── Design Tokens
    → Variant Review  ⟲ back to Variant Generation
    → Variant assets packaged into Content Matrix
    → Celtra-ready content matrix
```

### Data-flow implications

- **Design tokens** are an explicit input to variant generation (brand system alongside library ingredients).
- Review loop regenerates **variants**, not only a blank-slate prompt.
- Terminal artifact for ATTATTA: **Celtra-ready content matrix** (not direct social API publish in the core flow).

---

## C. Reconciling the two views

| Topic | Journey deck | Celtra flowchart | Working interpretation |
|-------|--------------|------------------|------------------------|
| End state | DCO / IG / TikTok / Reddit | Celtra content matrix | Matrix → Celtra/DCO → platforms |
| Review | Frame.io stage | Variant Review diamond | Same gate; Frame.io is production UX, local manifest OK for PoC |
| Tagging | Post-approval automated tagging | Not drawn | **Two moments:** library ingest tags + post-approval tags on finals |
| Design tokens | Implicit in template/brand | Explicit parallelogram | Treat as first-class input |
| Preview | Dynamic Preview stage | Not drawn | Fast Remotion/rough path before heavy GenAI |
| Gen stack | OpenAI, ComfyUI, Azure | Generic generation boxes | ComfyUI + LLM locally now; Azure = later hosting |

---

## D. PoC vs north-star (from these diagrams)

**Build now (local):** stages 1–6 lightly (template, prompt/matrix, library stub, rough preview, ComfyUI + Remotion render, iterate) + local review + Celtra-shaped matrix export.

**Later:** Frame.io, production tagging service, Azure hosting, DCO/platform distribution automation.
